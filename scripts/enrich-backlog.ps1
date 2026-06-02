# Antigravity Workspace - Backlog Reorganization (PowerShell Native)
# Purpose: Enrich existing issues and create new sub-tickets on GitHub.

$REPO_OWNER = "Keshuin0"
$REPO_NAME = "Antigravity"
$REPO = "$REPO_OWNER/$REPO_NAME"

Write-Host "Creating Roadmaps (Milestones)..."

function Get-OrCreateMilestone($title, $due, $desc) {
    # Check if milestone already exists
    $existing = gh api "repos/$REPO/milestones" -q ".[] | select(.title==`"$title``) | .number" | Out-String
    $existing = $existing.Trim()
    if ($existing -ne "") {
        Write-Host "Milestone already exists: $title (No: $existing)"
        return $existing
    }
    $number = gh api "repos/$REPO/milestones" -f title=$title -f description=$desc -f due_on=$due -q ".number" | Out-String
    $number = $number.Trim()
    Write-Host "Created Milestone: $title (No: $number)"
    return $number
}

$M1 = Get-OrCreateMilestone "Phase 1.1: Project Scaffolding & CI Integration" "2026-07-01T23:59:59Z" "Setup Cargo, React, Tailwind, and CI compilation checks."
$M2 = Get-OrCreateMilestone "Phase 1.2: Tauri IPC Bridge & State Harness" "2026-08-01T23:59:59Z" "Implement state lifecycles and router channels."
$M3 = Get-OrCreateMilestone "Phase 2.1: Incremental Watcher & AST Parser" "2026-09-01T23:59:59Z" "Build file watcher, Tree-Sitter integrations, and symbol cache."
$M4 = Get-OrCreateMilestone "Phase 2.2: sqlite-vec Database & Embedding Pipeline" "2026-10-01T23:59:59Z" "Configure sqlite-vec database and Gemini embedding retrieval."
$M5 = Get-OrCreateMilestone "Phase 3.1: OS Credential Keyring & Security" "2026-11-01T23:59:59Z" "Configure keyring access and zero-out secrets in memory."
$M6 = Get-OrCreateMilestone "Phase 3.2: High-Throughput Stream Pipeline" "2026-12-01T23:59:59Z" "Build chunked SSE streaming endpoints."
$M7 = Get-OrCreateMilestone "Phase 4.1: Autonomous Git Engine (git2-rs)" "2027-01-01T23:59:59Z" "Configure git2 staging, conventional commits, and diff parsing."
$M8 = Get-OrCreateMilestone "Phase 4.2: Sandboxed Self-Healing Compiler Loop" "2027-02-01T23:59:59Z" "Build sandboxed build runners and self-debugging compiler loops."

Write-Host "Enriching Existing Issues #2 to #10..."

gh issue edit 2 --title "[EPIC] Setup Tauri v2 Engine with React 19 & Vite 6 UI Pipeline" --milestone "Phase 1.1: Project Scaffolding & CI Integration" --body "## Description
Establish the primary application desktop shell utilizing Tauri v2, React 19, and Vite 6.

## Acceptance Criteria
- [ ] Root Cargo workspace correctly configured
- [ ] React 19 dashboard UI is responsive and styled using Tailwind CSS v4
- [ ] Entry main.tsx loaded correctly in WebView2 wrapper

## Child Sub-tasks
- Linked to: #11 (GitHub Actions CI Setup)"

gh issue edit 3 --title "[ARCH] Configure Async Rust Backend with Builder Pattern & DI" --milestone "Phase 1.2: Tauri IPC Bridge & State Harness" --body "## Description
Implement a modular Rust async state manager. Define application configuration structures and shared container memory.

## Acceptance Criteria
- [ ] AppState constructor implemented using Builder pattern
- [ ] Core services synchronized using Arc and Mutex primitives
- [ ] Tauri state injections verified

## Child Sub-tasks
- Linked to: #12 (Command Router), #13 (Tracing Logger)"

gh issue edit 4 --title "[TASK] Build Real-Time Codebase Watcher with Debouncing" --milestone "Phase 2.1: Incremental Watcher & AST Parser" --body "## Description
Monitor file modifications inside the active workspace directory utilizing the notify crate.

