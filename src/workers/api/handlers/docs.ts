/**
 * Documentation handlers for the Wikipedia API
 *
 * Provides:
 * - OpenAPI specification endpoint
 * - Swagger UI for interactive API documentation
 */

import type { RequestContext } from '../types.js';

/** OpenAPI specification content (embedded at build time) */
const OPENAPI_SPEC = `openapi: 3.1.0
info:
  title: Wikipedia API
  version: 1.0.0
  description: |
    REST API for Wikipedia data served from R2 storage.

    This API provides access to Wikipedia articles with support for:
    - Article retrieval by ID or title
    - Full-text and vector similarity search
    - Geographic proximity queries
    - Article relationship graph traversal
    - Article type filtering and statistics

    ## Authentication

    All API endpoints (except \`/health\` and \`/\`) require authentication via API key.

    API keys can be provided in two ways:
    - **Header**: \`X-API-Key: your-api-key\`
    - **Query Parameter**: \`?api_key=your-api-key\`

    ## Rate Limiting

    Authenticated requests are rate limited to 1000 requests per minute per API key.
    Rate limit information is returned in response headers:
    - \`X-RateLimit-Remaining\`: Number of requests remaining in current window
    - \`X-RateLimit-Reset\`: Unix timestamp when the rate limit resets

servers:
  - url: /
    description: Current server

security:
  - ApiKeyHeader: []
  - ApiKeyQuery: []

tags:
  - name: Health
    description: Health check and API information
  - name: Articles
    description: Article retrieval and listing
  - name: Search
    description: Full-text and vector similarity search
  - name: Relationships
    description: Article relationship graph traversal
  - name: Types
    description: Article type statistics
  - name: Geo
    description: Geographic queries

paths:
  /:
    get:
      operationId: getApiInfo
      summary: Get API information
      tags: [Health]
      security: []
      responses:
        '200':
          description: API information
          content:
            application/json:
              schema:
                type: object

  /health:
    get:
      operationId: healthCheck
      summary: Health check
      tags: [Health]
      security: []
      responses:
        '200':
          description: Service is healthy

  /api/articles/{id}:
    get:
      operationId: getArticleById
      summary: Get article by ID
      tags: [Articles]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Article found
        '404':
          description: Not found

  /api/articles:
    get:
      operationId: listArticles
      summary: List articles
      tags: [Articles]
      parameters:
        - name: type
          in: query
          schema:
            type: string
            enum: [person, place, org, work, event, other]
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
        - name: cursor
          in: query
          schema:
            type: string
      responses:
        '200':
          description: List of articles

  /api/wiki/{title}:
    get:
      operationId: getArticleByTitle
      summary: Get article by title
      tags: [Articles]
      parameters:
        - name: title
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Article found
        '404':
          description: Not found

  /api/articles/near:
    get:
      operationId: searchNearby
      summary: Search articles near a location
      tags: [Articles, Geo]
      parameters:
        - name: lat
          in: query
          required: true
          schema:
            type: number
        - name: lng
          in: query
          required: true
          schema:
            type: number
        - name: radius
          in: query
          schema:
            type: number
            default: 10
        - name: limit
          in: query
          schema:
            type: integer
            default: 50
        - name: types
          in: query
          schema:
            type: string
        - name: fast
          in: query
          schema:
            type: string
            enum: ['true', 'false']
      responses:
        '200':
          description: Nearby articles

  /api/search:
    get:
      operationId: vectorSearch
      summary: Vector similarity search
      tags: [Search]
      parameters:
        - name: q
          in: query
          required: true
          schema:
            type: string
        - name: k
          in: query
          schema:
            type: integer
            default: 10
        - name: types
          in: query
          schema:
            type: string
        - name: model
          in: query
          schema:
            type: string
            default: bge-m3
        - name: hnsw
          in: query
          schema:
            type: string
            enum: ['true', 'false']
      responses:
        '200':
          description: Search results

  /api/search/text:
    get:
      operationId: textSearch
      summary: Full-text search
      tags: [Search]
      parameters:
        - name: q
          in: query
          required: true
          schema:
            type: string
        - name: types
          in: query
          schema:
            type: string
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
      responses:
        '200':
          description: Search results

  /api/relationships/{id}:
    get:
      operationId: getRelationships
      summary: Get article relationships
      tags: [Relationships]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: direction
          in: query
          schema:
            type: string
            enum: [outgoing, incoming, both]
            default: both
        - name: predicate
          in: query
          schema:
            type: string
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
      responses:
        '200':
          description: Relationships

  /api/relationships/{id}/outgoing:
    get:
      operationId: getOutgoingRelationships
      summary: Get outgoing relationships
      tags: [Relationships]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: predicate
          in: query
          schema:
            type: string
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
      responses:
        '200':
          description: Outgoing relationships

  /api/relationships/{id}/incoming:
    get:
      operationId: getIncomingRelationships
      summary: Get incoming relationships
      tags: [Relationships]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: predicate
          in: query
          schema:
            type: string
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
      responses:
        '200':
          description: Incoming relationships

  /api/types:
    get:
      operationId: listTypes
      summary: List article types
      tags: [Types]
      responses:
        '200':
          description: Type statistics

  /api/types/{type}:
    get:
      operationId: getTypeStats
      summary: Get type statistics
      tags: [Types]
      parameters:
        - name: type
          in: path
          required: true
          schema:
            type: string
            enum: [person, place, org, work, event, other]
      responses:
        '200':
          description: Type statistics

  /api/geo/stats:
    get:
      operationId: getGeoStats
      summary: Get geo index statistics
      tags: [Geo]
      responses:
        '200':
          description: Geo index statistics

  /api/query:
    post:
      operationId: advancedQuery
      summary: Advanced article query
      tags: [Articles]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                filters:
                  type: array
                  items:
                    type: object
                    properties:
                      field:
                        type: string
                      operator:
                        type: string
                        enum: [eq, ne, gt, gte, lt, lte, in, contains, starts_with]
                      value: {}
                type:
                  type: string
                  enum: [person, place, org, work, event, other]
                limit:
                  type: integer
                  default: 20
                offset:
                  type: integer
                  default: 0
                order_by:
                  type: string
                order_dir:
                  type: string
                  enum: [asc, desc]
      responses:
        '200':
          description: Query results

components:
  securitySchemes:
    ApiKeyHeader:
      type: apiKey
      in: header
      name: X-API-Key
    ApiKeyQuery:
      type: apiKey
      in: query
      name: api_key
`;

