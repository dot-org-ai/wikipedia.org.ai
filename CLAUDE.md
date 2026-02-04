# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

wikipedia.org.ai processes Wikipedia dumps into queryable Parquet files with AI embeddings. Runs on Cloudflare Workers (production) or Bun (local development).

## Common Commands

```bash
# Development
bun run dev              # Start Wrangler dev server
bun run build            # Compile TypeScript

# Testing
bun test                 # Run all tests (Vitest)
bun run test:coverage    # Tests with coverage report
bun run test:e2e         # E2E tests only
SKIP_E2E=true bun test   # Skip E2E tests

# Code Quality
bun run lint             # Lint with Biome
bun run format           # Format with Biome

# Local Ingestion (for testing)
bun run ingest:test:no-embed  # 100 articles, no embeddings
bun run ingest:test           # 100 articles with embeddings (needs CF credentials)

# CLI
bun run cli ingest <url> --limit 100 --output ./data
bun run cli query "search term"
bun run cli serve --port 8080
bun run cli stats

# Deployment
bun run deploy           # Production
bun run deploy:staging   # Staging
```

## Architecture

### Data Pipeline
1. **Ingestion**: Wikipedia XML dump → SAX streaming → article classification → partitioned Parquet
2. **Embedding**: Parquet → text chunking → Cloudflare AI Gateway → Lance format → HNSW index
3. **Query**: HTTP → Router → Handler → Index lookup → Parquet read → Response

### Key Modules

- `src/ingest/` - Streaming ingestion pipeline (SAX XML parsing, wikitext parsing, article classification)
- `src/storage/` - Parquet writing with type-based partitioning
- `src/embeddings/` - AI Gateway client, Lance format writers, embedding lookup tables
- `src/indexes/` - HNSW vector index, BM25 full-text search, geohash geo-index, ID index
- `src/query/` - HTTP Parquet reader with range requests, browser-compatible client
- `src/workers/api/` - Cloudflare Worker REST API (custom router, no framework)
- `src/lib/wtf-lite/` - Custom lightweight Wikipedia parser

### Storage Layout
```
data/
├── articles/{type}/{type}.{n}.parquet  # Partitioned by type: person, place, org, work, event, other
├── embeddings/{model}/{type}.lance     # Vector embeddings in Lance format
└── indexes/*.json.gz                   # Title, type, ID lookup indexes
```

### Article Types
Articles are classified into: `person`, `place`, `org`, `work`, `event`, `other`

### Worker Entry Points
- `src/workers/api/index.ts` - Main API worker
- `src/workers/tail/index.ts` - CPU monitoring tail worker
- `src/workers/sandbox/index.ts` - Sandbox environment

## Configuration

- `wrangler.jsonc` - Cloudflare Workers config (R2 bucket, AI binding)
- `.wikipediarc` - CLI config (accountId, dataDir)
- `.dev.vars` - Local env vars (AI_GATEWAY_URL)

## Testing Notes

- Tests use Vitest with 30s timeout (allows downloading test data)
- Test helpers in `test/helpers.ts` create mock WikiPage, Article, ClassifiedArticle objects
- Coverage thresholds: 60% statements/functions/lines, 55% branches
- E2E tests may download real Wikipedia data

## Issue Tracking with Beads (bd)

This project uses `bd` (beads) for issue tracking with first-class dependency support.

### Quick Reference

```bash
bd ready                    # Find available work (no blockers)
bd show <id>                # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>               # Complete work
bd close <id1> <id2> ...    # Close multiple issues at once
bd sync                     # Sync with git remote
```

### Issue Types

- `task` - General work item (default)
- `bug` - Bug report or defect
- `feature` - New feature or enhancement
- `chore` - Maintenance or housekeeping
- `epic` - Large body of work spanning multiple issues

### Creating Issues

```bash
# Basic task
bd create "Implement feature X" --type task --priority 2

# Bug with description
bd create "Fix parsing error" --type bug -d "Fails on [[File:...]] syntax"

# Feature with priority (0=critical, 4=backlog)
bd create "Add vector search" --type feature --priority 1

# Quick capture (outputs only ID for scripting)
bd q "Quick task title"
```

### Epics and Hierarchy

Epics are containers for related work. Use `--parent` to create hierarchical children.

```bash
# Create an epic
bd create "Embeddings Pipeline" --type epic --priority 0

# Add child tasks under the epic
bd create "Implement BGE-M3 generation" --type task --parent wikipedia-abc123
bd create "Add Lance storage" --type task --parent wikipedia-abc123
bd create "Build HNSW index" --type task --parent wikipedia-abc123

# View epic status (shows completion %)
bd epic status wikipedia-abc123

# List children of an epic
bd children wikipedia-abc123

# Close eligible epics (all children complete)
bd epic close-eligible
```

### TDD Workflow: Red, Green, Refactor

Structure TDD work as an epic with ordered subtasks:

```bash
# Create the feature epic
bd create "Add geo-index support" --type epic
# Returns: wikipedia-xyz

# Create TDD subtasks as children
bd create "[RED] Write failing geo-index tests" --type task --parent wikipedia-xyz
bd create "[GREEN] Implement geo-index to pass tests" --type task --parent wikipedia-xyz
bd create "[REFACTOR] Clean up geo-index implementation" --type task --parent wikipedia-xyz

# Set up dependency chain (each step blocks the next)
bd dep wikipedia-red --blocks wikipedia-green
bd dep wikipedia-green --blocks wikipedia-refactor
```

The dependency chain ensures:
1. RED task must complete before GREEN is ready
2. GREEN task must complete before REFACTOR is ready
3. `bd ready` only shows unblocked work

### Dependencies

```bash
# Add dependency (task-B depends on task-A completing first)
bd dep add <blocked-id> <blocker-id>

# Shorthand: task-A blocks task-B
bd dep <blocker-id> --blocks <blocked-id>

# View dependency tree
bd dep tree <id>

# Check for cycles
bd dep cycles

# See what's blocked
bd blocked
```

### Workflow Example

```bash
# 1. Find available work
bd ready

# 2. Claim a task
bd update wikipedia-abc --status in_progress

# 3. Do the work...

# 4. Run quality gates
bun test && bun run lint

# 5. Complete the task
bd close wikipedia-abc

# 6. Sync and push
bd sync && git push
```

### Session Completion Protocol

**CRITICAL**: Work is NOT complete until `git push` succeeds.

```bash
# Before ending a session:
git status                  # Check what changed
git add <files>             # Stage code changes
bd sync                     # Commit beads changes
git commit -m "..."         # Commit code
bd sync                     # Commit any new beads changes
git push                    # Push to remote
```

### Useful Commands

```bash
bd list --status=open       # All open issues
bd list --status=in_progress # Active work
bd list --parent <id>       # Children of an epic
bd search "keyword"         # Search issues
bd stats                    # Project statistics
bd doctor                   # Check installation health
bd graph <id>               # Show dependency graph
```
