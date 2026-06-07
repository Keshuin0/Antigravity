use chrono::Local;
use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tracing::Subscriber;
use tracing_subscriber::layer::Context;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{reload, EnvFilter, Layer};

// Global AppHandle OnceLock to stream Tauri events.
pub static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

// Global Log Level Reload Handle to change logging levels at runtime.
pub static RELOAD_HANDLE: OnceLock<LogLevelReloadHandle> = OnceLock::new();

pub type LogLevelReloadHandle = reload::Handle<EnvFilter, tracing_subscriber::Registry>;

#[derive(Serialize, Clone, Debug)]
pub struct LogMessage {
    pub timestamp: String,
    pub level: String,
    pub target: String,
    pub message: String,
}

pub struct TelemetryBuffer {
    buffer: Mutex<VecDeque<LogMessage>>,
    limit: usize,
}

impl TelemetryBuffer {
    pub fn new(limit: usize) -> Self {
        Self {
            buffer: Mutex::new(VecDeque::with_capacity(limit)),
            limit,
        }
    }

    pub fn push(&self, msg: LogMessage) {
        let mut lock = self.buffer.lock().unwrap();
        if lock.len() >= self.limit {
            lock.pop_front();
        }
        lock.push_back(msg);
    }

    pub fn get_all(&self) -> Vec<LogMessage> {
        let lock = self.buffer.lock().unwrap();
        lock.iter().cloned().collect()
    }

    pub fn get_all_formatted(&self) -> Vec<String> {
        let lock = self.buffer.lock().unwrap();
        lock.iter()
            .map(|log| {
                let color_code = match log.level.as_str() {
                    "ERROR" => "\u{001b}[31m",
                    "WARN" => "\u{001b}[33m",
                    "INFO" => "\u{001b}[32m",
                    "DEBUG" => "\u{001b}[36m",
                    "TRACE" => "\u{001b}[90m",
                    _ => "",
                };
                format!("{}{}\u{001b}[0m", color_code, log.message)
            })
            .collect()
    }
}

pub struct RotatingFileWriter {
    logs_dir: PathBuf,
    current_date: Option<String>,
    file: Option<File>,
}

impl RotatingFileWriter {
    pub fn new(logs_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&logs_dir);
        Self {
            logs_dir,
            current_date: None,
            file: None,
        }
    }

    pub fn write_log(&mut self, date: &str, line: &str) {
        let should_rotate = match &self.current_date {
            Some(curr) => curr != date,
            None => true,
        };

        if should_rotate {
            self.file = None;
            let filename = format!("antigravity-{}.log", date);
            let filepath = self.logs_dir.join(filename);
            match OpenOptions::new().create(true).append(true).open(&filepath) {
                Ok(file) => {
                    self.file = Some(file);
                    self.current_date = Some(date.to_string());
                }
                Err(e) => {
                    eprintln!("Failed to open log file {:?}: {}", filepath, e);
                }
            }
        }

        if let Some(file) = &mut self.file {
            let _ = writeln!(file, "{}", line);
        }
    }
}

pub struct TelemetryLayer {
    buffer: std::sync::Arc<TelemetryBuffer>,
    file_writer: Mutex<RotatingFileWriter>,
}

impl TelemetryLayer {
    pub fn new(buffer: std::sync::Arc<TelemetryBuffer>, logs_dir: PathBuf) -> Self {
        Self {
            buffer,
            file_writer: Mutex::new(RotatingFileWriter::new(logs_dir)),
        }
    }
}

