use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use notify::{Watcher, RecommendedWatcher, RecursiveMode, Event, EventKind};
use tokio::sync::mpsc;
use tauri::{AppHandle, Emitter, Manager};
use serde::Serialize;
use crate::AppState;

pub struct WatcherHandle {
    _watcher: RecommendedWatcher,
    pub debounce_abort: tokio::task::JoinHandle<()>,
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
    ).map_err(|e| e.to_string())?;

    watcher
        .watch(workspace_path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let workspace_path_buf = workspace_path.to_path_buf();
    let handle_clone = app_handle.clone();

    // Async task to handle events and debounce them
    let debounce_abort = tokio::spawn(async move {
        let mut pending_events: std::collections::HashMap<PathBuf, (Instant, EventKind)> = std::collections::HashMap::new();
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
                            let state = handle_clone.state::<AppState>();
                            let mut logs = state.logs.lock().unwrap();
                            logs.push(format!("Watcher encountered filesystem error: {}", e));
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
                            let state = handle_clone.state::<AppState>();
                            let mut logs = state.logs.lock().unwrap();
                            logs.push(format!("Watcher: Error handling changes: {}", e));
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

    for (path, _kind) in changes {
        let rel_path = path.strip_prefix(workspace_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        let event_kind_str;
        let mut symbols_count = 0;

        if path.exists() {
            event_kind_str = "modify".to_string();
            // Read and re-parse the file
            if let Ok(content) = std::fs::read_to_string(&path) {
                let mut cache = app_state.symbol_cache.lock().unwrap();
                if let Ok(symbols) = cache.update_file(&path, &content) {
                    symbols_count = symbols.len();
                    let log_msg = format!("Watcher: AST parsed '{}' (found {} symbols).", rel_path, symbols_count);
                    let mut logs = app_state.logs.lock().unwrap();
                    logs.push(log_msg);
                }
            }
        } else {
            event_kind_str = "remove".to_string();
            // Remove from AST symbol cache
            let mut cache = app_state.symbol_cache.lock().unwrap();
            cache.invalidate(&path);
            let log_msg = format!("Watcher: Invalidated symbols for deleted file '{}'.", rel_path);
            let mut logs = app_state.logs.lock().unwrap();
            logs.push(log_msg);
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

