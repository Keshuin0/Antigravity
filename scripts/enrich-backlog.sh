#!/usr/bin/env bash
################################################################################
# ANTIGRAVITY WORKSPACE - NON-DESTRUCTIVE BACKLOG ENRICHMENT
#
# Purpose: Enrich existing issues #2-#10 with detailed technical specs and link
#          them to newly created granular sub-tickets across 8 milestones.
################################################################################

set -euo pipefail

REPO_OWNER="Keshuin0"
REPO_NAME="Antigravity"
GITHUB_API="https://api.github.com"

echo "Creating 8 Granular Roadmaps (Milestones)..."

# Helper to create milestone and return its number
create_milestone() {
    local title="$1"
    local due="$2"
    local desc="$3"
    
    # Check if exists
    local existing=$(gh api "repos/$REPO_OWNER/$REPO_NAME/milestones" -q ".[] | select(.title==\"$title\") | .number")
    if [ -n "$existing" ]; then
        echo "$existing"
        return
    fi
    
    local number=$(gh api "repos/$REPO_OWNER/$REPO_NAME/milestones" \
        -f title="$title" \
        -f description="$desc" \
        -f due_on="$due" \
        -q ".number")
    echo "$number"
}

M1=$(create_milestone "Phase 1.1: Project Scaffolding & CI Integration" "2026-07-01T23:59:59Z" "Setup Cargo, React, Tailwind, and CI compilation checks.")
M2=$(create_milestone "Phase 1.2: Tauri IPC Bridge & State Harness" "2026-08-01T23:59:59Z" "Implement state lifecycles and router channels.")
M3=$(create_milestone "Phase 2.1: Incremental Watcher & AST Parser" "2026-09-01T23:59:59Z" "Build file watcher, Tree-Sitter integrations, and symbol cache.")
M4=$(create_milestone "Phase 2.2: sqlite-vec Database & Embedding Pipeline" "2026-10-01T23:59:59Z" "Configure sqlite-vec database and Gemini embedding retrieval.")
M5=$(create_milestone "Phase 3.1: OS Credential Keyring & Security" "2026-11-01T23:59:59Z" "Configure keyring access and zero-out secrets in memory.")
M6=$(create_milestone "Phase 3.2: High-Throughput Stream Pipeline" "2026-12-01T23:59:59Z" "Build chunked SSE streaming endpoints.")
M7=$(create_milestone "Phase 4.1: Autonomous Git Engine (git2-rs)" "2027-01-01T23:59:59Z" "Configure git2 staging, conventional commits, and diff parsing.")
M8=$(create_milestone "Phase 4.2: Sandboxed Self-Healing Compiler Loop" "2027-02-01T23:59:59Z" "Build sandboxed build runners and self-debugging compiler loops.")

echo "Enriching Existing Issues #2 to #10..."

# Update Issue 2 (Epic)
gh issue edit 2 \
  --title "[EPIC] Setup Tauri v2 Engine with React 19 & Vite 6 UI Pipeline" \
  --milestone "Phase 1.1: Project Scaffolding & CI Integration" \
  --body "## Description
Establish the primary application desktop shell utilizing Tauri v2, React 19, and Vite 6.

## Acceptance Criteria
- [ ] Root Cargo workspace correctly configured
- [ ] React 19 dashboard UI is responsive and styled using Tailwind CSS v4
- [ ] Entry main.tsx loaded correctly in WebView2 wrapper

## Child Sub-tasks
- Linked to: #11 (GitHub Actions CI Setup)"

# Update Issue 3
gh issue edit 3 \
  --title "[ARCH] Configure Async Rust Backend with Builder Pattern & DI" \
  --milestone "Phase 1.2: Tauri IPC Bridge & State Harness" \
  --body "## Description
Implement a modular Rust async state manager. Define application configuration structures and shared container memory.

## Acceptance Criteria
- [ ] AppState constructor implemented using Builder pattern
- [ ] Core services synchronized using Arc and Mutex primitives
- [ ] Tauri state injections verified

## Child Sub-tasks
- Linked to: #12 (Command Router), #13 (Tracing Logger)"

# Update Issue 4
gh issue edit 4 \
  --title "[TASK] Build Real-Time Codebase Watcher with Debouncing" \
  --milestone "Phase 2.1: Incremental Watcher & AST Parser" \
  --body "## Description
Monitor file modifications inside the active workspace directory utilizing the notify crate.

## Acceptance Criteria
- [ ] debouncer catches CRUD events on files
- [ ] Events debounced over 500ms window
- [ ] Output routed cleanly to AST parsing channel"

