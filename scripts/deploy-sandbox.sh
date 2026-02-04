#!/usr/bin/env bash
#
# Deploy Wikipedia Ingestion Sandbox to Cloudflare
#
# Usage:
#   ./scripts/deploy-sandbox.sh                    # Deploy to production
#   ./scripts/deploy-sandbox.sh --staging          # Deploy to staging
#   ./scripts/deploy-sandbox.sh --dry-run          # Show what would be deployed
#   ./scripts/deploy-sandbox.sh --logs             # Tail logs after deploy
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default values
ENV="production"
DRY_RUN=false
TAIL_LOGS=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --staging|-s)
      ENV="staging"
      shift
      ;;
    --dry-run|-n)
      DRY_RUN=true
      shift
      ;;
    --logs|-l)
      TAIL_LOGS=true
      shift
      ;;
    --help|-h)
      echo "Deploy Wikipedia Ingestion Sandbox to Cloudflare"
      echo ""
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --staging, -s    Deploy to staging environment"
      echo "  --dry-run, -n    Show what would be deployed"
      echo "  --logs, -l       Tail logs after deployment"
      echo "  --help, -h       Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Wikipedia Ingestion Sandbox Deployment${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo -e "  Environment: ${GREEN}$ENV${NC}"
echo -e "  Project: ${PROJECT_ROOT}"
echo ""

# Check for wrangler
if ! command -v wrangler &> /dev/null; then
  echo -e "${RED}Error: wrangler not found. Install with: npm install -g wrangler${NC}"
  exit 1
fi

# Check for required files
if [[ ! -f "$PROJECT_ROOT/wrangler.sandbox.toml" ]]; then
  echo -e "${RED}Error: wrangler.sandbox.toml not found${NC}"
  exit 1
fi

# Build the project
echo -e "${YELLOW}Building project...${NC}"
cd "$PROJECT_ROOT"

if [[ -f "package.json" ]]; then
  npm run build
fi

echo -e "${GREEN}Build complete${NC}"
echo ""

# Deploy
if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "${YELLOW}Dry run - showing deployment configuration:${NC}"
  echo ""
  wrangler deploy --config wrangler.sandbox.toml --env "$ENV" --dry-run
else
  echo -e "${YELLOW}Deploying to $ENV...${NC}"
  echo ""

  wrangler deploy --config wrangler.sandbox.toml --env "$ENV"

  echo ""
  echo -e "${GREEN}Deployment complete!${NC}"
fi

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Deployment Summary${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

if [[ "$ENV" == "staging" ]]; then
  echo "  Worker Name: wikipedia-ingest-staging"
  echo "  Dump: Simple Wikipedia (smaller dataset)"
  echo "  Output: /mnt/r2/wikipedia-staging"
  echo "  Limit: 10,000 articles"
else
  echo "  Worker Name: wikipedia-ingest"
  echo "  Dump: Full English Wikipedia (~7M articles)"
  echo "  Output: /mnt/r2/wikipedia"
  echo "  Estimated Time: 3-5 hours"
fi

echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo ""
echo "  1. Monitor progress via HTTP API:"
echo "     curl https://wikipedia-ingest.$ENV.workers.dev/status"
echo ""
echo "  2. View real-time logs:"
echo "     wrangler tail --config wrangler.sandbox.toml --env $ENV"
echo ""
echo "  3. Check detailed progress:"
echo "     curl https://wikipedia-ingest.$ENV.workers.dev/progress"
echo ""

# Optionally tail logs
if [[ "$TAIL_LOGS" == "true" ]] && [[ "$DRY_RUN" == "false" ]]; then
  echo -e "${YELLOW}Tailing logs...${NC}"
  echo "(Press Ctrl+C to stop)"
  echo ""
  wrangler tail --config wrangler.sandbox.toml --env "$ENV"
fi
