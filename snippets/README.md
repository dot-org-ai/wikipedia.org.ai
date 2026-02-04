# Wikipedia Snippet

Ultra-lightweight edge lookup for Wikipedia articles on Cloudflare Workers.

## Overview

This Cloudflare Snippet provides high-performance Wikipedia article lookup and vector similarity search with minimal size footprint (<1MB) and zero infrastructure costs.

### Architecture

The snippet uses a tiered caching strategy:

1. **Inline Top-1K** - Pre-computed embeddings for top 1,000 Wikipedia articles (~256KB)
2. **R2 Cached Top-10K** - Lazy-loaded 10,000 article embeddings with automatic caching
3. **AI Gateway Fallback** - Full vector search via Cloudflare AI Gateway (cached responses)
4. **Bloom Filter Index** - Fast negative lookups for title existence checks

### Performance

- **Lookup**: <10ms (cached) for title resolution
- **Search**: <50ms for top results from inline/cached embeddings
- **Size**: ~350KB total bundled size
- **Cost**: Free for lookups, minimal cost for vector searches

## API Endpoints

### GET /lookup?title=X

Look up a Wikipedia article and return its location in the data index.

**Parameters:**
- `title` (required) - Wikipedia article title (URL encoded)

**Example:**
```
GET /lookup?title=Albert%20Einstein
```

**Response:**
```json
{
  "found": true,
  "title": "Albert Einstein",
  "location": {
    "type": "article",
    "partition": "0342",
    "url": "https://wikipedia-embeddings.r2.dev/articles/article/0342.parquet",
    "embeddingsUrl": "https://wikipedia-embeddings.r2.dev/embeddings/article/0342.lance"
  }
}
```

### GET /search?q=X&k=10

Vector similarity search for Wikipedia articles.

**Parameters:**
- `q` (required) - Search query (URL encoded)
- `k` (optional) - Number of results (default: 10, max: 100)

**Example:**
```
GET /search?q=physicist&k=5
```

**Response:**
```json
{
  "results": [
    {
      "title": "Physics",
      "score": 0.92,
      "location": { ... },
      "source": "inline"
    },
    ...
  ],
  "source": "inline",
  "cached": true
}
```

### GET /types

List available article types used for partitioning.

**Example:**
```
GET /types
```

**Response:**
```json
{
  "types": [
    "article",
    "category",
    "disambiguation",
    "redirect",
    "template",
    "file",
    "portal",
    "other"
  ],
  "description": "Article types used for partitioning"
}
```

### GET /health

Health check endpoint.

**Example:**
```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "config": {
    "r2BaseUrl": "https://wikipedia-embeddings.r2.dev",
    "hasInlineEmbeddings": true,
    "inlineTermCount": 1000,
    "hasCachedEmbeddings": true
  }
}
```

### GET /metrics

Usage metrics and performance statistics.

**Example:**
```
GET /metrics
```

**Response:**
```json
{
  "metrics": {
    "uptime": 3600000,
    "totalRequests": 1523,
    "successfulRequests": 1502,
    "erroredRequests": 21,
    "successRate": 98.62,
    "byEndpoint": {
      "lookup": 523,
      "search": 890,
      "health": 100,
      "types": 10
    },
    "cache": {
      "inlineEmbeddings": 1000,
      "cachedR2Embeddings": 9000,
      "bloomFilterLoaded": true,
      "cacheHits": 1200,
      "r2Fetches": 3
    },
    "requests": {
      "aiGatewayRequests": 2,
      "cachedResponses": 1400
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Deployment

### Prerequisites

- Cloudflare account with Workers enabled
- Wrangler CLI installed (`npm install -g wrangler`)
- R2 bucket with Wikipedia data uploaded

### Deploy to Production

```bash
# Deploy the snippet
wrangler deploy -c snippets/wrangler.toml

# Set required secrets
wrangler secret put CF_ACCOUNT_ID -c snippets/wrangler.toml
wrangler secret put AI_GATEWAY_ID -c snippets/wrangler.toml
```

### Configuration

Edit `snippets/wrangler.toml` to configure:

- `R2_BASE_URL` - Base URL for R2 bucket (e.g., `https://wikipedia-embeddings.r2.dev`)
- `CF_ACCOUNT_ID` - Cloudflare account ID (for AI Gateway access)
- `AI_GATEWAY_ID` - AI Gateway ID (for embedding generation)

### Local Testing

See `snippets/test.ts` for local testing before deployment.

## Development

### Building Embeddings

Generate top-10K embeddings from Wikipedia data:

```bash
bun run snippets/build-top10k.ts \
  --input pageviews.csv \
  --output snippets/
```

This generates:
- `embeddings-top10k.js` - Inline top-1K embeddings and PCA matrix
- `index/top10k-embeddings.bin` - Full 10K embeddings for R2 caching

### Bundle Size Budget

- Target: <500KB (well under 1MB Cloudflare limit)
- Current: ~350KB including all dependencies
- Breakdown:
  - Cosine similarity code: ~2KB
  - Embeddings (top-1K): ~256KB
  - Lookup handler: ~40KB
  - Dependencies: ~52KB

## Endpoints Response Headers

All endpoints return appropriate cache headers:

- `/lookup`, `/search` - `Cache-Control: public, max-age=3600` (1 hour)
- `/types` - `Cache-Control: public, max-age=86400` (24 hours)
- `/health`, `/metrics` - `Cache-Control: no-cache, no-store` (always fresh)
- All responses - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`

## Error Handling

All endpoints handle errors gracefully:

- Missing parameters return `400 Bad Request`
- Not found endpoints return `404 Not Found`
- Server errors return `500 Internal Server Error` with error message
- Invalid HTTP methods return `405 Method Not Allowed`

Error responses include:
```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

## Monitoring

### Request Logging

All requests are logged with:
- Timestamp
- Endpoint path
- HTTP method
- Response status
- Duration (milliseconds)
- Error details (if applicable)

### Metrics

Monitor performance via `/metrics` endpoint:
- Success rate
- Cache hit ratio
- R2 fetch count
- AI Gateway request count
- Requests per endpoint

## Troubleshooting

### High error rate

Check:
- R2 bucket accessibility from Cloudflare edge
- AI Gateway credentials and configuration
- Network connectivity to embedding index

### Slow lookup performance

- Verify bloom filter is loading correctly
- Check R2 bucket performance metrics
- Monitor Cache API effectiveness

### Missing search results

- Verify embeddings are generated and uploaded to R2
- Check AI Gateway is properly configured
- Review search query formatting

## Production Checklist

- [ ] R2 bucket configured and populated with data
- [ ] Secrets configured (CF_ACCOUNT_ID, AI_GATEWAY_ID)
- [ ] R2_BASE_URL environment variable set correctly
- [ ] Monitor metrics endpoint for health
- [ ] Set up alerts for error rate > 5%
- [ ] Test endpoint access from different regions
- [ ] Review size budget (should be <500KB)
- [ ] Enable caching via Cloudflare page rules
