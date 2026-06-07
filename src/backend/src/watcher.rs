use crate::AppState;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

pub fn clean_unc_path(path: &Path) -> PathBuf {
    let path_str = path.to_string_lossy();
    if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

pub struct WatcherHandle {
    _watcher: RecommendedWatcher,
    pub debounce_abort: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Clone, Serialize)]
struct FileChangeEventPayload {
    path: String,
    kind: String,
    symbols_count: usize,
}

fn should_ignore_path(path: &Path) -> bool {
    for component in path.components() {
        if let Some(name) = component.as_os_str().to_str() {
            let name_lower = name.to_lowercase();
            if name_lower == ".git"
                || name_lower == "node_modules"
                || name_lower == "target"
                || name_lower == "dist"
                || name_lower == ".next"
                || name_lower == "build"
                || name_lower == "package-lock.json"
                || name_lower == "yarn.lock"
                || name_lower == "pnpm-lock.yaml"
            {
                return true;
            }
        }
    }
    false
}

pub fn start_watching(
    workspace_path: &Path,
    app_handle: AppHandle,
) -> Result<WatcherHandle, String> {
    let (tx, mut rx) = mpsc::channel::<notify::Result<Event>>(100);

    // Watch callback that runs in background OS thread
    let tx_clone = tx.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res| {
            let _ = tx_clone.blocking_send(res);
        },
        notify::Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(workspace_path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let workspace_path_buf = workspace_path.to_path_buf();
    let handle_clone = app_handle.clone();

    // Async task to handle events and debounce them
    let debounce_abort = tauri::async_runtime::spawn(async move {
        let mut pending_events: std::collections::HashMap<PathBuf, (Instant, EventKind)> =
            std::collections::HashMap::new();
        let debounce_duration = Duration::from_millis(500);

        loop {
            tokio::select! {
                maybe_event = rx.recv() => {
                    match maybe_event {
                        Some(Ok(event)) => {
                            let paths = event.paths;
                            let kind = event.kind;
                            let now = Instant::now();
                            for path in paths {
                                if should_ignore_path(&path) {
                                    continue;
                                }
                                pending_events.insert(path, (now, kind));
                            }
                        }
                        Some(Err(e)) => {
                            tracing::error!("Watcher encountered filesystem error: {}", e);
                        }
                        None => {
                            break; // Channel closed
                        }
                    }
                }

                _ = tokio::time::sleep(Duration::from_millis(100)) => {
                    if pending_events.is_empty() {
                        continue;
                    }

                    let now = Instant::now();
                    let mut ready_paths = Vec::new();

                    for (path, (last_change, _)) in pending_events.iter() {
                        if now.duration_since(*last_change) >= debounce_duration {
                            ready_paths.push(path.clone());
                        }
                    }

                    if !ready_paths.is_empty() {
                        let mut changes = Vec::new();
                        for path in ready_paths {
                            if let Some((_, kind)) = pending_events.remove(&path) {
                                changes.push((path, kind));
                            }
                        }

                        if let Err(e) = handle_debounced_changes(changes, &handle_clone, &workspace_path_buf).await {
                            tracing::error!("Watcher: Error handling changes: {}", e);
                        }
                    }
                }
            }
        }
    });

    Ok(WatcherHandle {
        _watcher: watcher,
        debounce_abort,
    })
}

async fn handle_debounced_changes(
    changes: Vec<(PathBuf, EventKind)>,
    app_handle: &AppHandle,
    workspace_root: &Path,
) -> Result<(), String> {
    let app_state = app_handle.state::<AppState>();
    let clean_root = clean_unc_path(workspace_root);

    for (path, _kind) in changes {
        let clean_path = clean_unc_path(&path);
        let rel_path = clean_path
            .strip_prefix(&clean_root)
            .unwrap_or(&clean_path)
            .to_string_lossy()
            .to_string();

        let event_kind_str;
        let mut symbols_count = 0;

        if path.exists() {
            event_kind_str = "modify".to_string();

            // Read and re-parse the file for AST Symbol Memory Cache
            if let Ok(content) = std::fs::read_to_string(&path) {
                let symbols = {
                    let mut cache = app_state.symbol_cache.lock().unwrap();
                    match cache.update_file(&path, &content) {
                        Ok(syms) => {
                            symbols_count = syms.len();
                            tracing::info!(
                                "Watcher: AST parsed '{}' (found {} symbols).",
                                rel_path,
                                symbols_count
                            );
                            syms
                        }
                        Err(e) => {
                            tracing::error!(
                                "Watcher: Failed to update AST cache for {}: {}",
                                rel_path,
                                e
                            );
                            continue;
                        }
                    }
                };

                // Bleeding-Edge Pinnacle Choice: Run Smart-Hashed DB upsert and auto-embedding in background
                let api_key_obf = {
                    let key = app_state.api_token.lock().unwrap();
                    key.clone()
                };
                let provider = app_state.llm_provider.lock().unwrap().clone();
                let endpoint = app_state.llm_endpoint.lock().unwrap().clone();
                let model = app_state.llm_model.lock().unwrap().clone();

                let db_conn = app_state.db_conn.clone();
                let app_handle_clone = app_handle.clone();
                let path_clone = path.clone();
                let rel_path_clone = rel_path.clone();

                let last_modified = path
                    .metadata()
                    .and_then(|m| m.modified())
                    .and_then(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .map_err(std::io::Error::other)
                    })
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);

                tokio::spawn(async move {
                    let symbols_to_embed = {
                        let mut db_lock = db_conn.lock().unwrap();
                        if let Some(conn) = db_lock.as_mut() {
                            match crate::db::upsert_file_and_symbols(
                                conn,
                                &path_clone.to_string_lossy(),
                                &content,
                                last_modified,
                                &symbols,
                            ) {
                                Ok(syms) => syms,
                                Err(e) => {
                                    tracing::error!(
                                        "Watcher Database Error: Failed to upsert file: {}",
                                        e
                                    );
                                    return;
                                }
                            }
                        } else {
                            return;
                        }
                    };

                    if symbols_to_embed.is_empty() {
                        return; // Content is unchanged or hash is matched. Skip embedding.
                    }

                    let final_api_key = match api_key_obf {
                        Some(obf) => obf,
                        None => {
                            let key_name = if provider == "openai" {
                                "openai_api_key"
                            } else {
                                "gemini_api_key"
                            };
                            if let Ok(obf) = crate::security::load_secure_token(key_name) {
                                obf
                            } else {
                                let env_name = if provider == "openai" {
                                    "OPENAI_API_KEY"
                                } else {
                                    "GEMINI_API_KEY"
                                };
                                if let Ok(env_key) = std::env::var(env_name) {
                                    crate::security::ObfBox::new(env_key.as_bytes())
                                } else {
                                    tracing::warn!(
                                        "Watcher: Auto-indexing skipped. {} is missing.",
                                        key_name
                                    );
                                    return;
                                }
                            }
                        }
                    };

                    let texts: Vec<String> =
                        symbols_to_embed.iter().map(|s| s.content.clone()).collect();
                    match crate::embeddings::get_embeddings_batch_multiplexed(
                        &provider,
                        endpoint.as_deref(),
                        model.as_deref(),
                        &final_api_key,
                        &texts,
                    )
                    .await
                    {
                        Ok(embeddings) => {
                            let mut db_lock = db_conn.lock().unwrap();
                            if let Some(conn) = db_lock.as_mut() {
                                for (i, sym) in symbols_to_embed.iter().enumerate() {
                                    if i < embeddings.len() {
                                        let _ = crate::db::save_embedding(
                                            conn,
                                            sym.symbol_id,
                                            &embeddings[i],
                                        );
                                    }
                                }

                                // Refresh in-memory SIMD search cache
                                let state_inner = app_handle_clone.state::<AppState>();
                                if let Ok(cache) = crate::db::load_vector_cache(conn) {
                                    let cache_len = cache.len();
                                    *state_inner.vector_cache.lock().unwrap() = cache;
                                    tracing::info!(
                                        "Database: Refreshed SIMD search cache with {} vectors.",
                                        cache_len
                                    );
                                }

                                tracing::info!(
                                    "Watcher: Successfully auto-indexed and embedded {} symbols for '{}'",
                                    symbols_to_embed.len(),
                                    rel_path_clone
                                );

                                // Notify UI to refresh
                                let _ = app_handle_clone.emit("vector-index-updated", ());
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                "Watcher Error: Failed to auto-embed symbols for {}: {}",
                                rel_path_clone,
                                e
                            );
                        }
                    }
                });
            }
        } else {
            event_kind_str = "remove".to_string();

            // Remove from AST symbol cache
            let mut cache = app_state.symbol_cache.lock().unwrap();
            cache.invalidate(&path);

            let log_msg = format!(
                "Watcher: Invalidated symbols for deleted file '{}'.",
                rel_path
            );

            // Pinnacle: Delete from SQLite database and vector table
            let db_conn = app_state.db_conn.clone();
            let mut db_lock = db_conn.lock().unwrap();
            if let Some(conn) = db_lock.as_mut() {
                let raw_path_str = path.to_string_lossy().to_string();
                let path_str = if let Some(stripped) = raw_path_str.strip_prefix(r"\\?\") {
                    stripped.to_string()
                } else {
                    raw_path_str
                };
                let _ = conn.execute(
                    "DELETE FROM vec_symbols WHERE symbol_id IN (SELECT id FROM symbols WHERE file_id = (SELECT id FROM files WHERE path = ?1));",
                    [&path_str],
                );
                let _ = conn.execute("DELETE FROM files WHERE path = ?1;", [&path_str]);

                // Refresh SIMD vector cache here too
                if let Ok(cache) = crate::db::load_vector_cache(conn) {
                    let cache_len = cache.len();
                    *app_state.vector_cache.lock().unwrap() = cache;
                    tracing::info!("Database: Refreshed SIMD search cache after deletion. Remaining: {} vectors.", cache_len);
                }
            }

            tracing::info!("{}", log_msg);

            let _ = app_handle.emit("vector-index-updated", ());
        }

        // Emit the event to the frontend
        let payload = FileChangeEventPayload {
            path: rel_path,
            kind: event_kind_str,
            symbols_count,
        };
        let _ = app_handle.emit("file-change", payload);
    }

    Ok(())
}
