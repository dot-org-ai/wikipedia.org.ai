export interface Env {
  AI: Ai;
}

type EmbeddingModel = 'bge-m3' | 'bge-base';

interface EmbedRequest {
  texts: string[];
  model?: EmbeddingModel;
}

interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

const MODEL_CONFIG: Record<EmbeddingModel, { id: string; dimensions: number }> = {
  'bge-m3': {
    id: '@cf/baai/bge-m3',
    dimensions: 1024,
  },
  'bge-base': {
    id: '@cf/baai/bge-base-en-v1.5',
    dimensions: 768,
  },
};

const MAX_BATCH_SIZE = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

function errorResponse(error: string, details?: string, status = 400): Response {
  const body: ErrorResponse = { error };
  if (details) body.details = details;
  return jsonResponse(body, status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Health check endpoint
    if (path === '/' || path === '/health') {
      return jsonResponse({
        status: 'ok',
        service: 'embeddings',
        models: Object.keys(MODEL_CONFIG),
      });
    }

    // Embed endpoint
    if (path === '/embed' && request.method === 'POST') {
      return handleEmbed(request, env);
    }

    return errorResponse('Not found', `Unknown endpoint: ${path}`, 404);
  },
};

async function handleEmbed(request: Request, env: Env): Promise<Response> {
  let body: EmbedRequest;

  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  // Validate request
  if (!body.texts || !Array.isArray(body.texts)) {
    return errorResponse('Missing or invalid "texts" field', 'Expected an array of strings');
  }

  if (body.texts.length === 0) {
    return errorResponse('Empty texts array', 'Provide at least one text to embed');
  }

  if (body.texts.length > MAX_BATCH_SIZE) {
    return errorResponse(
      'Batch size exceeded',
      `Maximum ${MAX_BATCH_SIZE} texts per request, received ${body.texts.length}`
    );
  }

  // Validate all texts are strings
  for (let i = 0; i < body.texts.length; i++) {
    if (typeof body.texts[i] !== 'string') {
      return errorResponse('Invalid text', `Text at index ${i} is not a string`);
    }
    if (body.texts[i].length === 0) {
      return errorResponse('Empty text', `Text at index ${i} is empty`);
    }
  }

  // Get model config
  const modelName: EmbeddingModel = body.model || 'bge-m3';
  const modelConfig = MODEL_CONFIG[modelName];

  if (!modelConfig) {
    return errorResponse(
      'Invalid model',
      `Supported models: ${Object.keys(MODEL_CONFIG).join(', ')}`
    );
  }

  try {
    const result = await env.AI.run(modelConfig.id as Parameters<Ai['run']>[0], {
      text: body.texts,
    });

    // Workers AI returns { data: number[][] } for embedding models
    const embeddings = (result as { data: number[][] }).data;

    const response: EmbedResponse = {
      embeddings,
      model: modelName,
      dimensions: modelConfig.dimensions,
    };

    return jsonResponse(response);
  } catch (err) {
    console.error('AI embedding error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse('Embedding generation failed', message, 500);
  }
}
