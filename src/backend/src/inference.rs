use serde::{Deserialize, Serialize};
use std::path::Path;
use zeroize::Zeroizing;

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Attachment {
    pub mime_type: String,
    pub data: String,         // Hex/Base64 data or Gemini File URI
    pub path: Option<String>, // Optional local file path for zero-copy native reading
}

#[derive(Serialize, Clone, Debug)]
#[serde(untagged)]
enum GeminiContentPart {
    Text {
        text: String,
    },
    InlineData {
        #[serde(rename = "inlineData")]
        inline_data: InlineData,
    },
    FileData {
        #[serde(rename = "fileData")]
        file_data: FileData,
    },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct InlineData {
    mime_type: String,
    data: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct FileData {
    file_uri: String,
    mime_type: String,
}

#[derive(Serialize)]
struct Content {
    parts: Vec<GeminiContentPart>,
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
    content: serde_json::Value,
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
    stream_generate_content_multiplexed("gemini", None, None, api_key, prompt, None, tx, None).await
}

#[allow(clippy::too_many_arguments)]
pub async fn stream_generate_content_multiplexed(
    provider: &str,
    endpoint: Option<&str>,
    model: Option<&str>,
    api_key: &crate::security::ObfBox,
    prompt: &str,
    attachments: Option<Vec<Attachment>>,
    tx: tokio::sync::mpsc::Sender<String>,
    app_handle: Option<tauri::AppHandle>,
) -> Result<(), String> {
    let start_time = std::time::Instant::now();
    let mut first_token_time: Option<std::time::Instant> = None;
    let mut token_count = 0;

    let client = if provider == "gemini" {
        crate::embeddings::build_http_client(false)
    } else {
        crate::embeddings::build_http_client(crate::embeddings::is_local_endpoint(endpoint))
    };

    let decrypted_key = Zeroizing::new(api_key.decrypt());
    let key_str =
        std::str::from_utf8(&decrypted_key).map_err(|e| format!("Invalid API key: {}", e))?;

    let mut appended_text_context = String::new();
    let mut gemini_parts = vec![GeminiContentPart::Text {
        text: prompt.to_string(),
    }];
    let mut openai_contents = vec![serde_json::json!({
        "type": "text",
        "text": prompt
    })];

    if let Some(ref atts) = attachments {
        for att in atts {
            let (mime, bytes, is_local) = if let Some(ref path_str) = att.path {
                if let Ok(b) = std::fs::read(path_str) {
                    (att.mime_type.clone(), Some(b), true)
                } else {
                    (att.mime_type.clone(), None, false)
                }
            } else {
                let decoded = base64_decode(&att.data).ok();
                (att.mime_type.clone(), decoded, false)
            };

            let is_text = mime.starts_with("text/")
                || mime == "application/json"
                || mime == "application/javascript"
                || mime == "text/plain";

            if is_text {
                if let Some(ref b) = bytes {
                    if let Ok(text_content) = String::from_utf8(b.clone()) {
                        let filename = att
                            .path
                            .as_ref()
                            .and_then(|p| Path::new(p).file_name())
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or_else(|| "attachment".to_string());

                        appended_text_context.push_str(&format!(
                            "\n\n[Attached Document: {}]\n---\n{}\n---\n",
                            filename, text_content
                        ));
                    }
                }
                continue;
            }

            if provider == "gemini" {
                if att
                    .data
                    .starts_with("https://generativelanguage.googleapis.com")
                {
                    gemini_parts.push(GeminiContentPart::FileData {
                        file_data: FileData {
                            file_uri: att.data.clone(),
                            mime_type: mime,
                        },
                    });
                } else if is_local && bytes.is_some() {
                    let base_64 = base64_encode(bytes.as_ref().unwrap());
                    gemini_parts.push(GeminiContentPart::InlineData {
                        inline_data: InlineData {
                            mime_type: mime,
                            data: base_64,
                        },
                    });
                } else if !att.data.is_empty() {
                    gemini_parts.push(GeminiContentPart::InlineData {
                        inline_data: InlineData {
                            mime_type: mime,
                            data: att.data.clone(),
                        },
                    });
                }
            } else {
                // OpenAI / Local VLM
                if mime.starts_with("image/") {
                    let base_64 = if is_local {
                        bytes
                            .as_ref()
                            .map(|b| base64_encode(b))
                            .unwrap_or_else(|| att.data.clone())
                    } else {
                        att.data.clone()
                    };
                    openai_contents.push(serde_json::json!({
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:{};base64,{}", mime, base_64)
                        }
                    }));
                } else {
                    // Option 1 fallback: non-image document attached to local VLM
                    let extracted = if mime == "application/pdf" {
                        if let Some(ref path_str) = att.path {
                            pdf_extract::extract_text(path_str).ok()
                        } else if let Some(ref b) = bytes {
                            pdf_extract::extract_text_from_mem(b).ok()
                        } else {
                            None
                        }
                    } else if let Some(ref b) = bytes {
                        String::from_utf8(b.clone()).ok()
                    } else {
                        None
                    };

                    if let Some(text_content) = extracted {
                        let filename = att
                            .path
                            .as_ref()
                            .and_then(|p| Path::new(p).file_name())
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or_else(|| "attachment".to_string());

                        appended_text_context.push_str(&format!(
                            "\n\n[Attached Document: {}]\n---\n{}\n---\n",
                            filename, text_content
                        ));
                    }
                }
            }
        }
    }

    // Append text context to prompts if any was extracted
    if !appended_text_context.is_empty() {
        if let Some(GeminiContentPart::Text { ref mut text }) = gemini_parts.first_mut() {
            text.push_str(&appended_text_context);
        }
        if let Some(first_content) = openai_contents.first_mut() {
            if let Some(text_val) = first_content.get_mut("text") {
                if let Some(t_str) = text_val.as_str() {
                    let new_text = format!("{}{}", t_str, appended_text_context);
                    *text_val = serde_json::json!(new_text);
                }
            }
        }
    }

    let response = if provider == "gemini" {
        let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:streamGenerateContent";
        let mut header_val = reqwest::header::HeaderValue::from_bytes(&decrypted_key)
            .map_err(|e| format!("Invalid API key header: {}", e))?;
        header_val.set_sensitive(true);

        let payload = GenerateRequest {
            contents: vec![Content {
                parts: gemini_parts,
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
        let mut endpoint_url = endpoint
            .unwrap_or("http://localhost:8000/v1/chat/completions")
            .to_string();
        if !endpoint_url.ends_with("/chat/completions") && !endpoint_url.ends_with("/completions") {
            if endpoint_url.ends_with('/') {
                endpoint_url.push_str("chat/completions");
            } else {
                endpoint_url.push_str("/chat/completions");
            }
        }

        let is_nvidia = endpoint_url.contains("nvidia.com");
        let mut candidate_models = Vec::new();

        if is_nvidia {
            let base_ep = endpoint.unwrap_or("https://integrate.api.nvidia.com/v1");
            let available = get_nvidia_available_models(base_ep, key_str).await;

            // 1. User selected model
            if let Some(user_model) = model {
                if available.contains(&user_model.to_string()) {
                    candidate_models.push(user_model.to_string());
                }
            }

            // 2. Preferred models for the prompt/role
            let preferred = get_nvidia_models_for_prompt(prompt);
            for m in preferred {
                let m_str = m.to_string();
                if available.contains(&m_str) && !candidate_models.contains(&m_str) {
                    candidate_models.push(m_str);
                }
            }

            // 3. Fallback: remaining available models
            for m in &available {
                if !candidate_models.contains(m) {
                    candidate_models.push(m.clone());
                }
            }
        }

        if candidate_models.is_empty() {
            let default_model = model.unwrap_or("nvidia/llama-3.1-inst-70b").to_string();
            candidate_models.push(default_model);
        }

        let mut last_error = String::new();
        let mut response_opt = None;
        let mut used_model_name = String::new();

        for model_name in &candidate_models {
            tracing::info!(
                "NVIDIA/OpenAI: Attempting inference using model: {}",
                model_name
            );

            let payload = OpenAIChatRequest {
                model: model_name.clone(),
                messages: vec![OpenAIChatMessage {
                    role: "user".to_string(),
                    content: serde_json::json!(openai_contents),
                }],
                stream: true,
            };

            let mut req = client.post(&endpoint_url);
            if !key_str.trim().is_empty() {
                req = req.bearer_auth(key_str);
            }

            match req.json(&payload).send().await {
                Ok(res) => {
                    let status = res.status();
                    if status.is_success() {
                        response_opt = Some(res);
                        used_model_name = model_name.clone();
                        break;
                    } else {
                        let err_text = res.text().await.unwrap_or_default();
                        last_error =
                            format!("Model {} failed ({}): {}", model_name, status, err_text);
                        tracing::warn!("{}", last_error);
                    }
                }
                Err(e) => {
                    last_error = format!("Model {} network failure: {}", model_name, e);
                    tracing::warn!("{}", last_error);
                }
            }
        }

        match response_opt {
            Some(res) => {
                tracing::info!(
                    "NVIDIA/OpenAI: Successfully routed to model: {}",
                    used_model_name
                );
                res
            }
            None => {
                return Err(format!(
                    "All candidate models failed on NVIDIA/OpenAI endpoint. Last error: {}",
                    last_error
                ));
            }
        }
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
    let elapsed = first_token_time
        .map(|t| t.elapsed().as_secs_f64())
        .unwrap_or(0.0);
    let tps = if elapsed > 0.0 {
        token_count as f64 / elapsed
    } else {
        0.0
    };
    if let Some(ref handle) = app_handle {
        use tauri::Emitter;
        let _ = handle.emit("llm-tps", tps);
    }

    // Send a final log message to telemetry stream containing metrics
    if let Some(t_time) = first_token_time {
        let ttft = t_time.duration_since(start_time).as_secs_f64();
        let _ = tx
            .send(format!(
                "\n\n[Self-Healing Engine] [Telemetry] TTFT: {:.3}s | Speed: {:.2} tokens/sec",
                ttft, tps
            ))
            .await;
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

fn base64_encode(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose, Engine as _};
    general_purpose::STANDARD.encode(bytes)
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose, Engine as _};
    general_purpose::STANDARD
        .decode(s)
        .map_err(|e| e.to_string())
}

static NVIDIA_MODELS_CACHE: std::sync::OnceLock<std::sync::Mutex<Vec<String>>> =
    std::sync::OnceLock::new();

async fn get_nvidia_available_models(endpoint: &str, api_key: &str) -> Vec<String> {
    let cache = NVIDIA_MODELS_CACHE.get_or_init(|| std::sync::Mutex::new(Vec::new()));
    {
        let guard = cache.lock().unwrap();
        if !guard.is_empty() {
            return guard.clone();
        }
    }

    // Cache is empty, let's fetch it
    let mut base_url = endpoint.to_string();
    if base_url.ends_with("/chat/completions") {
        base_url = base_url.replace("/chat/completions", "");
    }
    if base_url.ends_with("/embeddings") {
        base_url = base_url.replace("/embeddings", "");
    }
    if !base_url.ends_with('/') {
        base_url.push('/');
    }
    let models_url = if base_url.ends_with("/v1/") {
        format!("{}models", base_url)
    } else {
        format!("{}v1/models", base_url)
    };

    let client = crate::embeddings::build_http_client(false);
    let mut req = client.get(&models_url);
    if !api_key.trim().is_empty() {
        req = req.bearer_auth(api_key);
    }

    if let Ok(res) = req.send().await {
        if res.status().is_success() {
            #[derive(Deserialize)]
            struct ModelItem {
                id: String,
            }
            #[derive(Deserialize)]
            struct ModelsResponse {
                data: Vec<ModelItem>,
            }
            if let Ok(result) = res.json::<ModelsResponse>().await {
                let models: Vec<String> = result.data.into_iter().map(|m| m.id).collect();
                let mut guard = cache.lock().unwrap();
                *guard = models.clone();
                return models;
            }
        }
    }

    Vec::new()
}

fn get_nvidia_models_for_prompt(prompt: &str) -> Vec<&'static str> {
    if prompt.contains("Swarm Planner") {
        vec![
            "meta/llama-3.3-70b-instruct",
            "nvidia/llama-3.1-nemotron-51b-instruct",
            "meta/llama-3.1-405b-instruct",
            "mistralai/mistral-large-2-instruct",
            "meta/llama-3.1-70b-instruct",
        ]
    } else if prompt.contains("Architect") {
        vec![
            "meta/llama-3.3-70b-instruct",
            "nvidia/llama-3.1-nemotron-51b-instruct",
            "meta/llama-3.1-70b-instruct",
            "mistralai/mistral-large-2-instruct",
        ]
    } else if prompt.contains("Frontend") || prompt.contains("Backend") {
        vec![
            "deepseek-ai/deepseek-coder-7b-instruct-v1.5",
            "meta/llama-3.3-70b-instruct",
            "meta/llama-3.1-70b-instruct",
            "nvidia/llama-3.1-nemotron-51b-instruct",
        ]
    } else if prompt.contains("QA") {
        vec![
            "meta/llama-3.1-8b-instruct",
            "google/gemma-2-9b-it",
            "google/gemma-2-27b-it",
            "nvidia/nemotron-mini-4b-instruct",
            "meta/llama-3.3-70b-instruct",
        ]
    } else {
        // General Chat / Default
        vec![
            "meta/llama-3.3-70b-instruct",
            "nvidia/llama-3.1-nemotron-51b-instruct",
            "meta/llama-3.1-70b-instruct",
            "meta/llama-3.1-8b-instruct",
        ]
    }
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

    #[tokio::test]
    #[ignore]
    async fn test_live_gemini_connection() {
        let service = "com.antigravity.workspace";
        let keyring_entry = keyring::Entry::new(service, "gemini_api_key").unwrap();
        let key = keyring_entry
            .get_password()
            .expect("Gemini API key not found in keyring");
        let obf = crate::security::ObfBox::new(key.as_bytes());

        let (tx, mut rx) = tokio::sync::mpsc::channel(100);
        let handle = tokio::spawn(async move {
            stream_generate_content_multiplexed(
                "gemini",
                None,
                None,
                &obf,
                "say hello",
                None,
                tx,
                None,
            )
            .await
        });

        let mut response = String::new();
        while let Some(msg) = rx.recv().await {
            response.push_str(&msg);
        }

        let res = handle.await.unwrap();
        assert!(res.is_ok(), "Gemini stream returned error: {:?}", res);
        println!("Gemini response: {}", response);
        assert!(!response.is_empty());
    }
}
