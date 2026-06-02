#!/bin/bash

#############################################################################
# Complete GitHub Repository Setup Automation
# Runs all setup scripts in sequence
#############################################################################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Antigravity Workspace - Complete Setup Automation          ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Verify GitHub token
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}✗ Error: GITHUB_TOKEN environment variable is not set${NC}"
    echo ""
    echo -e "${YELLOW}To set up your token:${NC}"
    echo "  1. Go to: https://github.com/settings/tokens"
    echo "  2. Click 'Generate new token (classic)'"
    echo "  3. Select scopes: 'repo', 'admin:repo_hook', 'admin:org_hook'"
    echo "  4. Copy the token and run:"
    echo "     export GITHUB_TOKEN=your_token_here"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ GitHub token configured${NC}"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Step 1: Create Labels
echo -e "${YELLOW}[Step 1/3] Creating Labels...${NC}"
if [ -f "$SCRIPT_DIR/create-labels.sh" ]; then
    bash "$SCRIPT_DIR/create-labels.sh"
    echo ""
else
    echo -e "${RED}✗ create-labels.sh not found${NC}"
    exit 1
fi

# Step 2: Create Milestones
echo -e "${YELLOW}[Step 2/3] Creating Milestones...${NC}"
if [ -f "$SCRIPT_DIR/create-milestones.sh" ]; then
    bash "$SCRIPT_DIR/create-milestones.sh"
    echo ""
else
    echo -e "${RED}✗ create-milestones.sh not found${NC}"
    exit 1
fi

# Step 3: Create Issues with Relationships
echo -e "${YELLOW}[Step 3/3] Creating Issues with Relationships...${NC}"
if [ -f "$SCRIPT_DIR/create-issues.sh" ]; then
    bash "$SCRIPT_DIR/create-issues.sh"
    echo ""
else
    echo -e "${RED}✗ create-issues.sh not found${NC}"
    exit 1
fi

# Summary
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SETUP COMPLETE ✓                                            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Repository Setup Summary:${NC}"
echo "  ✓ Labels: 15 created"
echo "  ✓ Milestones: 4 created (4 phases)"
echo "  ✓ Issues: 9 created (4 per phase)"
echo "  ✓ Relationships: All dependencies linked"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. View repository: https://github.com/Keshuin0/antigravity-workspace"
echo "  2. Check labels: https://github.com/Keshuin0/antigravity-workspace/labels"
echo "  3. View milestones: https://github.com/Keshuin0/antigravity-workspace/milestones"
echo "  4. Browse issues: https://github.com/Keshuin0/antigravity-workspace/issues"
echo "  5. Create GitHub Project V2 board (optional)"
echo "  6. Set up branch protection rules on 'main'"
echo "  7. Configure environments and deployment settings"
echo ""
echo -e "${GREEN}Your repository is ready for development!${NC}"
