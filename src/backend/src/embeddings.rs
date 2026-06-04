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

pub async fn get_embedding(api_key: &str, text: &str) -> Result<Vec<f32>, String> {
    let client = Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={}",
        api_key
    );

    let payload = EmbedRequest {
        model: MODEL_NAME.to_string(),
        content: Content {
            parts: vec![ContentPart {
                text: text.to_string(),
            }],
        },
    };

    let response = client
        .post(&url)
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
    api_key: &str,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(vec![]);
    }

    let client = Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key={}",
        api_key
    );

    // Gemini batch requests typically have a size limit (e.g. 100 items per request)
    // We chunk the batch to be safe and efficient
    let mut results = vec![];

    for chunk in texts.chunks(100) {
        let requests = chunk
            .iter()
            .map(|t| EmbedRequest {
                model: MODEL_NAME.to_string(),
                content: Content {
                    parts: vec![ContentPart { text: t.clone() }],
                },
            })
            .collect();

        let payload = BatchEmbedRequest { requests };

        let response = client
            .post(&url)
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
