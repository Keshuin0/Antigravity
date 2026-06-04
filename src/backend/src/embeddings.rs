use reqwest::Client;
use serde::{Deserialize, Serialize};

const MODEL_NAME: &str = "models/text-embedding-004";

#[derive(Serialize)]
struct ContentPart {
    text: String,
}

#[derive(Serialize)]
struct Content {
    parts: Vec<ContentPart>,
}

#[derive(Serialize)]
struct EmbedRequest {
    model: String,
    content: Content,
}

#[derive(Serialize)]
struct BatchEmbedRequest {
    requests: Vec<EmbedRequest>,
}

#[derive(Deserialize)]
struct EmbeddingValues {
    values: Vec<f32>,
}

#[derive(Deserialize)]
struct EmbedResponse {
    embedding: EmbeddingValues,
}

#[derive(Deserialize)]
struct BatchEmbedResponse {
    embeddings: Vec<EmbeddingValues>,
}

fn safe_truncate(text: &str, max_chars: usize) -> &str {
    if text.len() > max_chars {
        match text.char_indices().nth(max_chars) {
            Some((idx, _)) => &text[..idx],
            None => text,
        }
    } else {
        text
    }
}

pub async fn get_embedding(api_key: &crate::security::ObfBox, text: &str) -> Result<Vec<f32>, String> {
    use zeroize::Zeroizing;

    let client = Client::new();
    let url = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";

    let decrypted_key = Zeroizing::new(api_key.decrypt());
    let mut header_val = reqwest::header::HeaderValue::from_bytes(&decrypted_key)
        .map_err(|e| format!("Invalid header value: {}", e))?;
    header_val.set_sensitive(true);

    let truncated = safe_truncate(text, 8000);

    let payload = EmbedRequest {
        model: MODEL_NAME.to_string(),
        content: Content {
            parts: vec![ContentPart {
                text: truncated.to_string(),
            }],
        },
    };

    let response = client
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

    let result: EmbedResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;

    Ok(result.embedding.values)
}

pub async fn get_embeddings_batch(
    api_key: &crate::security::ObfBox,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(vec![]);
    }

    use zeroize::Zeroizing;

    let client = Client::new();
    let url = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents";

    let decrypted_key = Zeroizing::new(api_key.decrypt());
    let mut header_val = reqwest::header::HeaderValue::from_bytes(&decrypted_key)
        .map_err(|e| format!("Invalid header value: {}", e))?;
    header_val.set_sensitive(true);

    let mut results = vec![];

    for chunk in texts.chunks(100) {
        let requests = chunk
            .iter()
            .map(|t| {
                let truncated = safe_truncate(t, 8000);
                EmbedRequest {
                    model: MODEL_NAME.to_string(),
                    content: Content {
                        parts: vec![ContentPart { text: truncated.to_string() }],
                    },
                }
            })
            .collect();

        let payload = BatchEmbedRequest { requests };

        let response = client
            .post(url)
            .header("x-goog-api-key", header_val.clone())
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Network request failed: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let err_text = response.text().await.unwrap_or_default();
            return Err(format!("Gemini API error ({}): {}", status, err_text));
        }

        let result: BatchEmbedResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response JSON: {}", e))?;

        for emb in result.embeddings {
            results.push(emb.values);
        }
    }

    Ok(results)
}
