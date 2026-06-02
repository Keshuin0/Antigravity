# ?? Security Policy 
 
## Vulnerability Disclosure Protocol 
Do not open public repository issues for suspected security exploits. Direct all reproduction vectors, error traces, and sandbox bypass details to: `dev@antigravity-workspace.local`. 
 
## Cryptographic Credential Isolation 
Sensitive workspace credentials-specifically the Gemini API token-must never be saved to plain text configuration files, committed to git history, or exposed to browser-side webview environments via `localStorage` [cite: 94-96]. Credential management is securely routed to the host operating system's native security daemon (Windows Credential Manager) using the `keyring` Rust crate [cite: 97-101]. Password values are pulled directly into short-lived Rust memory vectors right before dispatching HTTPS transport payloads[cite: 104]. 