# Update Issue 5
gh issue edit 5 \
  --title "[ARCH] Implement AST Extraction Layer with Tree-Sitter" \
  --milestone "Phase 2.1: Incremental Watcher & AST Parser" \
  --body "## Description
Parse file modifications using Tree-sitter into concrete syntax trees.

## Acceptance Criteria
- [ ] Support language modules for Rust and TypeScript
- [ ] Zero-copy byte offset parsing implemented
- [ ] Isolates functions and struct definitions from raw file edits

## Child Sub-tasks
- Linked to: #14 (AST Cache)"

# Update Issue 6
gh issue edit 6 \
  --title "[ARCH] Integrate Local Vector Database (sqlite-vec)" \
  --milestone "Phase 2.2: sqlite-vec Database & Embedding Pipeline" \
  --body "## Description
Embed sqlite-vec static tables to support localized semantic code search.

## Acceptance Criteria
- [ ] sqlite-vec dynamically loaded or linked via rusqlite
- [ ] DB schema migrations created and applied
- [ ] cosine similarity searches return relevant nodes

## Child Sub-tasks
- Linked to: #15 (Zero-Copy mapping), #16 (Gemini Embeddings), #17 (AVX2 Speedups)"

# Update Issue 7
gh issue edit 7 \
  --title "[SECURITY] Implement OS-Level Credential Storage (Windows Credential Manager)" \
  --milestone "Phase 3.1: OS Credential Keyring & Security" \
  --body "## Description
Secure local credentials using Windows Credential Manager and macOS Keychain to prevent plain-text secrets exposure.

## Acceptance Criteria
- [ ] Credentials successfully retrieved from native OS keyring via keyring-rs
- [ ] Tokens never print to tracing logs

## Child Sub-tasks
- Linked to: #18 (Zeroize Primitives)"

# Update Issue 8
gh issue edit 8 \
  --title "[ARCH] Optimize Tauri v2 IPC Channels for Real-Time Token Streaming" \
  --milestone "Phase 3.2: High-Throughput Stream Pipeline" \
  --body "## Description
Build low-latency communication pipes for streaming Gemini token outputs into the React UI.

## Acceptance Criteria
- [ ] IPC channel streams chunks safely
- [ ] No UI threading blocks during stream generates

## Child Sub-tasks
- Linked to: #19 (SSE Client)"

# Update Issue 9
gh issue edit 9 \
  --title "[ARCH] Programmatic Git Control Engine via git2-rs" \
  --milestone "Phase 4.1: Autonomous Git Engine (git2-rs)" \
  --body "## Description
Build autonomous git operation controls in Rust using git2-rs to handle version staging and diff generations.

## Acceptance Criteria
- [ ] git2-rs initializes on workspace directory
- [ ] Commits and index updates compile cleanly

## Child Sub-tasks
- Linked to: #20 (AI Commit Messages)"

# Update Issue 10
gh issue edit 10 \
  --title "[ARCH] Develop Sandboxed Execution & Autonomous Self-Healing Repair Loop" \
  --milestone "Phase 4.2: Sandboxed Self-Healing Compiler Loop" \
  --body "## Description
Implement the recursive self-healing loop: execute compilation, catch stderr output, target AST errors, call Gemini for patches, apply edit, and retry compilation.

## Acceptance Criteria
- [ ] Sandbox isolates compile execution paths
- [ ] Error parser maps compile warnings back to precise Tree-sitter scopes
- [ ] Self-repair loop resolves type defects autonomously

## Child Sub-tasks
- Linked to: #21 (Process Sandbox), #22 (Diagnostics Loop)"

echo "Creating 12 New Granular Sub-tickets..."

# 11: CI Actions
gh issue create \
  --title "[TASK] Configure GitHub Actions CI Workflows for Workspace" \
  --milestone "Phase 1.1: Project Scaffolding & CI Integration" \
  --body "## Description
Build clean YAML workflows checking formatting and compilation for both Rust backend and Vite frontend.

## Details
- Pre-requisites: None
- Blocked by: #2 (Epic setup)
- Targets: .github/workflows/rust-ci.yml, .github/workflows/frontend-ci.yml" \
  --label "layer:devops,testing,p:medium"

# 12: Command Router
gh issue create \
  --title "[TASK] Build Rust IPC Command Router" \
  --milestone "Phase 1.2: Tauri IPC Bridge & State Harness" \
  --body "## Description
Implement Tauri commands routing calls between React dashboard actions and the Rust state kernel.

