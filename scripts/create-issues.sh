#!/bin/bash

#############################################################################
# Create GitHub Issues Using REST API
# This script creates all architectural issues with proper relationships
#############################################################################

set -e

REPO_OWNER="Keshuin0"
REPO_NAME="antigravity-workspace"
GITHUB_API="https://api.github.com"

# Check for GitHub token
if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_TOKEN environment variable is not set"
    echo "Please set it: export GITHUB_TOKEN=your_token_here"
    exit 1
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Creating Architectural Issues for Antigravity...${NC}"
echo ""

# Store issue numbers for linking
declare -A ISSUE_NUMBERS

#############################################################################
# Helper function to create an issue
#############################################################################
create_issue() {
    local title="$1"
    local body="$2"
    local milestone="$3"
    local labels="$4"
    
    local json_payload=$(cat <<EOF
{
  "title": "$title",
  "body": "$body",
  "milestone": $milestone,
  "labels": [$labels]
}
EOF
)
    
    response=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "$GITHUB_API/repos/$REPO_OWNER/$REPO_NAME/issues" \
        -d "$json_payload")
    
    issue_number=$(echo "$response" | grep -o '"number": [0-9]*' | head -1 | grep -o '[0-9]*')
    echo "$issue_number"
}

#############################################################################
# PHASE 1: Foundation & Local Compilation System
#############################################################################

echo -e "${YELLOW}[PHASE 1] Foundation & Local Compilation System${NC}"
echo ""