/**
 * GET /docs/openapi.yaml
 * Returns the OpenAPI specification in YAML format
 */
export async function handleOpenApiSpec(_ctx: RequestContext): Promise<Response> {
  return new Response(OPENAPI_SPEC, {
    status: 200,
    headers: {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/**
 * GET /docs/openapi.json
 * Returns the OpenAPI specification in JSON format
 */
export async function handleOpenApiJson(_ctx: RequestContext): Promise<Response> {
  // Simple YAML to JSON conversion for the embedded spec
  // For a production system, consider using a proper YAML parser
  const json = yamlToJson(OPENAPI_SPEC);

  return new Response(JSON.stringify(json, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/**
 * GET /docs or /docs/
 * Returns Swagger UI HTML page
 */
export async function handleSwaggerUi(_ctx: RequestContext): Promise<Response> {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wikipedia API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info .title { font-size: 2rem; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "/docs/openapi.yaml",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        persistAuthorization: true,
        tryItOutEnabled: true
      });
    };
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/**
 * Simple YAML to JSON converter for basic OpenAPI specs
 * Note: This is a simplified parser - for complex YAML, use a proper library
 */
function yamlToJson(yaml: string): Record<string, unknown> {
  const lines = yaml.split('\n');
  const root: Record<string, unknown> = {};
  const stack: { indent: number; obj: Record<string, unknown>; key?: string }[] = [
    { indent: -1, obj: root },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const content = line.trim();

    // Pop stack to find parent at appropriate indent level
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (top && top.indent >= indent) {
        stack.pop();
      } else {
        break;
      }
    }

    const currentStackEntry = stack[stack.length - 1];
    if (!currentStackEntry) continue;
    const parent = currentStackEntry.obj;

    // Check for key: value pattern
    const colonIndex = content.indexOf(':');
    if (colonIndex > 0) {
      const key = content.substring(0, colonIndex).trim();
      const valueStr = content.substring(colonIndex + 1).trim();

      if (valueStr === '' || valueStr === '|') {
        // Object or multi-line string
        const newObj: Record<string, unknown> = {};
        parent[key] = newObj;
        stack.push({ indent, obj: newObj, key });
      } else if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
        // Inline array
        const items = valueStr.slice(1, -1).split(',').map((s) => parseValue(s.trim()));
        parent[key] = items;
      } else {
        // Simple value
        parent[key] = parseValue(valueStr);
      }
    } else if (content.startsWith('- ')) {
      // Array item
      const parentKey = currentStackEntry.key;
      const parentStackEntry = stack[stack.length - 2];
      if (parentKey && parentStackEntry) {
        const arr = parentStackEntry.obj[parentKey];
        if (!Array.isArray(arr)) {
          parentStackEntry.obj[parentKey] = [];
        }
        const arrRef = parentStackEntry.obj[parentKey] as unknown[];

        const itemContent = content.substring(2).trim();
        if (itemContent.includes(':')) {
          // Object in array
          const itemObj: Record<string, unknown> = {};
          const parts = itemContent.split(':').map((s) => s.trim());
          const itemKey = parts[0];
          const itemValue = parts[1];
          if (itemKey !== undefined) {
            itemObj[itemKey] = parseValue(itemValue ?? '');
          }
          arrRef.push(itemObj);
        } else {
          arrRef.push(parseValue(itemContent));
        }
      }
    }
  }

  return root;
}

/**
 * Parse a YAML value string to appropriate JS type
 */
function parseValue(str: string): unknown {
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'null' || str === '~') return null;
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
  // Remove quotes if present
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}
