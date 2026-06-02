#!/bin/bash

#############################################################################
# Create GitHub Repository Milestones Using REST API
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

echo -e "${BLUE}Creating Repository Milestones...${NC}"
echo ""

# Define milestones: title|due_date|description
declare -a MILESTONES=(
    "Phase 1: Foundation & Local Compilation|2026-07-01|Tauri v2 app with React 19, async Rust backend, and local AST indexing capability. Establishes the foundation for all subsequent phases."
    "Phase 2: Context Engine & Semantic Indexing|2026-09-01|Vector database integration with sqlite-vec, semantic search implementation, and context retrieval engine for intelligent code analysis."
    "Phase 3: Secure OS Integration & Core Streams|2026-11-01|Secure credential access from OS keychains, IPC streaming architecture, and real-time data processing pipeline."
    "Phase 4: Agentic Autonomy & Self-Healing Loop|2027-01-01|Autonomous Git engine with git2-rs, pattern recognition, self-healing mechanisms, and feedback integration for continuous learning."
)

CREATED_COUNT=0

for milestone_def in "${MILESTONES[@]}"; do
    IFS='|' read -r title due_date description <<< "$milestone_def"
    
    response=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "$GITHUB_API/repos/$REPO_OWNER/$REPO_NAME/milestones" \
        -d "{
            \"title\": \"$title\",
            \"due_on\": \"${due_date}T23:59:59Z\",
            \"description\": \"$description\"
        }")
    
    # Check if milestone was created successfully
    if echo "$response" | grep -q '"title": "'"$title"'"'; then
        echo -e "${GREEN}✓ Created milestone: $title${NC}"
        echo "  Due: $due_date"
        ((CREATED_COUNT++))
    else
        error_msg=$(echo "$response" | grep -o '"message": "[^"]*' | cut -d'"' -f4)
        if [ -z "$error_msg" ]; then
            error_msg="Unknown error"
        fi
        echo -e "${YELLOW}⚠ Milestone '$title': $error_msg${NC}"
    fi
done

echo ""
echo -e "${GREEN}✓ Successfully created $CREATED_COUNT milestones${NC}"
echo ""
echo "Milestones can be viewed at:"
echo "  https://github.com/$REPO_OWNER/$REPO_NAME/milestones"