# P1-001
issue_01=$(create_issue \
    "Set up Tauri v2.0 Desktop Application with React 19 Integration" \
    "## Description
Initialize and configure Tauri v2.0 with React 19 for the desktop application.

## Acceptance Criteria
- [ ] Tauri v2.0 project initialized with React 19
- [ ] Build system configured (Vite + Tauri)
- [ ] IPC bridge implemented between frontend and backend
- [ ] Hot reload development environment working
- [ ] Signing/packaging configured for macOS/Windows/Linux
- [ ] GitHub Actions CI/CD pipeline validates builds

## Technical Details
- Tauri v2.0 for cross-platform desktop
- React 19 for UI with Vite bundler
- TypeScript strict mode enabled
- Tailwind CSS v4 for styling

## Related Issues
- Blocks: #2 (Backend implementation)

## References
- [Tauri Documentation](https://tauri.app)
- [React 19 Migration Guide](https://react.dev)" \
    "null" \
    '"epic", "layer:frontend", "layer:backend", "p:high"')

ISSUE_NUMBERS["P1-001"]=$issue_01
echo -e "${GREEN}✓ Created P1-001 (Issue #$issue_01)${NC}"

# P1-002
issue_02=$(create_issue \
    "Implement Async Rust Backend with Tokio Runtime" \
    "## Description
Build the core async Rust backend using Tokio for handling all computational operations.

## Acceptance Criteria
- [ ] Tokio runtime configured with optimal thread pools
- [ ] Command handler framework implemented
- [ ] Error handling and recovery mechanisms in place
- [ ] Database connection pooling configured
- [ ] Graceful shutdown handling
- [ ] Performance benchmarks established

## Technical Details
- Tokio 1.35+ async runtime
- Custom error types with context
- Database connection pooling (sqlx)
- Structured logging with tracing

## Dependencies
- Depends on: #$issue_01 (Tauri setup)
- Blocks: #3, #4, #5 (Phase 2 work)

## References
- [Tokio Documentation](https://tokio.rs)
- [Rust Async Book](https://rust-lang.github.io/async-book/)" \
    "null" \
    '"architecture", "layer:backend", "p:high"')

ISSUE_NUMBERS["P1-002"]=$issue_02
echo -e "${GREEN}✓ Created P1-002 (Issue #$issue_02)${NC}"
echo ""

#############################################################################
# PHASE 2: Context Engine & Semantic Indexing
#############################################################################

echo -e "${YELLOW}[PHASE 2] Context Engine & Semantic Indexing${NC}"
echo ""

# P2-001
issue_03=$(create_issue \
    "Implement File Watcher and Real-time AST Parsing" \
    "## Description
Watch workspace files for changes and parse them into AST trees for analysis.

## Acceptance Criteria
- [ ] File watcher implemented (notify crate)
- [ ] Tree-sitter parser integrated
- [ ] AST cache with invalidation strategy
- [ ] Support for Rust, TypeScript, Python, Go
- [ ] Real-time updates to frontend
- [ ] Performance tested with 10k+ files

## Technical Details
- notify v6+ for file watching
- tree-sitter 0.24+ for AST parsing
- In-memory AST cache with LRU eviction
- Debounced parsing (100ms batches)

## Dependencies
- Depends on: #$issue_02 (Async backend)
- Blocks: #4, #5, #6 (Semantic indexing)

## References
- [Tree-sitter Documentation](https://tree-sitter.github.io)
- [notify Crate](https://github.com/notify-rs/notify)" \
    "null" \
    '"architecture", "layer:backend", "database", "p:high"')

ISSUE_NUMBERS["P2-001"]=$issue_03
echo -e "${GREEN}✓ Created P2-001 (Issue #$issue_03)${NC}"

# P2-002
issue_04=$(create_issue \
    "Build Vector-based Semantic Indexing with sqlite-vec" \
    "## Description
Create embeddings and vector index using sqlite-vec for semantic search capabilities.

## Acceptance Criteria
- [ ] Embedding model integrated (Gemini API)
- [ ] sqlite-vec database schema designed
- [ ] Batch embedding pipeline implemented
- [ ] Vector search queries optimized
- [ ] Cosine similarity ranking working
- [ ] Index compression implemented

## Technical Details
- sqlite-vec 0.1.9+ for vector storage
- Gemini API for embeddings
- Batch processing (32-256 items)
- HNSW index for similarity search
- Approximate search for performance

## Dependencies
- Depends on: #$issue_03 (AST parsing)
- Blocks: #5, #6 (Context retrieval)

## References
- [sqlite-vec Documentation](https://github.com/asg017/sqlite-vec)
- [Vector Search Fundamentals](https://developers.google.com/machine-learning/crash-course)" \
    "null" \
    '"architecture", "layer:backend", "database", "p:critical"')

ISSUE_NUMBERS["P2-002"]=$issue_04
echo -e "${GREEN}✓ Created P2-002 (Issue #$issue_04)${NC}"

# P2-003
issue_05=$(create_issue \
    "Develop Context Retrieval Engine" \
    "## Description
Build hybrid search engine combining BM25 full-text and vector similarity search.

## Acceptance Criteria
- [ ] BM25 full-text index implemented
- [ ] Hybrid ranking algorithm (alpha = 0.4 vector, 0.6 BM25)
- [ ] Query expansion with synonyms
- [ ] Result deduplication logic
- [ ] Multi-field search (code, comments, documentation)
- [ ] Query latency < 100ms for 99th percentile

## Technical Details
- BM25 ranking for keyword relevance
- Cosine similarity for semantic relevance
- Weighted combination for final ranking
- Query parser supporting operators (AND, OR, NOT)
- Caching of frequent queries

## Dependencies
- Depends on: #$issue_04 (Vector indexing)
- Blocks: #7, #8 (Integration phases)

## References
- [BM25 Algorithm](https://en.wikipedia.org/wiki/Okapi_BM25)
- [Hybrid Search Best Practices](https://weaviate.io/blog/hybrid-search)" \
    "null" \
    '"architecture", "layer:backend", "database", "p:high"')

ISSUE_NUMBERS["P2-003"]=$issue_05
echo -e "${GREEN}✓ Created P2-003 (Issue #$issue_05)${NC}"
echo ""

#############################################################################
# PHASE 3: Secure OS Integration & Core Streams
#############################################################################

echo -e "${YELLOW}[PHASE 3] Secure OS Integration & Core Streams${NC}"
echo ""

# P3-001
issue_06=$(create_issue \
    "Integrate Secure OS Credential Access" \
    "## Description
Securely access system credentials and API keys from OS keychains/vaults.

## Acceptance Criteria
- [ ] macOS Keychain integration
- [ ] Windows Credential Manager integration
- [ ] Linux Secret Service integration
- [ ] Encryption at rest for stored credentials
- [ ] Audit logging for credential access
- [ ] Security audit passed (OWASP)

## Technical Details
- keyring-rs crate for cross-platform keychain
- AES-256 encryption for local storage
- Rate limiting on credential reads
- Token refresh handling
- Automatic credential cleanup on exit

## Dependencies
- Depends on: #$issue_05 (Context engine ready)
- Blocks: #7, #8 (Integration)

## References
- [keyring-rs Documentation](https://github.com/hwchen/keyring-rs)
- [OWASP Credential Management](https://cheatsheetseries.owasp.org)" \
    "null" \
    '"security", "layer:backend", "p:critical"')

ISSUE_NUMBERS["P3-001"]=$issue_06
echo -e "${GREEN}✓ Created P3-001 (Issue #$issue_06)${NC}"

# P3-002
issue_07=$(create_issue \
    "Implement IPC Streaming Architecture" \
    "## Description
Build Tauri IPC streaming for real-time responses and large data transfers.

## Acceptance Criteria
- [ ] Streaming protocol designed and implemented
- [ ] Chunked message handling (32KB chunks)
- [ ] Backpressure handling
- [ ] Real-time UI updates via SSE-style messages
- [ ] Error recovery with retry logic
- [ ] Connection pooling for multiple channels

## Technical Details
- Tauri IPC for frontend-backend communication
- Protobuf for message serialization
- Stream multiplexing over single connection
- Automatic reconnection on failure
- WebSocket fallback support

## Dependencies
- Depends on: #$issue_06 (Credentials ready)
- Blocks: #8, #9 (Agentic phase)

## References
- [Tauri IPC Documentation](https://tauri.app/v1/api/js/classes/tauri.window.appwindow)
- [Protocol Buffers Guide](https://developers.google.com/protocol-buffers)" \
    "null" \
    '"architecture", "layer:frontend", "layer:backend", "p:high"')

ISSUE_NUMBERS["P3-002"]=$issue_07
echo -e "${GREEN}✓ Created P3-002 (Issue #$issue_07)${NC}"
echo ""

#############################################################################
# PHASE 4: Agentic Autonomy & Self-Healing Loop
#############################################################################

echo -e "${YELLOW}[PHASE 4] Agentic Autonomy & Self-Healing Loop${NC}"
echo ""

# P4-001
issue_08=$(create_issue \
    "Develop git2-rs Autonomous Engine" \
    "## Description
Build autonomous Git commit generation engine using git2-rs with pattern recognition.

## Acceptance Criteria
- [ ] git2-rs integration for repo analysis
- [ ] Commit pattern recognition (style, scope, message)
- [ ] Autonomous commit message generation
- [ ] Code change analysis and categorization
- [ ] Diff summarization
- [ ] Rollback capability for failed commits

## Technical Details
- git2-rs 0.29+ for Git operations
- Machine learning model for pattern recognition
- Commit message templates database
- Atomic transactions for safety
- Dry-run mode before actual commits

## Dependencies
- Depends on: #$issue_07 (IPC streaming)
- Blocks: #9 (Self-healing loop)

## References
- [git2-rs Documentation](https://docs.rs/git2)
- [Git Internals](https://git-scm.com/book/en/v2/Git-Internals)" \
    "null" \
    '"epic", "layer:backend", "p:critical"')

ISSUE_NUMBERS["P4-001"]=$issue_08
echo -e "${GREEN}✓ Created P4-001 (Issue #$issue_08)${NC}"

# P4-002
issue_09=$(create_issue \
    "Build Self-Healing Loop with Feedback Integration" \
    "## Description
Create feedback loop system for continuous learning and autonomous error recovery.

## Acceptance Criteria
- [ ] Feedback collection mechanism
- [ ] Error pattern analysis
- [ ] Autonomous recovery strategies
- [ ] Learning loop integration
- [ ] Metrics and monitoring dashboard
- [ ] Human-in-the-loop approval system

## Technical Details
- Event sourcing for audit trail
- Metrics collection (Prometheus format)
- Feedback database schema
- Recovery strategy library
- Observability dashboards (Grafana)

## Dependencies
- Depends on: #$issue_08 (Git engine)

## References
- [Event Sourcing Pattern](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Prometheus Instrumentation](https://prometheus.io/docs/)" \
    "null" \
    '"epic", "layer:backend", "testing", "p:critical"')

ISSUE_NUMBERS["P4-002"]=$issue_09
echo -e "${GREEN}✓ Created P4-002 (Issue #$issue_09)${NC}"
echo ""

#############################################################################
# CREATE ISSUE RELATIONSHIPS (Blocking Issues)
#############################################################################

echo -e "${YELLOW}Creating Issue Relationships...${NC}"
echo ""

# Helper to link issues
link_issues() {
    local blocker_num="$1"  # Issue that blocks
    local blocked_num="$2"  # Issue that is blocked
    
    # Add comment to blocked issue mentioning blocker
    local comment_body="This issue is blocked by #$blocker_num and cannot proceed until that is complete."
    
    curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "$GITHUB_API/repos/$REPO_OWNER/$REPO_NAME/issues/$blocked_num/comments" \
        -d "{\"body\": \"$comment_body\"}" > /dev/null
    
    echo -e "${GREEN}✓ Linked #$blocker_num → #$blocked_num${NC}"
}

# Phase 1 dependencies
link_issues $issue_01 $issue_02

# Phase 1 to Phase 2
link_issues $issue_02 $issue_03

# Phase 2 internal dependencies
link_issues $issue_03 $issue_04
link_issues $issue_04 $issue_05

# Phase 2 to Phase 3
link_issues $issue_05 $issue_06

# Phase 3 dependencies
link_issues $issue_06 $issue_07

# Phase 3 to Phase 4
link_issues $issue_07 $issue_08

# Phase 4 dependencies
link_issues $issue_08 $issue_09

echo ""
echo -e "${GREEN}✓ All issue relationships created!${NC}"
echo ""
echo -e "${YELLOW}Issue Summary:${NC}"
echo "  Phase 1: #$issue_01, #$issue_02"
echo "  Phase 2: #$issue_03, #$issue_04, #$issue_05"
echo "  Phase 3: #$issue_06, #$issue_07"
echo "  Phase 4: #$issue_08, #$issue_09"
echo ""
echo "Repository: https://github.com/$REPO_OWNER/$REPO_NAME/issues"