## Acceptance Criteria
- [ ] debouncer catches CRUD events on files
- [ ] Events debounced over 500ms window
- [ ] Output routed cleanly to AST parsing channel"

gh issue edit 5 --title "[ARCH] Implement AST Extraction Layer with Tree-Sitter" --milestone "Phase 2.1: Incremental Watcher & AST Parser" --body "## Description
Parse file modifications using Tree-sitter into concrete syntax trees.

## Acceptance Criteria
- [ ] Support language modules for Rust and TypeScript
- [ ] Zero-copy byte offset parsing implemented
- [ ] Isolates functions and struct definitions from raw file edits

## Child Sub-tasks
- Linked to: #14 (AST Cache)"

gh issue edit 6 --title "[ARCH] Integrate Local Vector Database (sqlite-vec)" --milestone "Phase 2.2: sqlite-vec Database & Embedding Pipeline" --body "## Description
Embed sqlite-vec static tables to support localized semantic code search.

## Acceptance Criteria
- [ ] sqlite-vec dynamically loaded or linked via rusqlite
- [ ] DB schema migrations created and applied
- [ ] cosine similarity searches return relevant nodes

## Child Sub-tasks
- Linked to: #15 (Zero-Copy mapping), #16 (Gemini Embeddings), #17 (AVX2 Speedups)"

gh issue edit 7 --title "[SECURITY] Implement OS-Level Credential Storage (Windows Credential Manager)" --milestone "Phase 3.1: OS Credential Keyring & Security" --body "## Description
Secure local credentials using Windows Credential Manager and macOS Keychain to prevent plain-text secrets exposure.

## Acceptance Criteria
- [ ] Credentials successfully retrieved from native OS keyring via keyring-rs
- [ ] Tokens never print to tracing logs

## Child Sub-tasks
- Linked to: #18 (Zeroize Primitives)"

gh issue edit 8 --title "[ARCH] Optimize Tauri v2 IPC Channels for Real-Time Token Streaming" --milestone "Phase 3.2: High-Throughput Stream Pipeline" --body "## Description
Build low-latency communication pipes for streaming Gemini token outputs into the React UI.

## Acceptance Criteria
- [ ] IPC channel streams chunks safely
- [ ] No UI threading blocks during stream generates

## Child Sub-tasks
- Linked to: #19 (SSE Client)"

gh issue edit 9 --title "[ARCH] Programmatic Git Control Engine via git2-rs" --milestone "Phase 4.1: Autonomous Git Engine (git2-rs)" --body "## Description
Build autonomous git operation controls in Rust using git2-rs to handle version staging and diff generations.

## Acceptance Criteria
- [ ] git2-rs initializes on workspace directory
- [ ] Commits and index updates compile cleanly

## Child Sub-tasks
- Linked to: #20 (AI Commit Messages)"

gh issue edit 10 --title "[ARCH] Develop Sandboxed Execution & Autonomous Self-Healing Repair Loop" --milestone "Phase 4.2: Sandboxed Self-Healing Compiler Loop" --body "## Description
Implement the recursive self-healing loop: execute compilation, catch stderr output, target AST errors, call Gemini for patches, apply edit, and retry compilation.

## Acceptance Criteria
- [ ] Sandbox isolates compile execution paths
- [ ] Error parser maps compile warnings back to precise Tree-sitter scopes
- [ ] Self-repair loop resolves type defects autonomously

## Child Sub-tasks
- Linked to: #21 (Process Sandbox), #22 (Diagnostics Loop)"

Write-Host "Creating 12 New Granular Sub-tickets..."

function Create-Subtask($title, $milestone, $body, $label) {
    gh issue create --title $title --milestone $milestone --body $body --label $label | Out-Host
}

Create-Subtask "[TASK] Configure GitHub Actions CI Workflows for Workspace" "Phase 1.1: Project Scaffolding & CI Integration" "## Description`nBuild clean YAML workflows checking formatting and compilation for both Rust backend and Vite frontend.`n`n## Details`n- Pre-requisites: None`n- Blocked by: #2 (Epic setup)`n- Targets: .github/workflows/rust-ci.yml, .github/workflows/frontend-ci.yml" "layer:devops,testing,p:medium"

