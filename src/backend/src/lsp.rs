use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

#[derive(Clone, serde::Serialize)]
struct LspDiagnosticPayload {
    uri: String,
    diagnostics: Value,
}

#[allow(clippy::type_complexity)]
pub struct LspClient {
    stdin_tx: mpsc::Sender<Value>,
    request_counter: AtomicU64,
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    open_files: Arc<Mutex<HashMap<String, String>>>,
    shutdown_tx: mpsc::Sender<()>,
}

impl LspClient {
    pub fn start(
        language: &str,
        root_path: &str,
        app_handle: AppHandle,
    ) -> Result<Arc<Self>, String> {
        let root_path_buf = PathBuf::from(root_path);
        let root_canonical = root_path_buf
            .canonicalize()
            .unwrap_or_else(|_| root_path_buf.clone());

        // 1. Resolve language server binaries and arguments
        let (program, args) = match language.to_lowercase().as_str() {
            "rust" => {
                let bin = if cfg!(target_os = "windows") {
                    "rust-analyzer.exe"
                } else {
                    "rust-analyzer"
                };
                (bin.to_string(), vec![])
            }
            "typescript" | "javascript" => {
                if cfg!(target_os = "windows") {
                    (
                        "cmd.exe".to_string(),
                        vec![
                            "/C".to_string(),
                            "typescript-language-server.cmd".to_string(),
                            "--stdio".to_string(),
                        ],
                    )
                } else {
                    (
                        "typescript-language-server".to_string(),
                        vec!["--stdio".to_string()],
                    )
                }
            }
            _ => return Err(format!("Unsupported language server: {}", language)),
        };

        let mut cmd = tokio::process::Command::new(&program);
        cmd.args(&args)
            .current_dir(&root_canonical)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // log startup attempt
        {
            let state = app_handle.state::<crate::AppState>();
            let mut logs = state.logs.lock().unwrap();
            logs.push(format!(
                "LSP [{}]: Spawning language server '{}' with args {:?}",
                language, program, args
            ));
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn language server process: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to open child stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open child stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open child stderr")?;

        let (stdin_tx, mut stdin_rx) = mpsc::channel::<Value>(100);
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        let pending_requests = Arc::new(Mutex::new(HashMap::new()));
        let open_files = Arc::new(Mutex::new(HashMap::new()));

        let client = Arc::new(LspClient {
            stdin_tx,
            request_counter: AtomicU64::new(1),
            pending_requests: pending_requests.clone(),
            open_files: open_files.clone(),
            shutdown_tx,
        });

        // 2. Spawn Stderr Logger Task
        let app_handle_err = app_handle.clone();
        let lang_name_err = language.to_string();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let msg = format!("LSP [{}] stderr: {}", lang_name_err, line);
                let state = app_handle_err.state::<crate::AppState>();
                let mut logs = state.logs.lock().unwrap();
                logs.push(msg);
            }
        });

        // 3. Spawn Stdout Reader Task
        let pending_requests_clone = pending_requests.clone();
        let app_handle_out = app_handle.clone();
        let lang_name_out = language.to_string();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut header_line = String::new();

            loop {
                header_line.clear();
                let mut content_length = None;

                // Read headers until empty line (\r\n)
                loop {
                    header_line.clear();
                    match reader.read_line(&mut header_line).await {
                        Ok(0) => return, // EOF
                        Ok(_) => {
                            let trimmed = header_line.trim();
                            if trimmed.is_empty() {
                                break; // end of headers
                            }
                            if trimmed.to_lowercase().starts_with("content-length:") {
                                if let Some(val_str) = trimmed.split(':').nth(1) {
                                    if let Ok(len) = val_str.trim().parse::<usize>() {
                                        content_length = Some(len);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            let state = app_handle_out.state::<crate::AppState>();
                            let mut logs = state.logs.lock().unwrap();
                            logs.push(format!("LSP [{}] reader read error: {}", lang_name_out, e));
                            return;
                        }
                    }
                }

                let length = match content_length {
                    Some(len) => len,
                    None => {
                        let state = app_handle_out.state::<crate::AppState>();
                        let mut logs = state.logs.lock().unwrap();
                        logs.push(format!(
                            "LSP [{}] reader error: Missing Content-Length header",
                            lang_name_out
                        ));
                        continue;
                    }
                };

                let mut body_bytes = vec![0u8; length];
                if let Err(e) = reader.read_exact(&mut body_bytes).await {
                    let state = app_handle_out.state::<crate::AppState>();
                    let mut logs = state.logs.lock().unwrap();
                    logs.push(format!(
                        "LSP [{}] reader body read error: {}",
                        lang_name_out, e
                    ));
                    return;
                }

                if let Ok(json_val) = serde_json::from_slice::<Value>(&body_bytes) {
                    if let Some(id) = json_val.get("id").and_then(|v| v.as_u64()) {
                        // Response message
                        let mut pending = pending_requests_clone.lock().unwrap();
                        if let Some(tx) = pending.remove(&id) {
                            if let Some(error) = json_val.get("error") {
                                let _ = tx.send(Err(error.to_string()));
                            } else {
                                let result = json_val.get("result").cloned().unwrap_or(Value::Null);
                                let _ = tx.send(Ok(result));
                            }
                        }
                    } else if let Some(method) = json_val.get("method").and_then(|v| v.as_str()) {
                        // Notification message
                        if method == "textDocument/publishDiagnostics" {
                            if let Some(params) = json_val.get("params") {
                                if let Some(uri) = params.get("uri").and_then(|v| v.as_str()) {
                                    if let Some(diags) = params.get("diagnostics") {
                                        let payload = LspDiagnosticPayload {
                                            uri: uri.to_string(),
                                            diagnostics: diags.clone(),
                                        };
                                        let _ = app_handle_out.emit("lsp-diagnostics", payload);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        // 4. Spawn Stdin Writer Task
        let app_handle_in = app_handle.clone();
        let lang_name_in = language.to_string();
        tokio::spawn(async move {
            let mut writer = stdin;
            loop {
                tokio::select! {
                    maybe_msg = stdin_rx.recv() => {
                        match maybe_msg {
                            Some(msg) => {
                                if let Ok(serialized) = serde_json::to_string(&msg) {
                                    let payload = format!(
                                        "Content-Length: {}\r\n\r\n{}",
                                        serialized.len(),
                                        serialized
                                    );
                                    if let Err(e) = writer.write_all(payload.as_bytes()).await {
                                        let state = app_handle_in.state::<crate::AppState>();
                                        let mut logs = state.logs.lock().unwrap();
                                        logs.push(format!("LSP [{}] write error: {}", lang_name_in, e));
                                        break;
                                    }
                                    let _ = writer.flush().await;
                                }
                            }
                            None => break, // channel closed
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                }
            }
        });

        // 5. Spawn Process Monitor (Self-Healing Watchdog)
        let client_weak = Arc::downgrade(&client);
        let lang_name_mon = language.to_string();
        let root_path_mon = root_path.to_string();
        let app_handle_mon = app_handle.clone();
        tokio::spawn(async move {
            let status = child.wait().await;
            let exit_code = match status {
                Ok(s) => s.code().unwrap_or(-1),
                Err(_) => -1,
            };

            // Check if shutdown was requested
            if let Some(client_arc) = client_weak.upgrade() {
                // Not gracefully shutdown, this was a crash!
                let state = app_handle_mon.state::<crate::AppState>();
                {
                    let mut logs = state.logs.lock().unwrap();
                    logs.push(format!(
                        "LSP [{}] CRASHED with exit code {}. Spawning self-healing supervisor...",
                        lang_name_mon, exit_code
                    ));
                }

                // Remove from active clients map first so start command recreates it
                {
                    let mut state_clients = state.lsp_clients.lock().unwrap();
                    if let Some(map) = state_clients.as_mut() {
                        map.remove(&lang_name_mon);
                    }
                }

                // Restart server
                match LspClient::start(&lang_name_mon, &root_path_mon, app_handle_mon.clone()) {
                    Ok(new_client) => {
                        // Re-register in active clients map
                        {
                            let mut state_clients = state.lsp_clients.lock().unwrap();
                            if let Some(map) = state_clients.as_mut() {
                                map.insert(lang_name_mon.clone(), new_client.clone());
                            }
                        }

                        // Re-initialize server
                        let root_uri = format!("file:///{}", root_path_mon.replace('\\', "/"));
                        if let Err(e) = new_client.initialize(&root_uri).await {
                            let mut logs = state.logs.lock().unwrap();
                            logs.push(format!(
                                "LSP [{}] Self-Healing Re-Initialization failed: {}",
                                lang_name_mon, e
                            ));
                            return;
                        }

                        // Re-sync open document states
                        let files = {
                            let files_lock = client_arc.open_files.lock().unwrap();
                            files_lock.clone()
                        };

                        for (path, content) in files {
                            let _ = new_client.file_open(&path, &content).await;
                        }

                        let mut logs = state.logs.lock().unwrap();
                        logs.push(format!(
                            "LSP [{}] Self-Healing recovery complete. Restored {} open document buffers.",
                            lang_name_mon,
                            client_arc.open_files.lock().unwrap().len()
                        ));
                    }
                    Err(e) => {
                        let mut logs = state.logs.lock().unwrap();
                        logs.push(format!(
                            "LSP [{}] Self-Healing recovery failed to restart server: {}",
                            lang_name_mon, e
                        ));
                    }
                }
            }
        });

        Ok(client)
    }

    pub async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.request_counter.fetch_add(1, Ordering::SeqCst);
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending_requests.lock().unwrap();
            pending.insert(id, tx);
        }

        self.stdin_tx
            .send(payload)
            .await
            .map_err(|e| format!("Failed to queue stdin payload request: {}", e))?;

        rx.await.map_err(|e| format!("Request cancelled: {}", e))?
    }

    pub async fn send_notification(&self, method: &str, params: Value) -> Result<(), String> {
        let payload = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });

        self.stdin_tx
            .send(payload)
            .await
            .map_err(|e| format!("Failed to queue stdin payload notification: {}", e))?;

        Ok(())
    }

    pub async fn initialize(&self, root_uri: &str) -> Result<Value, String> {
        let params = json!({
            "processId": std::process::id(),
            "rootUri": root_uri,
            "capabilities": {
                "textDocument": {
                    "synchronization": {
                        "dynamicRegistration": true,
                        "willSave": false,
                        "willSaveWaitUntil": false,
                        "didSave": true
                    },
                    "completion": {
                        "completionItem": {
                            "snippetSupport": true
                        }
                    },
                    "hover": {
                        "contentFormat": ["markdown", "plaintext"]
                    },
                    "definition": {
                        "dynamicRegistration": true
                    }
                }
            }
        });

        let res = self.send_request("initialize", params).await?;
        self.send_notification("initialized", json!({})).await?;
        Ok(res)
    }

    pub async fn file_open(&self, path: &str, content: &str) -> Result<(), String> {
        let uri = format!("file:///{}", path.replace('\\', "/"));
        let params = json!({
            "textDocument": {
                "uri": uri,
                "languageId": match Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("") {
                    "rs" => "rust",
                    "ts" | "tsx" => "typescript",
                    "js" | "jsx" => "javascript",
                    _ => "plaintext"
                },
                "version": 1,
                "text": content
            }
        });

        // Track file in open_files registry for self-healing recoveries
        {
            let mut files = self.open_files.lock().unwrap();
            files.insert(path.to_string(), content.to_string());
        }

        self.send_notification("textDocument/didOpen", params).await
    }

    pub async fn file_change(
        &self,
        path: &str,
        range: Option<Value>,
        text: &str,
    ) -> Result<(), String> {
        let uri = format!("file:///{}", path.replace('\\', "/"));

        let change = if let Some(ref r) = range {
            json!({
                "range": r,
                "text": text
            })
        } else {
            json!({
                "text": text
            })
        };

        let params = json!({
            "textDocument": {
                "uri": uri,
                "version": 2
            },
            "contentChanges": [change]
        });

        // Update stored contents for self-healing registry
        {
            let mut files = self.open_files.lock().unwrap();
            if let Some(content) = files.get_mut(path) {
                if range.is_none() {
                    // Full sync update
                    *content = text.to_string();
                } else {
                    // Quick fallback: for incremental change, we could compute the delta,
                    // but since the file is edited locally, we can let open_files update on save
                    // or let didChange do full update when None is passed.
                    // For safety, if it is incremental edit, we will also sync file state on save.
                }
            }
        }

        self.send_notification("textDocument/didChange", params)
            .await
    }

    pub async fn file_save(&self, path: &str, content: Option<&str>) -> Result<(), String> {
        let uri = format!("file:///{}", path.replace('\\', "/"));
        let params = json!({
            "textDocument": {
                "uri": uri
            }
        });

        if let Some(text) = content {
            let mut files = self.open_files.lock().unwrap();
            files.insert(path.to_string(), text.to_string());
        }

        self.send_notification("textDocument/didSave", params).await
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        // Send shutdown request
        let _ = self.send_request("shutdown", json!({})).await;
        // Send exit notification
        let _ = self.send_notification("exit", json!({})).await;

        // Cancel stdout reader / stdin writer tasks
        let _ = self.shutdown_tx.send(()).await;

        // Clear files and callbacks
        self.open_files.lock().unwrap().clear();
        self.pending_requests.lock().unwrap().clear();

        Ok(())
    }
}
