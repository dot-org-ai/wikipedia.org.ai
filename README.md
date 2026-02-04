# wikipedia.org.ai

Stream Wikipedia dumps to Parquet with AI embeddings. Runs on Cloudflare Workers for production or locally with Bun for development.

## Overview

wikipedia.org.ai is a high-performance toolkit for processing Wikipedia data at scale. It provides:

- **Streaming ingestion** of Wikipedia XML dumps into optimized Parquet files
- **AI-powered embeddings** using Cloudflare Workers AI (BGE-M3, BGE-Base, BGE-Large, Gemma)
- **Vector similarity search** with HNSW index for O(log n) approximate nearest neighbors
- **Full-text search** with BM25-scored inverted index
- **REST API** deployable to Cloudflare Workers or runnable locally
- **Article classification** into semantic types (person, place, org, work, event, other)
- **Geospatial indexing** for location-based queries

## Features

- **High-throughput ingestion**: Process millions of Wikipedia articles with streaming decompression
- **Partitioned storage**: Articles organized by type for efficient querying
- **Multiple embedding models**: Support for BGE-M3, BGE-Base, BGE-Large, and Gemma
- **Hybrid search**: Combine vector similarity with metadata filters
- **Full-text search**: BM25 scoring with field weighting (title, description, content)
- **Resume support**: Checkpoint-based recovery for long-running jobs
- **Cloudflare-native**: First-class support for Workers, R2, and AI Gateway
- **Type-safe**: Full TypeScript support with strict typing

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (v1.0+) for local development
- [Cloudflare account](https://cloudflare.com) for Workers AI and deployment (optional)

### Installation

```bash
# Clone the repository
git clone https://github.com/dotdo/wikipedia.org.ai
cd wikipedia.org.ai

# Install dependencies
bun install

# Build the project
bun run build
```

### Basic Usage

```bash
# Ingest a Wikipedia dump (test with 100 articles)
bun run cli ingest https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2 \
  --limit 100 \
  --output ./data

# Query articles by title
bun run cli query "Albert Einstein"

# Start local API server
bun run cli serve --port 8080

# View statistics
bun run cli stats
```

## Installation

### From Source

```bash
git clone https://github.com/dotdo/wikipedia.org.ai
cd wikipedia.org.ai
bun install
bun run build
```

### As a Package

```bash
bun add wikipedia.org.ai
```

### Global CLI Installation

```bash
bun install -g wikipedia.org.ai
# Now you can use `wikipedia` command globally
```

## CLI Usage

The CLI provides commands for ingesting, embedding, querying, and serving Wikipedia data.

### Ingest Command

Download and process Wikipedia dump files into Parquet format.

```bash
wikipedia ingest <url> [options]

Arguments:
  url                    Wikipedia dump URL (required)

Options:
  -o, --output <dir>     Output directory (default: ./data)
  -t, --types <types>    Filter article types (comma-separated: person,place,org,work,event,other)
  -l, --limit <count>    Maximum articles to process
  --skip-redirects       Skip redirect pages
  --skip-disambiguation  Skip disambiguation pages
  -b, --batch-size <n>   Batch size for writing (default: 1000)
  -r, --resume           Resume from previous checkpoint
  --dry-run              Show configuration without processing
  -v, --verbose          Verbose output
```

**Examples:**

```bash
# Full English Wikipedia (will take hours)
wikipedia ingest https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2

# Test with 1000 articles
wikipedia ingest https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2 \
  --limit 1000 --output ./test-data

# Only people and places
wikipedia ingest https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2 \
  --types person,place --output ./people-places
```

### Embed Command

Generate embeddings for articles using Cloudflare Workers AI.

```bash
wikipedia embed [options]

Options:
  -d, --data-dir <path>    Data directory with Parquet files (default: ./data)
  -m, --model <model>      Embedding model: bge-m3, bge-base, bge-large, gemma (default: bge-m3)
  -b, --batch-size <n>     Batch size for embedding requests (default: 50)
  -r, --resume             Resume from checkpoint
  --ai-gateway <url>       AI Gateway URL
  --account-id <id>        Cloudflare Account ID
  -o, --output <dir>       Output directory for embeddings
  --max-articles <n>       Maximum articles to embed
  --dry-run                Show configuration without processing
  -v, --verbose            Verbose output
```

**Examples:**

```bash
# Generate embeddings with default model (bge-m3)
wikipedia embed --data-dir ./data --account-id YOUR_ACCOUNT_ID

# Use different model with limited articles
wikipedia embed --model bge-large --max-articles 10000

# Resume interrupted embedding job
wikipedia embed --resume
```

### Query Command

Search Wikipedia articles by title or vector similarity.

```bash
wikipedia query <term> [options]

Arguments:
  term                   Search term (title or text for vector search)

Options:
  -d, --data-dir <path>  Data directory (default: ./data)
  -t, --type <types>     Filter by article types (comma-separated)
  -l, --limit <n>        Maximum results (default: 10)
  -f, --format <fmt>     Output format: table, json, csv (default: table)
  --vector               Use vector similarity search
  -m, --model <model>    Embedding model for vector search (default: bge-m3)
  --threshold <score>    Minimum similarity score (default: 0.7)
  -v, --verbose          Show verbose output
```

**Examples:**

```bash
# Search by title
wikipedia query "machine learning"

# Vector similarity search
wikipedia query "artificial intelligence applications" --vector

# Filter by type and output as JSON
wikipedia query "Einstein" --type person --format json --limit 5
```

### Serve Command

Start a local API server for Wikipedia queries.

```bash
wikipedia serve [options]

Options:
  -p, --port <port>      Server port (default: 8080)
  -d, --data-dir <path>  Data directory (default: ./data)
  --cors                 Enable CORS headers (default: true)
  -H, --host <host>      Host to bind to (default: 0.0.0.0)
  -v, --verbose          Verbose logging
```

**Example:**

```bash
wikipedia serve --port 3000 --data-dir ./data --verbose
```

### Build Indexes Command

Build title, type, and ID indexes from Parquet files.

```bash
wikipedia build-indexes [options]

Options:
  -d, --data-dir <path>  Data directory containing articles (default: ./data)
  -o, --output <path>    Output directory for indexes
  --no-compress          Skip gzip compression of index files
  -v, --verbose          Show verbose output
```

### Stats Command

Show processing statistics for the data directory.

```bash
wikipedia stats [options]

Options:
  -d, --data-dir <path>  Data directory (default: ./data)
  --json                 Output as JSON
```

## API Endpoints

The REST API provides comprehensive access to Wikipedia data.

### Health & Info

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/` | GET | API info and endpoint list |

### Articles

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/articles/:id` | GET | Get article by ID |
| `/api/articles` | GET | List articles with pagination |
| `/api/wiki/:title` | GET | Get article by URL-encoded title |
| `/api/query` | POST | Advanced query with filters |
| `/api/articles/near` | GET | Find articles near a location |

**Query Parameters for `/api/articles`:**

- `limit` (default: 20, max: 100) - Number of results
- `offset` (default: 0) - Pagination offset
- `type` - Filter by article type

**Query Parameters for `/api/articles/near`:**

- `lat` (required) - Latitude
- `lng` (required) - Longitude
- `radius` (default: 10) - Search radius in km

### Search

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/search` | GET | Vector similarity search |
| `/api/search/text` | GET | Full-text search with BM25 |

**Query Parameters for `/api/search`:**

- `q` (required) - Search query
- `k` (default: 10, max: 100) - Number of results
- `types` - Comma-separated article types
- `model` (default: bge-m3) - Embedding model
- `hnsw` (default: true) - Use HNSW index

**Query Parameters for `/api/search/text`:**

- `q` (required) - Search query
- `limit` (default: 20) - Number of results
- `types` - Comma-separated article types

### Relationships

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/relationships/:id` | GET | Get all relationships for an article |
| `/api/relationships/:id/outgoing` | GET | Get outgoing links |
| `/api/relationships/:id/incoming` | GET | Get incoming links |

### Types & Categories

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/types` | GET | List all article types with counts |
| `/api/types/:type` | GET | Get statistics for a specific type |

### Geospatial

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/geo/stats` | GET | Get geo index statistics |

### Example API Responses

**Search Response:**

```json
{
  "query": "machine learning",
  "k": 10,
  "model": "bge-m3",
  "useHnsw": true,
  "results": [
    {
      "id": "12345",
      "title": "Machine learning",
      "type": "work",
      "score": 0.95,
      "preview": "Machine learning is a subset of artificial intelligence..."
    }
  ],
  "count": 10,
  "searchTimeMs": 45
}
```

## Configuration

### Configuration File (.wikipediarc)

Create a `.wikipediarc` file in your project root or home directory:

```json
{
  "dataDir": "./data",
  "aiGatewayUrl": "https://gateway.ai.cloudflare.com/v1",
  "accountId": "your-cloudflare-account-id",
  "apiToken": "your-cloudflare-api-token",
  "defaultModel": "bge-m3",
  "batchSize": 50,
  "port": 8080
}
```

### Environment Variables

Environment variables override config file settings:

| Variable | Description |
|----------|-------------|
| `WIKIPEDIA_DATA_DIR` | Data directory path |
| `WIKIPEDIA_AI_GATEWAY_URL` | AI Gateway URL |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` or `CF_API_TOKEN` | Cloudflare API Token |
| `WIKIPEDIA_MODEL` | Default embedding model |
| `WIKIPEDIA_BATCH_SIZE` | Batch size for processing |
| `WIKIPEDIA_PORT` | API server port |

### Wrangler Configuration

For Cloudflare Workers deployment, configure `wrangler.toml`:

```toml
name = "wikipedia-org-ai"
main = "dist/workers/api/index.js"
compatibility_date = "2024-01-01"

# R2 bucket for data storage
[[r2_buckets]]
binding = "R2"
bucket_name = "wikipedia-data"

# AI binding for Workers AI
[ai]
binding = "AI"

# Environment variables
[vars]
AI_GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/{account_id}/wikipedia"
```

## Architecture

### Project Structure

```
src/
├── cli/                    # CLI commands
│   ├── ingest.ts          # Wikipedia dump ingestion
│   ├── embed.ts           # Embedding generation
│   ├── query.ts           # Search queries
│   ├── serve.ts           # Local API server
│   ├── build-indexes.ts   # Index building
│   └── utils.ts           # CLI utilities
├── ingest/                 # Ingestion pipeline
│   ├── pipeline.ts        # Streaming pipeline
│   ├── parse-xml.ts       # XML parsing (SAX)
│   ├── parse-wiki.ts      # Wikitext parsing
│   ├── classify.ts        # Article classification
│   └── decompress.ts      # Bzip2 decompression
├── storage/                # Data storage
│   ├── partitioner.ts     # Type-based partitioning
│   ├── parquet-writer.ts  # Parquet file writer
│   └── indexes.ts         # Index management
├── embeddings/             # Embedding generation
│   ├── ai-gateway.ts      # Cloudflare AI Gateway client
│   ├── processor.ts       # Embedding pipeline
│   ├── lance-writer.ts    # Lance format writer
│   └── vector-search.ts   # Vector search utilities
├── indexes/                # Search indexes
│   ├── vector-index.ts    # HNSW vector index
│   ├── fts-index.ts       # Full-text search (BM25)
│   ├── geo-index.ts       # Geospatial index
│   └── id-index.ts        # ID lookup index
├── query/                  # Query engine
│   ├── index.ts           # Query orchestration
│   ├── http-parquet.ts    # HTTP range requests
│   └── browser.ts         # Browser client
├── workers/                # Cloudflare Workers
│   └── api/
│       ├── router.ts      # API router
│       ├── handlers/      # Request handlers
│       └── middleware.ts  # Middleware
└── lib/                    # Shared utilities
    ├── logger.ts          # Logging
    ├── lru-cache.ts       # LRU cache
    └── wtf-lite/          # Lightweight wikitext parser
```

### Data Flow

1. **Ingestion**: Wikipedia XML dump -> Streaming decompression -> SAX parsing -> Article classification -> Partitioned Parquet files

2. **Embedding**: Parquet articles -> Text chunking -> AI Gateway (Workers AI) -> Lance format storage -> HNSW index

3. **Query**: HTTP request -> Router -> Handler -> Index lookup -> Parquet read -> Response

### Storage Format

- **Articles**: Partitioned Parquet files by article type (`/articles/{type}/{type}.{n}.parquet`)
- **Embeddings**: Lance format with columnar vectors (`/embeddings/{model}/{type}.lance`)
- **Indexes**: JSON (optionally gzipped) for title, type, and ID lookups (`/indexes/*.json.gz`)

## Development

### Setup

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run with coverage
bun run test:coverage

# Lint code
bun run lint

# Format code
bun run format
```

### Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start Wrangler dev server |
| `bun run build` | Build TypeScript |
| `bun run test` | Run tests with Vitest |
| `bun run test:coverage` | Run tests with coverage |
| `bun run lint` | Lint with Biome |
| `bun run format` | Format with Biome |
| `bun run deploy` | Deploy to Cloudflare Workers |
| `bun run deploy:staging` | Deploy to staging environment |
| `bun run cli` | Run CLI commands |

### Testing Locally

```bash
# Quick test with 100 articles (no embeddings)
bun run ingest:test:no-embed

# Test with embeddings (requires Cloudflare credentials)
bun run ingest:test

# Run the dev server
bun run dev
```

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork the repository** and create your feature branch
2. **Write tests** for new functionality
3. **Run the test suite** to ensure nothing is broken
4. **Follow the code style** - run `bun run lint` and `bun run format`
5. **Write clear commit messages** following conventional commits
6. **Submit a pull request** with a description of changes

### Code Style

- TypeScript with strict mode enabled
- Use Biome for formatting and linting
- Write JSDoc comments for public APIs
- Follow functional programming patterns where appropriate

### Pull Request Process

1. Update documentation for any changed functionality
2. Add tests for new features
3. Ensure all tests pass
4. Update the CHANGELOG if applicable
5. Request review from maintainers

## License

MIT License

Copyright (c) 2024 DotDo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