## Details
- Pre-requisites: #3 (Backend State DI)
- Targets: src/backend/src/main.rs" \
  --label "layer:backend,architecture,p:high"

# 13: Tracing Logger
gh issue create \
  --title "[TASK] Integrate structured tracing-subscriber logging" \
  --milestone "Phase 1.2: Tauri IPC Bridge & State Harness" \
  --body "## Description
Set up ANSI-colored console logs and telemetry output streams.

## Details
- Pre-requisites: #3
- Targets: src/backend/Cargo.toml" \
  --label "layer:backend,docs,p:medium"

# 14: AST Cache
gh issue create \
  --title "[TASK] Build In-Memory AST Symbol Cache" \
  --milestone "Phase 2.1: Incremental Watcher & AST Parser" \
  --body "## Description
Create an LRU-evicting cache container storing parsed AST scopes.

## Details
- Pre-requisites: #5 (Tree-Sitter parse)
- Targets: src/backend" \
  --label "layer:backend,performance,p:high"

# 15: Zero-Copy Vector mapping
gh issue create \
  --title "[TASK] Implement Zero-Copy Vector Column Mapping" \
  --milestone "Phase 2.2: sqlite-vec Database & Embedding Pipeline" \
  --body "## Description
Map raw float vectors into sqlite-vec virtual columns using the zerocopy crate.

## Details
- Pre-requisites: #6 (sqlite-vec)
- Targets: src/backend" \
  --label "layer:backend,database,p:high"

# 16: Gemini Embeddings
gh issue create \
  --title "[TASK] Configure Google Gemini API Embedding Pipeline" \
  --milestone "Phase 2.2: sqlite-vec Database & Embedding Pipeline" \
  --body "## Description
Build outbound reqwest client mapping AST text scopes to 768-dimension Gemini embeddings.

## Details
- Pre-requisites: #6" \
  --label "layer:backend,p:critical"

# 17: AVX2 SIMD Speedups
gh issue create \
  --title "[PERF] Optimize sqlite-vec Queries with AVX2 SIMD Intrinsics" \
  --milestone "Phase 2.2: sqlite-vec Database & Embedding Pipeline" \
  --body "## Description
Verify CPU compatibility and compile flags to accelerate cosine similarity matching.

## Details
- Pre-requisites: #6" \
  --label "performance,layer:backend,p:low"

# 18: Zeroize Primitives
gh issue create \
  --title "[SECURITY] Implement In-Memory Secrets Zeroize Sanitizer" \
  --milestone "Phase 3.1: OS Credential Keyring & Security" \
  --body "## Description
Incorporate the zeroize crate to sanitize memory vectors containing the Gemini token after HTTPS payload transmissions.

## Details
- Pre-requisites: #7" \
  --label "security,layer:backend,p:high"

# 19: Stream generate
gh issue create \
  --title "[TASK] Integrate SSE Client for Gemini token streams" \
  --milestone "Phase 3.2: High-Throughput Stream Pipeline" \
  --body "## Description
Build reqwest handler utilizing futures-util to stream SSE response chunks token-by-token from Gemini.

## Details
- Pre-requisites: #8" \
  --label "layer:backend,architecture,p:high"

# 20: AI Commit Messages
gh issue create \
  --title "[TASK] Generate Conventional Commits via Gemini analysis" \
  --milestone "Phase 4.1: Autonomous Git Engine (git2-rs)" \
  --body "## Description
Prompt Gemini using diff scopes to generate standardized conventional commits.

## Details
- Pre-requisites: #9" \
  --label "layer:backend,p:medium"

# 21: Sandbox Shell Exec
gh issue create \
  --title "[TASK] Create Isolated Process Execution Sandbox" \
  --milestone "Phase 4.2: Sandboxed Self-Healing Compiler Loop" \
  --body "## Description
Spawn compilation commands in thread-safe isolated groups, catching stdout/stderr limits to prevent runaway tasks.

## Details
- Pre-requisites: #10" \
  --label "layer:backend,p:critical"

# 22: Diagnostics Loop
gh issue create \
  --title "[TASK] Implement AST-Targeted Patch Generator" \
  --milestone "Phase 4.2: Sandboxed Self-Healing Compiler Loop" \
  --body "## Description
Extract exact compiler error lines, isolate the Tree-sitter scope, request the fix, and overwrite the source code file.

## Details
- Pre-requisites: #10, #21" \
  --label "layer:backend,p:critical"

echo "Reorganization completed successfully!"
