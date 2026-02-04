#!/usr/bin/env bash
#
# Monitor Wikipedia Ingestion Progress
#
# Usage:
#   ./scripts/monitor-ingest.sh                    # Monitor production
#   ./scripts/monitor-ingest.sh --staging          # Monitor staging
#   ./scripts/monitor-ingest.sh --watch            # Auto-refresh every 10s
#   ./scripts/monitor-ingest.sh --json             # Output raw JSON
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Default values
ENV="production"
WATCH=false
JSON_OUTPUT=false
INTERVAL=10

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --staging|-s)
      ENV="staging"
      shift
      ;;
    --watch|-w)
      WATCH=true
      shift
      ;;
    --interval|-i)
      INTERVAL="$2"
      shift 2
      ;;
    --json|-j)
      JSON_OUTPUT=true
      shift
      ;;
    --help|-h)
      echo "Monitor Wikipedia Ingestion Progress"
      echo ""
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --staging, -s      Monitor staging environment"
      echo "  --watch, -w        Auto-refresh display"
      echo "  --interval, -i N   Refresh interval in seconds (default: 10)"
      echo "  --json, -j         Output raw JSON"
      echo "  --help, -h         Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Worker URL
if [[ "$ENV" == "staging" ]]; then
  BASE_URL="https://wikipedia-ingest-staging.workers.dev"
else
  BASE_URL="https://wikipedia-ingest.workers.dev"
fi

# Format bytes
format_bytes() {
  local bytes=$1
  if [[ $bytes -lt 1024 ]]; then
    echo "${bytes} B"
  elif [[ $bytes -lt 1048576 ]]; then
    echo "$(echo "scale=1; $bytes/1024" | bc) KB"
  elif [[ $bytes -lt 1073741824 ]]; then
    echo "$(echo "scale=1; $bytes/1048576" | bc) MB"
  else
    echo "$(echo "scale=2; $bytes/1073741824" | bc) GB"
  fi
}

# Format duration
format_duration() {
  local seconds=$1
  local h=$((seconds / 3600))
  local m=$(((seconds % 3600) / 60))
  local s=$((seconds % 60))
  if [[ $h -gt 0 ]]; then
    printf "%dh %dm %ds" $h $m $s
  elif [[ $m -gt 0 ]]; then
    printf "%dm %ds" $m $s
  else
    printf "%ds" $s
  fi
}

# Fetch and display status
display_status() {
  local response
  response=$(curl -s "$BASE_URL/progress" 2>/dev/null) || {
    echo -e "${RED}Failed to connect to $BASE_URL${NC}"
    return 1
  }

  if [[ "$JSON_OUTPUT" == "true" ]]; then
    echo "$response" | jq .
    return 0
  fi

  # Parse JSON
  local status=$(echo "$response" | jq -r '.status // "unknown"')
  local articlesProcessed=$(echo "$response" | jq -r '.articlesProcessed // 0')
  local bytesDownloaded=$(echo "$response" | jq -r '.bytesDownloaded // 0')
  local currentRate=$(echo "$response" | jq -r '.currentRate // 0')
  local lastArticleTitle=$(echo "$response" | jq -r '.lastArticleTitle // "N/A"')
  local startedAt=$(echo "$response" | jq -r '.startedAt // null')
  local dumpUrl=$(echo "$response" | jq -r '.dumpUrl // "unknown"')
  local heapUsed=$(echo "$response" | jq -r '.memory.heapUsed // 0')
  local heapTotal=$(echo "$response" | jq -r '.memory.heapTotal // 0')

  # Calculate elapsed time
  local elapsed=0
  if [[ "$startedAt" != "null" ]] && [[ -n "$startedAt" ]]; then
    local startTimestamp=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${startedAt%.*}" "+%s" 2>/dev/null || echo 0)
    local now=$(date "+%s")
    elapsed=$((now - startTimestamp))
  fi

  # Status color
  local statusColor=$NC
  case $status in
    running) statusColor=$GREEN ;;
    completed) statusColor=$CYAN ;;
    failed) statusColor=$RED ;;
    paused) statusColor=$YELLOW ;;
  esac

  # Clear screen for watch mode
  if [[ "$WATCH" == "true" ]]; then
    clear
  fi

  echo -e "${BLUE}============================================${NC}"
  echo -e "${BLUE}  Wikipedia Ingestion Monitor - $ENV${NC}"
  echo -e "${BLUE}============================================${NC}"
  echo ""
  echo -e "  Status:   ${statusColor}$status${NC}"
  echo -e "  Articles: ${GREEN}$(printf "%'d" $articlesProcessed)${NC}"
  echo -e "  Rate:     ${CYAN}$(printf "%.0f" $currentRate)/s${NC}"
  echo -e "  Download: $(format_bytes $bytesDownloaded)"
  echo -e "  Elapsed:  $(format_duration $elapsed)"
  echo ""
  echo -e "  Last Article: ${YELLOW}$lastArticleTitle${NC}"
  echo ""
  echo -e "  Memory: $(format_bytes $heapUsed) / $(format_bytes $heapTotal)"
  echo ""

  # Show type breakdown
  echo -e "${BLUE}  Articles by Type:${NC}"
  for type in person place org work event other; do
    local count=$(echo "$response" | jq -r ".articlesByType.$type // 0")
    if [[ $count -gt 0 ]]; then
      local pct=0
      if [[ $articlesProcessed -gt 0 ]]; then
        pct=$(echo "scale=1; $count * 100 / $articlesProcessed" | bc)
      fi
      printf "    %-8s %'10d (%5.1f%%)\n" "$type" "$count" "$pct"
    fi
  done
  echo ""

  # Progress estimate for English Wikipedia
  if [[ $articlesProcessed -gt 0 ]] && [[ $status == "running" ]]; then
    local estimatedTotal=7000000  # ~7M articles
    local pctComplete=$(echo "scale=1; $articlesProcessed * 100 / $estimatedTotal" | bc)
    local remainingArticles=$((estimatedTotal - articlesProcessed))

    if [[ $(echo "$currentRate > 0" | bc) -eq 1 ]]; then
      local remainingSeconds=$(echo "scale=0; $remainingArticles / $currentRate" | bc)
      echo -e "  ${YELLOW}Estimated Progress: ${pctComplete}%${NC}"
      echo -e "  ${YELLOW}Estimated Remaining: $(format_duration $remainingSeconds)${NC}"
      echo ""
    fi
  fi

  if [[ "$WATCH" == "true" ]]; then
    echo -e "  ${CYAN}Refreshing every ${INTERVAL}s... (Ctrl+C to stop)${NC}"
  fi
}

# Main
if [[ "$WATCH" == "true" ]]; then
  while true; do
    display_status
    sleep "$INTERVAL"
  done
else
  display_status
fi
