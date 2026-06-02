#!/bin/bash

#############################################################################
# Create GitHub Repository Labels Using REST API
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

echo -e "${BLUE}Creating Repository Labels...${NC}"
echo ""

# Define labels: name|color|description
declare -a LABELS=(
    "epic|1a76b3|Epic-level work spanning multiple phases"
    "architecture|e11d21|Architectural decision or system design"
    "layer:backend|fc2929|Backend/Server layer work"
    "layer:frontend|0052cc|Frontend/UI layer work"
    "layer:devops|5319e7|DevOps/Infrastructure work"
    "security|d73a4a|Security-related work"
    "performance|fbca04|Performance optimization"
    "database|bfd4f2|Database schema or optimization"
    "testing|c2e0c6|Testing and test coverage"
    "docs|0075ca|Documentation"
    "blocked|b60205|Blocked/Cannot progress"
    "p:critical|ee0701|Critical priority - must be done ASAP"
    "p:high|ff9800|High priority - important"
    "p:medium|ffeb3b|Medium priority - should be done"
    "p:low|4caf50|Low priority - nice to have"
)

CREATED_COUNT=0

for label_def in "${LABELS[@]}"; do
    IFS='|' read -r name color description <<< "$label_def"
    
    response=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "$GITHUB_API/repos/$REPO_OWNER/$REPO_NAME/labels" \
        -d "{
            \"name\": \"$name\",
            \"color\": \"$color\",
            \"description\": \"$description\"
        }")
    
    # Check if label was created successfully
    if echo "$response" | grep -q '"name": "'"$name"'"'; then
        echo -e "${GREEN}✓ Created label: $name${NC}"
        ((CREATED_COUNT++))
    else
        error_msg=$(echo "$response" | grep -o '"message": "[^"]*' | cut -d'"' -f4)
        if [ -z "$error_msg" ]; then
            error_msg="Unknown error"
        fi
        echo -e "${YELLOW}⚠ Label $name: $error_msg${NC}"
    fi
done

echo ""
echo -e "${GREEN}✓ Successfully created $CREATED_COUNT labels${NC}"
echo ""
echo "Labels can be viewed at:"
echo "  https://github.com/$REPO_OWNER/$REPO_NAME/labels"
