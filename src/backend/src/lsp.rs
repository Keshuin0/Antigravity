use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[cfg(target_os = "windows")]
mod win_job {
    use std::os::raw::c_void;

    #[repr(C)]
    #[allow(non_camel_case_types)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        active_process_limit: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit_flags: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    #[allow(non_camel_case_types)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        basic_limit_information: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        io_info: [u8; 48],
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_limit: usize,
        peak_job_memory_limit: usize,
    }

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x00002000;
    const JOB_OBJECT_INFO_CLASS_EXTENDED_LIMIT_INFORMATION: i32 = 9;

    extern "system" {
        fn CreateJobObjectW(lpJobAttributes: *mut c_void, lpName: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            hJob: *mut c_void,
            JobObjectInformationClass: i32,
            lpJobObjectInformation: *const c_void,
            cbJobObjectInformationLength: u32,
        ) -> i32;
        fn AssignProcessToJobObject(hJob: *mut c_void, hProcess: *mut c_void) -> i32;
        fn CloseHandle(hObject: *mut c_void) -> i32;
    }

    pub struct JobObject {
        handle: *mut c_void,
    }

    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}

    impl JobObject {
        pub fn new() -> Result<Self, String> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
            if handle.is_null() {
                return Err("Failed to create Job Object".to_string());
            }

            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
                basic_limit_information: JOBOBJECT_BASIC_LIMIT_INFORMATION {
                    active_process_limit: 0,
                    minimum_working_set_size: 0,
                    maximum_working_set_size: 0,
                    active_process_limit_flags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    affinity: 0,
                    priority_class: 0,
                    scheduling_class: 0,
                },
                io_info: [0u8; 48],
                process_memory_limit: 0,
                job_memory_limit: 0,
                peak_process_memory_limit: 0,
                peak_job_memory_limit: 0,
            };

            let success = unsafe {
                SetInformationJobObject(
                    handle,
                    JOB_OBJECT_INFO_CLASS_EXTENDED_LIMIT_INFORMATION,
                    &mut info as *mut _ as *const c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };

            if success == 0 {
                unsafe { CloseHandle(handle) };
                return Err("Failed to set Job Object limits".to_string());
            }

            Ok(JobObject { handle })
        }

        pub fn assign_process(&self, process_handle: *mut c_void) -> Result<(), String> {
            let success = unsafe { AssignProcessToJobObject(self.handle, process_handle) };
            if success == 0 {
                return Err("Failed to assign process to Job Object".to_string());
            }
            Ok(())
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

fn which_binary(name: &str) -> Option<PathBuf> {
    if let Ok(path_env) = std::env::var("PATH") {
        for path in std::env::split_paths(&path_env) {
            let bin_path = path.join(name);
            if bin_path.exists() {
                return Some(bin_path);
            }
        }
    }
    None
}

fn resolve_rust_analyzer_path() -> PathBuf {
    if which_binary("rust-analyzer.exe").is_some() {
        return PathBuf::from("rust-analyzer.exe");
    }
    let local_path = PathBuf::from(r"D:\Softwares\Installed\Rust\.cargo\bin\rust-analyzer.exe");
    if local_path.exists() {
        return local_path;
    }
    PathBuf::from("rust-analyzer")
}

fn resolve_typescript_server_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let bin_name = if cfg!(target_os = "windows") {
        "typescript-language-server.cmd"
    } else {
        "typescript-language-server"
    };
    if which_binary(bin_name).is_some() {
        return Ok(PathBuf::from(bin_name));
    }

    let local_servers_dir = PathBuf::from(r"D:\Softwares\Installed\Antigravity\lsp-servers\ts-lsp");
    let local_bin_path = if cfg!(target_os = "windows") {
        local_servers_dir.join(r"node_modules\.bin\typescript-language-server.cmd")
    } else {
        local_servers_dir.join("node_modules/.bin/typescript-language-server")
    };

    if local_bin_path.exists() {
        return Ok(local_bin_path);
    }

    // Auto-install TS Server locally
    {
        let state = app_handle.state::<crate::AppState>();
        let mut logs = state.logs.lock().unwrap();
        logs.push("LSP [typescript]: typescript-language-server not found in PATH. Initiating automatic local installation...".to_string());
    }

    let _ = std::fs::create_dir_all(&local_servers_dir);
    let npm_bin = if cfg!(target_os = "windows") {
        let local_npm = PathBuf::from(r"D:\Softwares\Installed\NodeJS\npm.cmd");
        if local_npm.exists() {
            local_npm
        } else {
            PathBuf::from("npm.cmd")
        }
    } else {
        PathBuf::from("npm")
    };

    let mut child = std::process::Command::new(&npm_bin)
        .args(&[
            "install",
            "--prefix",
            &local_servers_dir.to_string_lossy(),
            "typescript-language-server",
            "typescript",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn npm installer: {}", e))?;

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for npm installer: {}", e))?;

    if status.success() && local_bin_path.exists() {
        let state = app_handle.state::<crate::AppState>();
        let mut logs = state.logs.lock().unwrap();
        logs.push("LSP [typescript]: Automatic local installation completed successfully.".to_string());
        Ok(local_bin_path)
    } else {
        Err(format!(
            "Failed to auto-install typescript-language-server. Exit code: {:?}",
            status.code()
        ))
    }
}

fn apply_incremental_edit(content: &mut String, range_val: &Value, new_text: &str) -> Result<(), String> {
    let start_line = range_val.get("start").and_then(|pos| pos.get("line")).and_then(|v| v.as_u64()).ok_or("Invalid range start line")? as usize;
    let start_char = range_val.get("start").and_then(|pos| pos.get("character")).and_then(|v| v.as_u64()).ok_or("Invalid range start character")? as usize;
    let end_line = range_val.get("end").and_then(|pos| pos.get("line")).and_then(|v| v.as_u64()).ok_or("Invalid range end line")? as usize;
    let end_char = range_val.get("end").and_then(|pos| pos.get("character")).and_then(|v| v.as_u64()).ok_or("Invalid range end character")? as usize;

    let lines: Vec<&str> = content.split('\n').collect();

    if start_line >= lines.len() || end_line >= lines.len() {
        return Err("Edit coordinates out of bounds".to_string());
    }

    let start_byte = utf16_char_to_utf8_byte_offset(lines[start_line], start_char)?;
    let end_byte = utf16_char_to_utf8_byte_offset(lines[end_line], end_char)?;

    let mut new_content = String::new();
    for i in 0..start_line {
        new_content.push_str(lines[i]);
        new_content.push('\n');
    }

    let start_line_str = lines[start_line];
    new_content.push_str(&start_line_str[..start_byte]);
    new_content.push_str(new_text);

    let end_line_str = lines[end_line];
    new_content.push_str(&end_line_str[end_byte..]);

    for i in (end_line + 1)..lines.len() {
        new_content.push('\n');
        new_content.push_str(lines[i]);
    }

    *content = new_content;
    Ok(())
}

fn utf16_char_to_utf8_byte_offset(line: &str, utf16_char_offset: usize) -> Result<usize, String> {
    let mut utf16_count = 0;
    let mut byte_count = 0;

    for c in line.chars() {
        if utf16_count >= utf16_char_offset {
            break;
        }
        utf16_count += c.len_utf16();
        byte_count += c.len_utf8();
    }

    Ok(byte_count)
}
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
    #[cfg(target_os = "windows")]
    _job_object: Option<win_job::JobObject>,
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

        // 1. Resolve language server binaries and arguments dynamically
        let (program, args) = match language.to_lowercase().as_str() {
            "rust" => {
                let bin_path = resolve_rust_analyzer_path();
                (bin_path.to_string_lossy().to_string(), vec![])
            }
            "typescript" | "javascript" => {
                let bin_path = resolve_typescript_server_path(&app_handle)?;
                let bin_str = bin_path.to_string_lossy().to_string();
                if bin_str.ends_with(".cmd") {
                    (
                        "cmd.exe".to_string(),
                        vec!["/C".to_string(), bin_str, "--stdio".to_string()],
                    )
                } else {
                    (bin_str, vec!["--stdio".to_string()])
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

        #[cfg(target_os = "windows")]
        let job_object = match win_job::JobObject::new() {
            Ok(job) => {
                use std::os::windows::io::AsRawHandle;
                if let Some(raw_handle) = child.raw_handle() {
                    let _ = job.assign_process(raw_handle as *mut std::os::raw::c_void);
                }
                Some(job)
            }
            Err(e) => {
                let state = app_handle.state::<crate::AppState>();
                let mut logs = state.logs.lock().unwrap();
                logs.push(format!("LSP warning: failed to create process sandbox: {}", e));
                None
            }
        };

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
            #[cfg(target_os = "windows")]
            _job_object: job_object,
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
                        map.remove(&(root_path_mon.clone(), lang_name_mon.clone()));
                    }
                }

                // Restart server
                match LspClient::start(&lang_name_mon, &root_path_mon, app_handle_mon.clone()) {
                    Ok(new_client) => {
                        // Re-register in active clients map
                        {
                            let mut state_clients = state.lsp_clients.lock().unwrap();
                            if let Some(map) = state_clients.as_mut() {
                                map.insert((root_path_mon.clone(), lang_name_mon.clone()), new_client.clone());
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
                    },
                    "formatting": {
                        "dynamicRegistration": true
                    },
                    "references": {
                        "dynamicRegistration": true
                    },
                    "rename": {
                        "dynamicRegistration": true,
                        "prepareSupport": true
                    },
                    "codeAction": {
                        "dynamicRegistration": true,
                        "codeActionLiteralSupport": {
                            "codeActionKind": {
                                "valueSet": ["quickfix", "refactor"]
                            }
                        }
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
                if let Some(ref r) = range {
                    if let Err(e) = apply_incremental_edit(content, r, text) {
                        let _ = self.send_notification("telemetry/event", json!({
                            "type": "error",
                            "message": format!("LSP Incremental patch failed: {}", e)
                        }));
                    }
                } else {
                    // Full sync update
                    *content = text.to_string();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_incremental_delta_patcher() {
        let mut content = "line one\nline two\nline three".to_string();
        let range = serde_json::json!({
            "start": { "line": 1, "character": 5 },
            "end": { "line": 1, "character": 8 }
        });
        apply_incremental_edit(&mut content, &range, "new").unwrap();
        assert_eq!(content, "line one\nline new\nline three");
    }

    #[test]
    fn test_utf16_to_utf8_offset() {
        let emoji_line = "hello 👋 world";
        // 👋 is a 4-byte UTF-8 character, but 2-unit UTF-16 surrogate pair
        // "h", "e", "l", "l", "o", " " (6 chars)
        // 👋 start index: 6 in UTF-16, 6 in UTF-8
        let byte_offset_start = utf16_char_to_utf8_byte_offset(emoji_line, 6).unwrap();
        assert_eq!(byte_offset_start, 6);

        // 👋 end index: 8 in UTF-16, 10 in UTF-8 (since 👋 is 4 bytes)
        let byte_offset_end = utf16_char_to_utf8_byte_offset(emoji_line, 8).unwrap();
        assert_eq!(byte_offset_end, 10);
    }
}