Create-Subtask "[TASK] Build Rust IPC Command Router" "Phase 1.2: Tauri IPC Bridge & State Harness" "## Description`nImplement Tauri commands routing calls between React dashboard actions and the Rust state kernel.`n`n## Details`n- Pre-requisites: #3 (Backend State DI)`n- Targets: src/backend/src/main.rs" "layer:backend,architecture,p:high"

Create-Subtask "[TASK] Integrate structured tracing-subscriber logging" "Phase 1.2: Tauri IPC Bridge & State Harness" "## Description`nSet up ANSI-colored console logs and telemetry output streams.`n`n## Details`n- Pre-requisites: #3`n- Targets: src/backend/Cargo.toml" "layer:backend,docs,p:medium"

Create-Subtask "[TASK] Build In-Memory AST Symbol Cache" "Phase 2.1: Incremental Watcher & AST Parser" "## Description`nCreate an LRU-evicting cache container storing parsed AST scopes.`n`n## Details`n- Pre-requisites: #5 (Tree-Sitter parse)`n- Targets: src/backend" "layer:backend,performance,p:high"

Create-Subtask "[TASK] Implement Zero-Copy Vector Column Mapping" "Phase 2.2: sqlite-vec Database & Embedding Pipeline" "## Description`nMap raw float vectors into sqlite-vec virtual columns using the zerocopy crate.`n`n## Details`n- Pre-requisites: #6 (sqlite-vec)`n- Targets: src/backend" "layer:backend,database,p:high"

Create-Subtask "[TASK] Configure Google Gemini API Embedding Pipeline" "Phase 2.2: sqlite-vec Database & Embedding Pipeline" "## Description`nBuild outbound reqwest client mapping AST text scopes to 768-dimension Gemini embeddings.`n`n## Details`n- Pre-requisites: #6" "layer:backend,p:critical"

Create-Subtask "[PERF] Optimize sqlite-vec Queries with AVX2 SIMD Intrinsics" "Phase 2.2: sqlite-vec Database & Embedding Pipeline" "## Description`nVerify CPU compatibility and compile flags to accelerate cosine similarity matching.`n`n## Details`n- Pre-requisites: #6" "performance,layer:backend,p:low"

Create-Subtask "[SECURITY] Implement In-Memory Secrets Zeroize Sanitizer" "Phase 3.1: OS Credential Keyring & Security" "## Description`nIncorporate the zeroize crate to sanitize memory vectors containing the Gemini token after HTTPS payload transmissions.`n`n## Details`n- Pre-requisites: #7" "security,layer:backend,p:high"

Create-Subtask "[TASK] Integrate SSE Client for Gemini token streams" "Phase 3.2: High-Throughput Stream Pipeline" "## Description`nBuild reqwest handler utilizing futures-util to stream SSE response chunks token-by-token from Gemini.`n`n## Details`n- Pre-requisites: #8" "layer:backend,architecture,p:high"

Create-Subtask "[TASK] Generate Conventional Commits via Gemini analysis" "Phase 4.1: Autonomous Git Engine (git2-rs)" "## Description`nPrompt Gemini using diff scopes to generate standardized conventional commits.`n`n## Details`n- Pre-requisites: #9" "layer:backend,p:medium"

Create-Subtask "[TASK] Create Isolated Process Execution Sandbox" "Phase 4.2: Sandboxed Self-Healing Compiler Loop" "## Description`nSpawn compilation commands in thread-safe isolated groups, catching stdout/stderr limits to prevent runaway tasks.`n`n## Details`n- Pre-requisites: #10" "layer:backend,p:critical"

Create-Subtask "[TASK] Implement AST-Targeted Patch Generator" "Phase 4.2: Sandboxed Self-Healing Compiler Loop" "## Description`nExtract exact compiler error lines, isolate the Tree-sitter scope, request the fix, and overwrite the source code file.`n`n## Details`n- Pre-requisites: #10, #21" "layer:backend,p:critical"

Write-Host "Reorganization completed successfully!"
