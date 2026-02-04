/**
 * HNSW Module
 *
 * Hierarchical Navigable Small World graph implementation for
 * approximate nearest neighbor search.
 *
 * @module indexes/hnsw
 */

// Graph data structures and algorithms
export {
  // Constants
  DEFAULT_M,
  DEFAULT_EF_CONSTRUCTION,
  DEFAULT_EF_SEARCH,
  MAX_HNSW_LEVEL,
  // Types
  type VectorMetric,
  type ArticleMetadata,
  type HNSWNode,
  type SearchCandidate,
  // Distance functions
  cosineDistance,
  euclideanDistance,
  dotProductDistance,
  getDistanceFunction,
  distanceToScore,
  // Priority queues
  MinHeap,
  MaxHeap,
  // Utilities
  getRandomLevel,
} from './graph.js';

// Search implementation
export {
  type GetNodeFn,
  type DistanceFn,
  searchLayer,
  selectNeighbors,
  pruneConnections,
  greedySearchUpperLayers,
} from './search.js';

// Note: For LRU cache functionality, use the shared LRUCache from '../lib/lru-cache.js'
// which supports both count and memory-based limits via maxBytes and sizeCalculator options.
