/**
 * HNSW Graph Data Structures and Algorithms
 *
 * Core data structures for Hierarchical Navigable Small World (HNSW) graphs
 * including distance functions, priority queues, and node types.
 *
 * @module indexes/hnsw/graph
 */

import type { ArticleType } from '../../shared/types.js';

// =============================================================================
// Constants
// =============================================================================

/** Default HNSW M parameter (connections per layer) */
export const DEFAULT_M = 16;

/** Default ef construction parameter */
export const DEFAULT_EF_CONSTRUCTION = 200;

/** Default ef search parameter */
export const DEFAULT_EF_SEARCH = 50;

/** Maximum HNSW level to prevent unbounded graph depth */
export const MAX_HNSW_LEVEL = 16;

// =============================================================================
// Types
// =============================================================================

/** Supported distance metrics */
export type VectorMetric = 'cosine' | 'euclidean' | 'dot';

/** Metadata for an indexed article */
export interface ArticleMetadata {
  id: string;
  title: string;
  type: ArticleType;
  preview?: string;
}

/** HNSW Node structure */
export interface HNSWNode {
  id: number;
  docId: string;
  vector: number[];
  metadata: ArticleMetadata;
  connections: Map<number, number[]>;
  maxLayer: number;
}

/** Search candidate for priority queues */
export interface SearchCandidate {
  nodeId: number;
  distance: number;
}

// =============================================================================
// Distance Functions
// =============================================================================

/**
 * Cosine distance between two vectors.
 * Returns 0 for identical vectors, 1 for orthogonal, 2 for opposite.
 */
export function cosineDistance(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  if (normA === 0 || normB === 0) {
    return normA === 0 && normB === 0 ? 0 : 1;
  }

  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  const clampedSimilarity = Math.max(-1, Math.min(1, similarity));
  return 1 - clampedSimilarity;
}

/**
 * Euclidean distance between two vectors.
 */
export function euclideanDistance(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Dot product distance (negative dot product for min-heaps).
 */
export function dotProductDistance(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
  }
  return -dotProduct;
}

/**
 * Get distance function for a given metric
 */
export function getDistanceFunction(
  metric: VectorMetric
): (a: number[] | Float32Array, b: number[] | Float32Array) => number {
  switch (metric) {
    case 'cosine':
      return cosineDistance;
    case 'euclidean':
      return euclideanDistance;
    case 'dot':
      return dotProductDistance;
    default:
      return cosineDistance;
  }
}

/**
 * Convert distance to similarity score (0-1 range)
 */
export function distanceToScore(distance: number, metric: VectorMetric): number {
  switch (metric) {
    case 'cosine':
      return 1 - distance;
    case 'euclidean':
      return Math.exp(-distance);
    case 'dot':
      return -distance;
    default:
      return 1 - distance;
  }
}

// =============================================================================
// Priority Queues (Min/Max Heaps)
// =============================================================================

/**
 * Min-heap priority queue for HNSW search candidates
 */
export class MinHeap {
  private heap: SearchCandidate[] = [];

  push(candidate: SearchCandidate): void {
    this.heap.push(candidate);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): SearchCandidate | undefined {
    if (this.heap.length === 0) return undefined;
    const result = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return result;
  }

  peek(): SearchCandidate | undefined {
    return this.heap[0];
  }

  get size(): number {
    return this.heap.length;
  }

  toArray(): SearchCandidate[] {
    return [...this.heap].sort((a, b) => a.distance - b.distance);
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[parentIndex]!.distance <= this.heap[index]!.distance) break;
      this.swap(parentIndex, index);
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < length && this.heap[leftChild]!.distance < this.heap[smallest]!.distance) {
        smallest = leftChild;
      }

      if (rightChild < length && this.heap[rightChild]!.distance < this.heap[smallest]!.distance) {
        smallest = rightChild;
      }

      if (smallest === index) break;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i]!;
    this.heap[i] = this.heap[j]!;
    this.heap[j] = temp;
  }
}

/**
 * Max-heap priority queue for HNSW search results
 */
export class MaxHeap {
  private heap: SearchCandidate[] = [];

  push(candidate: SearchCandidate): void {
    this.heap.push(candidate);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): SearchCandidate | undefined {
    if (this.heap.length === 0) return undefined;
    const result = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return result;
  }

  peek(): SearchCandidate | undefined {
    return this.heap[0];
  }

  get size(): number {
    return this.heap.length;
  }

  toArray(): SearchCandidate[] {
    return [...this.heap].sort((a, b) => a.distance - b.distance);
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[parentIndex]!.distance >= this.heap[index]!.distance) break;
      this.swap(parentIndex, index);
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let largest = index;

      if (leftChild < length && this.heap[leftChild]!.distance > this.heap[largest]!.distance) {
        largest = leftChild;
      }

      if (rightChild < length && this.heap[rightChild]!.distance > this.heap[largest]!.distance) {
        largest = rightChild;
      }

      if (largest === index) break;
      this.swap(index, largest);
      index = largest;
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i]!;
    this.heap[i] = this.heap[j]!;
    this.heap[j] = temp;
  }
}

/**
 * Generate random level for a new node in HNSW graph.
 * Uses geometric distribution based on M parameter.
 */
export function getRandomLevel(m: number): number {
  let level = 0;
  while (Math.random() < 1 / m && level < MAX_HNSW_LEVEL) {
    level++;
  }
  return level;
}
