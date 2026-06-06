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

#[derive(Serialize)]
struct OpenAIEmbedRequest {
    input: serde_json::Value,
    model: String,
}

#[derive(Deserialize)]
struct OpenAIEmbedData {
    embedding: Vec<f32>,
    index: usize,
}

#[derive(Deserialize)]
struct OpenAIEmbedResponse {
    data: Vec<OpenAIEmbedData>,
}

pub fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .tcp_keepalive(Some(std::time::Duration::from_secs(60)))
        .pool_idle_timeout(Some(std::time::Duration::from_secs(90)))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
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

pub async fn get_embedding(
    api_key: &crate::security::ObfBox,
    text: &str,
) -> Result<Vec<f32>, String> {
    use zeroize::Zeroizing;

    let client = build_http_client();
    let url =
        "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";

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

    let client = build_http_client();
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
                        parts: vec![ContentPart {
                            text: truncated.to_string(),
                        }],
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

pub async fn get_embedding_multiplexed(
    provider: &str,
    endpoint: Option<&str>,
    model: Option<&str>,
    api_key: &crate::security::ObfBox,
    text: &str,
) -> Result<Vec<f32>, String> {
    if provider == "gemini" {
        get_embedding(api_key, text).await
    } else {
        let endpoint_url = endpoint.unwrap_or("http://localhost:8000/v1/embeddings");
        let model_name = model.unwrap_or("nvidia/embeddings-nv-embed-qa-4");

        let client = build_http_client();
        use zeroize::Zeroizing;
        let decrypted_key = Zeroizing::new(api_key.decrypt());
        let key_str = std::str::from_utf8(&decrypted_key)
            .map_err(|e| format!("Failed to parse API key as UTF-8: {}", e))?;

        let mut req = client.post(endpoint_url);
        if !key_str.trim().is_empty() {
            req = req.bearer_auth(key_str);
        }

        let payload = OpenAIEmbedRequest {
            input: serde_json::json!(text),
            model: model_name.to_string(),
        };

        let response = req
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Network request failed: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let err_text = response.text().await.unwrap_or_default();
            return Err(format!("OpenAI Embeddings API error ({}): {}", status, err_text));
        }

        let result: OpenAIEmbedResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse OpenAI Embeddings response JSON: {}", e))?;

        if result.data.is_empty() {
            return Err("OpenAI Embeddings response returned empty data array".to_string());
        }

        let mut sorted_data = result.data;
        sorted_data.sort_by_key(|d| d.index);

        Ok(sorted_data[0].embedding.clone())
    }
}

pub async fn get_embeddings_batch_multiplexed(
    provider: &str,
    endpoint: Option<&str>,
    model: Option<&str>,
    api_key: &crate::security::ObfBox,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(vec![]);
    }

    if provider == "gemini" {
        get_embeddings_batch(api_key, texts).await
    } else {
        let endpoint_url = endpoint.unwrap_or("http://localhost:8000/v1/embeddings");
        let model_name = model.unwrap_or("nvidia/embeddings-nv-embed-qa-4");

        let client = build_http_client();
        use zeroize::Zeroizing;
        let decrypted_key = Zeroizing::new(api_key.decrypt());
        let key_str = std::str::from_utf8(&decrypted_key)
            .map_err(|e| format!("Failed to parse API key as UTF-8: {}", e))?;

        let mut results = vec![];

        for chunk in texts.chunks(100) {
            let mut req = client.post(endpoint_url);
            if !key_str.trim().is_empty() {
                req = req.bearer_auth(key_str);
            }

            let payload = OpenAIEmbedRequest {
                input: serde_json::json!(chunk),
                model: model_name.to_string(),
            };

            let response = req
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("Network request failed: {}", e))?;

            let status = response.status();
            if !status.is_success() {
                let err_text = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI Embeddings API error ({}): {}", status, err_text));
            }

            let result: OpenAIEmbedResponse = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse OpenAI Embeddings response JSON: {}", e))?;

            let mut chunk_results = result.data;
            chunk_results.sort_by_key(|d| d.index);

            if chunk_results.len() != chunk.len() {
                return Err(format!(
                    "Mismatch in embeddings result length. Sent {}, received {}",
                    chunk.len(),
                    chunk_results.len()
                ));
            }

            for item in chunk_results {
                results.push(item.embedding);
            }
        }

        Ok(results)
    }
}

