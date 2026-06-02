# ?? Antigravity Workspace 
**Advanced autonomous development environment with real-time semantic indexing, localized vector storage, and recursive self-healing compilation loops.** 
 
## ??? System Architecture Overview 
* **Frontend Layer**: Developed using **React 19**, **Vite 6**, and **Tailwind CSS v4** [cite: 17-18]. Integrates an advanced **Monaco Editor workbench** powered by `monaco-vscode-api` polyfills to support full extension hosts, custom keybindings, and native PTY terminal interfaces [cite: 27-35]. 
* **Backend Async Kernel**: Programmed entirely in **Rust** running a multi-threaded **Tokio runtime** for deterministic execution speed [cite: 40-42]. All discrete engines are isolated via a modular builder pattern and synced safely via `Arc` and `Mutex` primitives [cite: 43-47]. 
* **Context Engine Framework**: Uses the `notify` crate to catch low-level filesystem modifications (`ReadDirectoryChangesW` on Windows) [cite: 126-127]. Events are debounced over a 500ms temporal window to prevent resource exhaustion [cite: 132-133]. Source trees are parsed into concrete syntax trees using **Tree-Sitter (v0.24.0+)** to isolate standalone function components using zero-copy byte offsets [cite: 135-142]. 
* **Local Embedded Storage**: Implements **sqlite-vec (v0.1.9)** linked statically at build time via `rusqlite` [cite: 160-163]. Embeddings are passed using the `zerocopy` crate directly into virtual `vec0` tables [cite: 165-166]. Computations are hardware-accelerated using AVX2/AVX-512 SIMD intrinsics on the host CPU [cite: 172-175]. 
 
## ?? Workstation Installation Constraints 
* **Enforced Path Location**: The local development engine and target codebase repository must map precisely to: `D:\Project\Antigravity SDK`[cite: 6, 15]. 
* **System Dependencies**: Install the Stable Rust Toolchain (rustup) alongside Node.js (v20 LTS or v22) and the GitHub CLI (gh). 
* **Project Initialization**: Run `npm install` inside the frontend directory wrapper, followed by `cargo build --release` within the backend core kernel to assemble local desktop binaries. 
 
## ??? Core Capabilities 
* **Privileged Server Streaming**: Outbound communication is handled by the Rust backend using `reqwest` to bypass webview CORS restrictions, consuming Gemini's `streamGenerateContent` SSE responses in localized memory chunks [cite: 106-110]. 
* **Self-Healing Loop**: If an executed shell command returns a non-zero exit code, the backend captures the `stderr` buffer, extracts relevant code nodes with Tree-Sitter, dispatches an inference request to Gemini, modifies the source code on disk, and re-executes compilation autonomously [cite: 229-233]. 
