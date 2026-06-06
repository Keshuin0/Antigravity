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

// OpenAI structures
#[derive(Serialize)]
struct OpenAIChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct OpenAIChatRequest {
    model: String,
    messages: Vec<OpenAIChatMessage>,
    stream: bool,
}

#[derive(Deserialize)]
struct OpenAIDelta {
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    delta: OpenAIDelta,
}

#[derive(Deserialize)]
struct OpenAIStreamResponse {
    choices: Vec<OpenAIChoice>,
}

pub async fn stream_generate_content(
    api_key: &crate::security::ObfBox,
    prompt: &str,
    tx: tokio::sync::mpsc::Sender<String>,
) -> Result<(), String> {
    stream_generate_content_multiplexed(
        "gemini",
        None,
        None,
        api_key,
        prompt,
        tx,
        None,
    ).await
}

pub async fn stream_generate_content_multiplexed(
    provider: &str,
    endpoint: Option<&str>,
    model: Option<&str>,
    api_key: &crate::security::ObfBox,
    prompt: &str,
    tx: tokio::sync::mpsc::Sender<String>,
    app_handle: Option<tauri::AppHandle>,
) -> Result<(), String> {
    let start_time = std::time::Instant::now();
    let mut first_token_time: Option<std::time::Instant> = None;
    let mut token_count = 0;

    let client = crate::embeddings::build_http_client();

    let decrypted_key = Zeroizing::new(api_key.decrypt());
    let key_str = std::str::from_utf8(&decrypted_key)
        .map_err(|e| format!("Invalid API key: {}", e))?;

    let response = if provider == "gemini" {
        let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:streamGenerateContent";
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

        client
            .post(url)
            .header("x-goog-api-key", header_val)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Network request failed: {}", e))?
    } else {
        let endpoint_url = endpoint.unwrap_or("http://localhost:8000/v1/chat/completions");
        let model_name = model.unwrap_or("nvidia/llama-3.1-inst-70b");

        let payload = OpenAIChatRequest {
            model: model_name.to_string(),
            messages: vec![OpenAIChatMessage {
                role: "user".to_string(),
                content: prompt.to_string(),
            }],
            stream: true,
        };

        let mut req = client.post(endpoint_url);
        if !key_str.trim().is_empty() {
            req = req.bearer_auth(key_str);
        }

        req.json(&payload)
            .send()
            .await
            .map_err(|e| format!("Network request failed: {}", e))?
    };

    let status = response.status();
    if !status.is_success() {
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("LLM API error ({}): {}", status, err_text));
    }

    let mut buffer = Vec::new();
    let mut response_stream = response.bytes_stream();
    use futures_util::StreamExt;

    while let Some(chunk_result) = response_stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Failed to read stream chunk: {}", e))?;
        buffer.extend_from_slice(&chunk);

        let mut start_idx = 0;
        while let Some(line_end) = buffer[start_idx..].iter().position(|&b| b == b'\n') {
            let absolute_end = start_idx + line_end;
            let line_bytes = &buffer[start_idx..absolute_end];

            let clean_line_bytes = if line_bytes.ends_with(b"\r") {
                &line_bytes[..line_bytes.len() - 1]
            } else {
                line_bytes
            };

            if !clean_line_bytes.is_empty() {
                let text_opt = if provider == "gemini" {
                    parse_gemini_sse_line(clean_line_bytes)?
                } else {
                    parse_openai_sse_line(clean_line_bytes)?
                };

                if let Some(text) = text_opt {
                    if !text.is_empty() {
                        if first_token_time.is_none() {
                            first_token_time = Some(std::time::Instant::now());
                            let ttft = start_time.elapsed().as_secs_f64();
                            if let Some(ref handle) = app_handle {
                                use tauri::Emitter;
                                let _ = handle.emit("llm-ttft", ttft);
                            }
                        }
                        token_count += 1;
                        let _ = tx.send(text).await;
                    }
                }
            }

            start_idx = absolute_end + 1;
        }

        if start_idx > 0 {
            buffer.drain(0..start_idx);
        }
    }

    if !buffer.is_empty() {
        let text_opt = if provider == "gemini" {
            parse_gemini_sse_line(&buffer)?
        } else {
            parse_openai_sse_line(&buffer)?
        };

        if let Some(text) = text_opt {
            if !text.is_empty() {
                if first_token_time.is_none() {
                    first_token_time = Some(std::time::Instant::now());
                }
                token_count += 1;
                let _ = tx.send(text).await;
            }
        }
    }

    // Report TPS
    let elapsed = first_token_time.map(|t| t.elapsed().as_secs_f64()).unwrap_or(0.0);
    let tps = if elapsed > 0.0 { token_count as f64 / elapsed } else { 0.0 };
    if let Some(ref handle) = app_handle {
        use tauri::Emitter;
        let _ = handle.emit("llm-tps", tps);
    }

    // Send a final log message to telemetry stream containing metrics
    if first_token_time.is_some() {
        let ttft = first_token_time.unwrap().duration_since(start_time).as_secs_f64();
        let _ = tx.send(format!(
            "\n\n[Self-Healing Engine] [Telemetry] TTFT: {:.3}s | Speed: {:.2} tokens/sec",
            ttft, tps
        )).await;
    }

    Ok(())
}

fn parse_gemini_sse_line(line_bytes: &[u8]) -> Result<Option<String>, String> {
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
                                        return Ok(Some(text));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(None)
}

fn parse_openai_sse_line(line_bytes: &[u8]) -> Result<Option<String>, String> {
    if line_bytes.starts_with(b"data:") {
        let data_slice = &line_bytes[5..];
        let trimmed_slice = trim_byte_slice(data_slice);

        if trimmed_slice == b"[DONE]" {
            return Ok(None);
        }

        if let Ok(json_str) = std::str::from_utf8(trimmed_slice) {
            if let Ok(parsed) = serde_json::from_str::<OpenAIStreamResponse>(json_str) {
                if let Some(choice) = parsed.choices.first() {
                    if let Some(ref text) = choice.delta.content {
                        return Ok(Some(text.clone()));
                    }
                }
            }
        }
    }
    Ok(None)
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
