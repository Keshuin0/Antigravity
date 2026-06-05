use reqwest::Client;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[derive(Serialize)]
struct ContentPart {
    text: String,
}

#[derive(Serialize)]
struct Content {
    parts: Vec<ContentPart>,
}

#[derive(Serialize)]
struct GenerateRequest {
    contents: Vec<Content>,
}

#[derive(Deserialize)]
struct PartResponse {
    text: Option<String>,
}

#[derive(Deserialize)]
struct ContentResponse {
    parts: Option<Vec<PartResponse>>,
}

#[derive(Deserialize)]
struct CandidateResponse {
    content: Option<ContentResponse>,
}

#[derive(Deserialize)]
struct GenerateStreamResponse {
    candidates: Option<Vec<CandidateResponse>>,
}

pub async fn stream_generate_content(
    api_key: &crate::security::ObfBox,
    prompt: &str,
    tx: tokio::sync::mpsc::Sender<String>,
) -> Result<(), String> {
    let client = Client::new();
    let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:streamGenerateContent";

    let decrypted_key = Zeroizing::new(api_key.decrypt());
    let mut header_val = reqwest::header::HeaderValue::from_bytes(&decrypted_key)
        .map_err(|e| format!("Invalid API key header: {}", e))?;
    header_val.set_sensitive(true);

    let payload = GenerateRequest {
        contents: vec![Content {
            parts: vec![ContentPart {
                text: prompt.to_string(),
            }],
        }],
    };

    let mut response = client
        .post(url)
        .header("x-goog-api-key", header_val)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("Gemini API error ({}): {}", status, err_text));
    }

    // Zero-allocation Byte-Ring-Buffer parser logic
    let mut buffer = Vec::new();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed to read stream chunk: {}", e))?
    {
        buffer.extend_from_slice(&chunk);

        let mut start_idx = 0;
        // Process line-by-line using byte scanning to be zero-allocation on buffer slicing
        while let Some(line_end) = buffer[start_idx..].iter().position(|&b| b == b'\n') {
            let absolute_end = start_idx + line_end;
            let line_bytes = &buffer[start_idx..absolute_end];

            let clean_line_bytes = if line_bytes.ends_with(b"\r") {
                &line_bytes[..line_bytes.len() - 1]
            } else {
                line_bytes
            };

            if !clean_line_bytes.is_empty() {
                process_sse_line(clean_line_bytes, &tx).await?;
            }

            start_idx = absolute_end + 1;
        }

        if start_idx > 0 {
            buffer.drain(0..start_idx);
        }
    }

    if !buffer.is_empty() {
        process_sse_line(&buffer, &tx).await?;
    }

    Ok(())
}

async fn process_sse_line(
    line_bytes: &[u8],
    tx: &tokio::sync::mpsc::Sender<String>,
) -> Result<(), String> {
    if line_bytes.starts_with(b"data:") {
        let data_slice = &line_bytes[5..];
        let trimmed_slice = trim_byte_slice(data_slice);

        if let Ok(json_str) = std::str::from_utf8(trimmed_slice) {
            if let Ok(parsed) = serde_json::from_str::<GenerateStreamResponse>(json_str) {
                if let Some(candidates) = parsed.candidates {
                    for candidate in candidates {
                        if let Some(content) = candidate.content {
                            if let Some(parts) = content.parts {
                                for part in parts {
                                    if let Some(text) = part.text {
                                        let _ = tx.send(text).await;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn trim_byte_slice(mut slice: &[u8]) -> &[u8] {
    while !slice.is_empty() && slice[0].is_ascii_whitespace() {
        slice = &slice[1..];
    }
    while !slice.is_empty() && slice[slice.len() - 1].is_ascii_whitespace() {
        slice = &slice[..slice.len() - 1];
    }
    slice
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trim_byte_slice() {
        assert_eq!(trim_byte_slice(b"  hello  "), b"hello");
        assert_eq!(trim_byte_slice(b"\nhello\r\n"), b"hello");
        assert_eq!(trim_byte_slice(b"hello"), b"hello");
    }
}