impl<S> Layer<S> for TelemetryLayer
where
    S: Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        let metadata = event.metadata();
        let level = metadata.level().to_string();
        let target = metadata.target().to_string();

        struct MsgVisitor {
            msg: String,
        }
        impl tracing::field::Visit for MsgVisitor {
            fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
                if field.name() == "message" {
                    self.msg = format!("{:?}", value);
                }
            }
            fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
                if field.name() == "message" {
                    self.msg = value.to_string();
                }
            }
        }

        let mut visitor = MsgVisitor { msg: String::new() };
        event.record(&mut visitor);

        if visitor.msg.is_empty() {
            return;
        }

        let redacted_msg = redact_secrets(&visitor.msg);

        let now = Local::now();
        let timestamp = now.format("%Y-%m-%d %H:%M:%S").to_string();
        let date = now.format("%Y-%m-%d").to_string();

        let log_msg = LogMessage {
            timestamp: timestamp.clone(),
            level: level.clone(),
            target: target.clone(),
            message: redacted_msg.clone(),
        };

        // 1. Store in buffer
        self.buffer.push(log_msg.clone());

        // 2. Write to daily log file (plain-text, strip ANSI codes)
        {
            if let Ok(mut writer) = self.file_writer.lock() {
                let disk_line =
                    format!("[{}] [{}] [{}] {}", timestamp, level, target, redacted_msg);
                writer.write_log(&date, &disk_line);
            }
        }

        // 3. Print to console stdout (ANSI styled)
        let color_code = match level.as_str() {
            "ERROR" => "\u{001b}[31m",
            "WARN" => "\u{001b}[33m",
            "INFO" => "\u{001b}[32m",
            "DEBUG" => "\u{001b}[36m",
            "TRACE" => "\u{001b}[90m",
            _ => "",
        };
        println!(
            "[{}] {}{} [{}]: {}\u{001b}[0m",
            timestamp, color_code, level, target, redacted_msg
        );

        // 4. Send live events to Tauri UI
        if let Some(app_handle) = APP_HANDLE.get() {
            use tauri::Emitter;
            let ansi_message = format!("{}{}\u{001b}[0m", color_code, redacted_msg);
            let _ = app_handle.emit("kernel-log", ansi_message);
            let _ = app_handle.emit("log-message", log_msg);
        }
    }
}

pub fn redact_secrets(msg: &str) -> String {
    let mut result = msg.to_string();

    // Redact Gemini API keys starting with "AIzaSy"
    while let Some(idx) = result.find("AIzaSy") {
        let end_idx = result[idx..]
            .find(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
            .map(|offset| idx + offset)
            .unwrap_or(result.len());

        result.replace_range(idx..end_idx, "[REDACTED]");
    }

    // Redact OpenAI API keys starting with "sk-"
    let mut search_idx = 0;
    while let Some(offset) = result[search_idx..].find("sk-") {
        let idx = search_idx + offset;
        let end_idx = result[idx..]
            .find(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
            .map(|offset| idx + offset)
            .unwrap_or(result.len());

        let key_len = end_idx - idx;
        if key_len >= 20 {
            result.replace_range(idx..end_idx, "[REDACTED]");
            search_idx = idx + 10; // "[REDACTED]" is 10 chars
        } else {
            search_idx = idx + 3; // Skip "sk-"
        }
    }

    result
}

pub fn init_logger(logs_dir: PathBuf, buffer: std::sync::Arc<TelemetryBuffer>) {
    let filter = EnvFilter::new("info");
    let (filter_layer, reload_handle) = reload::Layer::new(filter);

    let telemetry_layer = TelemetryLayer::new(buffer, logs_dir);

    let _ = tracing_subscriber::registry()
        .with(filter_layer)
        .with(telemetry_layer)
        .try_init();

    let _ = RELOAD_HANDLE.set(reload_handle);
}

pub fn set_log_level(level: &str) -> Result<(), String> {
    if let Some(handle) = RELOAD_HANDLE.get() {
        let new_filter = EnvFilter::try_new(level)
            .map_err(|e| format!("Invalid log level filter format: {}", e))?;
        handle
            .reload(new_filter)
            .map_err(|e| format!("Failed to reload log filter: {}", e))?;
        Ok(())
    } else {
        Err("Logger reload handle not initialized".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gemini_key_redaction() {
        let input = "Calling Gemini API with key: AIzaSyD_abc123-xyz_987 in header";
        let expected = "Calling Gemini API with key: [REDACTED] in header";
        assert_eq!(redact_secrets(input), expected);
    }

    #[test]
    fn test_openai_key_redaction() {
        let input =
            "Connecting to OpenAI with token sk-proj-1234abcd5678efgh9012ijklmnop3456... success";
        let expected = "Connecting to OpenAI with token [REDACTED]... success";
        assert_eq!(redact_secrets(input), expected);
    }

    #[test]
    fn test_no_key_redaction() {
        let input = "This log message has no keys. It contains task-123 and ask-something.";
        let expected = "This log message has no keys. It contains task-123 and ask-something.";
        assert_eq!(redact_secrets(input), expected);
    }

    #[test]
    fn test_short_sk_prefix_no_redaction() {
        let input = "The user has sk-sky theme enabled.";
        let expected = "The user has sk-sky theme enabled.";
        assert_eq!(redact_secrets(input), expected);
    }
}
