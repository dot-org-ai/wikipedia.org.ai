/**
 * Fast cosine similarity for quantized embeddings
 * Optimized for Uint8Array embeddings (0-255 range, centered at 128)
 */

/**
 * Compute cosine similarity between two quantized embeddings
 * @param {Uint8Array} a - First embedding
 * @param {Uint8Array} b - Second embedding
 * @returns {number} Cosine similarity [-1, 1]
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  // Unroll loop for better performance (process 4 elements at a time)
  const len = a.length;
  const len4 = len - (len % 4);

  for (let i = 0; i < len4; i += 4) {
    // Convert from uint8 (0-255) to signed (-128 to 127)
    const a0 = a[i] - 128;
    const a1 = a[i + 1] - 128;
    const a2 = a[i + 2] - 128;
    const a3 = a[i + 3] - 128;

    const b0 = b[i] - 128;
    const b1 = b[i + 1] - 128;
    const b2 = b[i + 2] - 128;
    const b3 = b[i + 3] - 128;

    dotProduct += a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
    normA += a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
    normB += b0 * b0 + b1 * b1 + b2 * b2 + b3 * b3;
  }

  // Handle remaining elements
  for (let i = len4; i < len; i++) {
    const ai = a[i] - 128;
    const bi = b[i] - 128;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Find top K most similar embeddings
 * @param {Uint8Array} query - Query embedding (quantized)
 * @param {Map<string, Uint8Array>|Object} embeddings - Map of term -> embedding
 * @param {number} k - Number of results to return
 * @returns {Array<{term: string, score: number}>} Top K results
 */
export function topK(query, embeddings, k = 10) {
  const scores = [];

  // Handle both Map and plain object
  const entries =
    embeddings instanceof Map ? embeddings.entries() : Object.entries(embeddings);

  for (const [term, embedding] of entries) {
    const score = cosineSimilarity(query, embedding);
    scores.push({ term, score });
  }

  // Sort by score descending and take top K
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k);
}

/**
 * Quantize a float32 embedding to uint8
 * @param {Float32Array|number[]} embedding - Float embedding (assumed normalized -1 to 1)
 * @returns {Uint8Array} Quantized embedding
 */
export function quantize(embedding) {
  const result = new Uint8Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    // Clamp to [-1, 1] and scale to [0, 255]
    const clamped = Math.max(-1, Math.min(1, embedding[i]));
    result[i] = Math.round((clamped + 1) * 127.5);
  }
  return result;
}

/**
 * Dequantize a uint8 embedding back to float32
 * @param {Uint8Array} embedding - Quantized embedding
 * @returns {Float32Array} Float embedding
 */
export function dequantize(embedding) {
  const result = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    result[i] = (embedding[i] - 128) / 127.5;
  }
  return result;
}

/**
 * Apply PCA projection to reduce dimensionality
 * @param {Float32Array|number[]} embedding - Original embedding
 * @param {Float32Array[]} pcaMatrix - PCA projection matrix (targetDims x originalDims)
 * @returns {Float32Array} Reduced embedding
 */
export function applyPCA(embedding, pcaMatrix) {
  const targetDims = pcaMatrix.length;
  const result = new Float32Array(targetDims);

  for (let i = 0; i < targetDims; i++) {
    let sum = 0;
    const row = pcaMatrix[i];
    for (let j = 0; j < row.length; j++) {
      sum += embedding[j] * row[j];
    }
    result[i] = sum;
  }

  return result;
}
