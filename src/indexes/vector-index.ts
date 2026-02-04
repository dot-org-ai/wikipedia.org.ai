/**
 * HNSW Vector Index for Wikipedia Embeddings
 *
 * Hierarchical Navigable Small World (HNSW) graph for approximate nearest neighbor search.
 * Provides efficient O(log n) search with high recall for vector similarity queries.
 *
 * Features:
 * - 1024-dimension BGE-M3 embeddings
 * - Cosine similarity metric
 * - Hybrid search (vector + metadata filters)
 * - LRU cache for frequently accessed vectors
 *
 * Based on ParqueDB's vector index implementation.
 */

import type { ArticleType } from '../shared/types.js';
import { LRUCache } from '../lib/lru-cache.js';

// Import HNSW modules
import {
  // Constants
  DEFAULT_M,
  DEFAULT_EF_CONSTRUCTION,
  DEFAULT_EF_SEARCH,
  // Types
  type VectorMetric,
  type ArticleMetadata,
  type HNSWNode,
  // Distance functions
  getDistanceFunction,
  distanceToScore,
  // Utilities
  getRandomLevel,
} from './hnsw/index.js';

import {
  searchLayer,
  selectNeighbors,
  pruneConnections,
  greedySearchUpperLayers,
} from './hnsw/search.js';

// =============================================================================
// Constants
// =============================================================================

/** BGE-M3 embedding dimensions */
export const EMBEDDING_DIMENSIONS = 1024;

/** Default max nodes in LRU cache */
const DEFAULT_MAX_NODES = 100000;

/** Default max bytes in LRU cache (500MB) */
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;

// =============================================================================
// Types
// =============================================================================

// Re-export types from hnsw module
export type { VectorMetric, ArticleMetadata };

/** Configuration options for the vector index */
export interface VectorIndexConfig {
  /** Number of dimensions (default: 1024 for BGE-M3) */
  dimensions?: number;
  /** Distance metric (default: cosine) */
  metric?: VectorMetric;
  /** HNSW M parameter - connections per layer (default: 16) */
  m?: number;
  /** ef construction parameter (default: 200) */
  efConstruction?: number;
  /** Maximum nodes to keep in LRU cache */
  maxNodes?: number;
  /** Maximum memory in bytes for LRU cache */
  maxBytes?: number;
  /** Callback when a node is evicted from cache */
  onEvict?: (docId: string) => void;
}

/** Options for vector search */
export interface VectorSearchOptions {
  /** ef search parameter (default: 50) */
  efSearch?: number;
  /** Minimum similarity score threshold (0-1) */
  minScore?: number;
  /** Filter by article types */
  types?: ArticleType[];
}

/** Options for hybrid search */
export interface HybridSearchOptions extends VectorSearchOptions {
  /** Pre-computed candidate IDs to filter by */
  candidateIds?: Set<string>;
  /** Search strategy */
  strategy?: 'auto' | 'pre-filter' | 'post-filter';
  /** Multiplier for over-fetching in post-filter mode */
  overFetchMultiplier?: number;
}

/** Vector search result */
export interface VectorSearchResult {
  /** Document/article ID */
  id: string;
  /** Article title */
  title: string;
  /** Article type */
  type: ArticleType;
  /** Similarity score (0-1, higher is better) */
  score: number;
  /** Text preview */
  preview?: string;
}

/** Extended result with hybrid search metadata */
export interface HybridSearchResult {
  results: VectorSearchResult[];
  /** Strategy that was used */
  strategyUsed: 'pre-filter' | 'post-filter';
  /** Number of candidates considered (for pre-filter) */
  preFilterCount?: number;
  /** Number of results before filtering (for post-filter) */
  postFilterCount?: number;
  /** Number of entries scanned */
  entriesScanned: number;
}

/** Index statistics */
export interface VectorIndexStats {
  /** Total number of indexed vectors */
  totalVectors: number;
  /** Number of vectors in cache */
  cachedVectors: number;
  /** Memory usage in bytes */
  memoryBytes: number;
  /** Maximum HNSW layer */
  maxLayer: number;
  /** Dimensions */
  dimensions: number;
  /** Metric used */
  metric: VectorMetric;
}

// =============================================================================
// VectorIndex Class
// =============================================================================

/**
 * HNSW-based vector index for Wikipedia article embeddings.
 *
 * Features:
 * - Approximate nearest neighbor search with O(log n) complexity
 * - Cosine similarity for semantic search
 * - Hybrid search combining vector similarity with metadata filtering
 * - LRU cache with memory bounds for efficient resource usage
 */
export class VectorIndex {
  private nodeCache: LRUCache<number, HNSWNode>;
  private docIdToNodeId: Map<string, number> = new Map();
  private entryPoint: number | null = null;
  private maxLayerInGraph: number = -1;
  private nextNodeId: number = 0;
  private totalNodeCount: number = 0;

  private readonly m: number;
  private readonly efConstruction: number;
  private readonly dimensions: number;
  private readonly metric: VectorMetric;
  private readonly distanceFn: (a: number[] | Float32Array, b: number[] | Float32Array) => number;

  constructor(config: VectorIndexConfig = {}) {
    this.dimensions = config.dimensions ?? EMBEDDING_DIMENSIONS;
    this.metric = config.metric ?? 'cosine';
    this.m = config.m ?? DEFAULT_M;
    this.efConstruction = config.efConstruction ?? DEFAULT_EF_CONSTRUCTION;
    this.distanceFn = getDistanceFunction(this.metric);

    // Create onEvict wrapper that maps nodeId back to docId
    const onEvictWrapper = config.onEvict
      ? (_nodeId: number, node: HNSWNode) => {
          config.onEvict!(node.docId);
        }
      : undefined;

    this.nodeCache = new LRUCache<number, HNSWNode>({
      maxSize: config.maxNodes ?? DEFAULT_MAX_NODES,
      maxBytes: config.maxBytes ?? DEFAULT_MAX_BYTES,
      onEvict: onEvictWrapper,
      sizeCalculator: this.calculateNodeSize.bind(this),
    });
  }

  /**
   * Calculate memory size of a node in bytes
   */
  private calculateNodeSize(node: HNSWNode): number {
    let size = 0;
    // Vector: 8 bytes per float64
    size += node.vector.length * 8;
    // DocId string
    size += node.docId.length * 2;
    // Metadata
    size += (node.metadata.title?.length ?? 0) * 2;
    size += (node.metadata.preview?.length ?? 0) * 2;
    size += 50; // Fixed overhead for metadata fields
    // Fixed fields
    size += 16;
    // Connections Map overhead
    size += 48;
    for (const connections of node.connections.values()) {
      size += 8;
      size += connections.length * 4;
    }
    return size;
  }

  // ===========================================================================
  // Accessor Methods
  // ===========================================================================

  private getNode(nodeId: number): HNSWNode | undefined {
    return this.nodeCache.get(nodeId);
  }

  private setNode(nodeId: number, node: HNSWNode): void {
    this.nodeCache.set(nodeId, node);
  }

  private deleteNode(nodeId: number): boolean {
    return this.nodeCache.delete(nodeId);
  }

  private *iterateNodes(): IterableIterator<HNSWNode> {
    yield* this.nodeCache.values();
  }

  // ===========================================================================
  // Search Operations
  // ===========================================================================

  /**
   * Search for k nearest neighbors
   */
  search(
    query: number[] | Float32Array,
    k: number,
    options?: VectorSearchOptions
  ): VectorSearchResult[] {
    if (this.nodeCache.size === 0 || this.entryPoint === null) {
      return [];
    }

    const efSearch = options?.efSearch ?? Math.max(k, DEFAULT_EF_SEARCH);
    const minScore = options?.minScore;
    const typeFilter = options?.types ? new Set(options.types) : null;

    // Start from entry point and traverse down layers
    let currentNodeId = this.entryPoint;
    const entryNode = this.getNode(currentNodeId);
    if (!entryNode) {
      return [];
    }

    const currentDistance = this.distanceFn(query, entryNode.vector);

    // Greedy search through upper layers using the helper function
    const result = greedySearchUpperLayers(
      query,
      currentNodeId,
      currentDistance,
      this.maxLayerInGraph,
      0, // Stop before layer 0
      this.getNode.bind(this),
      this.distanceFn
    );
    currentNodeId = result.nodeId;

    // Search bottom layer with ef candidates
    const candidates = searchLayer(
      query,
      currentNodeId,
      efSearch,
      0,
      this.getNode.bind(this),
      this.distanceFn
    );

    // Filter and sort results
    const results: VectorSearchResult[] = [];

    for (const candidate of candidates) {
      const node = this.getNode(candidate.nodeId);
      if (!node) continue;

      // Apply type filter
      if (typeFilter && !typeFilter.has(node.metadata.type)) continue;

      const score = distanceToScore(candidate.distance, this.metric);

      // Apply minimum score filter
      if (minScore !== undefined && score < minScore) continue;

      const searchResult: VectorSearchResult = {
        id: node.docId,
        title: node.metadata.title,
        type: node.metadata.type,
        score,
      };
      if (node.metadata.preview !== undefined) {
        searchResult.preview = node.metadata.preview;
      }
      results.push(searchResult);
    }

    // Sort by score (descending) and take top k
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  /**
   * Hybrid search combining vector similarity with metadata filtering.
   *
   * Supports two strategies:
   * - 'pre-filter': Restricts vector search to a set of candidate IDs (brute force)
   * - 'post-filter': Performs full HNSW search, then filters results
   */
  hybridSearch(
    query: number[] | Float32Array,
    k: number,
    options?: HybridSearchOptions
  ): HybridSearchResult {
    const strategy = options?.strategy ?? 'auto';
    const candidateIds = options?.candidateIds;
    const overFetchMultiplier = options?.overFetchMultiplier ?? 3;

    // Determine actual strategy
    let actualStrategy: 'pre-filter' | 'post-filter' = 'post-filter';

    if (strategy === 'auto') {
      if (candidateIds && candidateIds.size > 0) {
        const candidateCount = candidateIds.size;
        const indexSize = this.totalNodeCount;
        const selectivity = candidateCount / indexSize;

        // Use pre-filter for small candidate sets or low selectivity
        if (candidateCount < k * 2 || selectivity < 0.3) {
          actualStrategy = 'pre-filter';
        } else {
          actualStrategy = 'post-filter';
        }
      }
    } else {
      actualStrategy = strategy === 'pre-filter' ? 'pre-filter' : 'post-filter';
    }

    if (actualStrategy === 'pre-filter' && candidateIds) {
      return this.preFilterSearch(query, k, candidateIds, options);
    } else {
      return this.postFilterSearch(query, k, overFetchMultiplier, options);
    }
  }

  /**
   * Pre-filter search: brute force over candidate set
   */
  private preFilterSearch(
    query: number[] | Float32Array,
    k: number,
    candidateIds: Set<string>,
    options?: VectorSearchOptions
  ): HybridSearchResult {
    const minScore = options?.minScore;
    const typeFilter = options?.types ? new Set(options.types) : null;
    const results: VectorSearchResult[] = [];
    let entriesScanned = 0;

    for (const docId of candidateIds) {
      const nodeId = this.docIdToNodeId.get(docId);
      if (nodeId === undefined) continue;

      const node = this.getNode(nodeId);
      if (!node) continue;

      entriesScanned++;

      // Apply type filter
      if (typeFilter && !typeFilter.has(node.metadata.type)) continue;

      const distance = this.distanceFn(query, node.vector);
      const score = distanceToScore(distance, this.metric);

      if (minScore !== undefined && score < minScore) continue;

      const searchResult: VectorSearchResult = {
        id: node.docId,
        title: node.metadata.title,
        type: node.metadata.type,
        score,
      };
      if (node.metadata.preview !== undefined) {
        searchResult.preview = node.metadata.preview;
      }
      results.push(searchResult);
    }

    results.sort((a, b) => b.score - a.score);

    return {
      results: results.slice(0, k),
      strategyUsed: 'pre-filter',
      preFilterCount: candidateIds.size,
      entriesScanned,
    };
  }

  /**
   * Post-filter search: HNSW search with over-fetching
   */
  private postFilterSearch(
    query: number[] | Float32Array,
    k: number,
    overFetchMultiplier: number,
    options?: VectorSearchOptions
  ): HybridSearchResult {
    const fetchK = k * overFetchMultiplier;
    const results = this.search(query, fetchK, options);

    return {
      results: results.slice(0, k),
      strategyUsed: 'post-filter',
      postFilterCount: results.length,
      entriesScanned: fetchK,
    };
  }

  /**
   * Check if a document exists in the index
   */
  hasDocument(docId: string): boolean {
    return this.docIdToNodeId.has(docId);
  }

  /**
   * Get all document IDs in the index
   */
  getAllDocIds(): Set<string> {
    return new Set(this.docIdToNodeId.keys());
  }

  // ===========================================================================
  // Modification Operations
  // ===========================================================================

  /**
   * Insert a vector into the index
   */
  insert(
    vector: number[] | Float32Array,
    metadata: ArticleMetadata
  ): boolean {
    // Validate dimensions
    if (vector.length !== this.dimensions) {
      return false;
    }

    const docId = metadata.id;

    // Check if document already exists
    if (this.docIdToNodeId.has(docId)) {
      return this.update(vector, metadata);
    }

    // Convert Float32Array to number[] for storage
    const vectorArray = Array.isArray(vector) ? vector : Array.from(vector);

    // Generate random layer for this node
    const nodeLayer = getRandomLevel(this.m);

    // Create new node
    const nodeId = this.nextNodeId++;
    const node: HNSWNode = {
      id: nodeId,
      docId,
      vector: vectorArray,
      metadata,
      connections: new Map(),
      maxLayer: nodeLayer,
    };

    // Initialize empty connection lists for each layer
    for (let l = 0; l <= nodeLayer; l++) {
      node.connections.set(l, []);
    }

    this.setNode(nodeId, node);
    this.docIdToNodeId.set(docId, nodeId);
    this.totalNodeCount++;

    // Handle first node
    if (this.entryPoint === null) {
      this.entryPoint = nodeId;
      this.maxLayerInGraph = nodeLayer;
      return true;
    }

    // Find entry point and insert
    let currentNodeId = this.entryPoint;
    const entryNode = this.getNode(currentNodeId);
    if (!entryNode) {
      this.entryPoint = nodeId;
      this.maxLayerInGraph = nodeLayer;
      return true;
    }

    let currentDistance = this.distanceFn(vectorArray, entryNode.vector);

    // Traverse upper layers greedily
    for (let layer = this.maxLayerInGraph; layer > nodeLayer; layer--) {
      let improved = true;
      while (improved) {
        improved = false;
        const currentNode = this.getNode(currentNodeId);
        if (!currentNode) break;

        const connections = currentNode.connections.get(layer) ?? [];

        for (const neighborId of connections) {
          const neighbor = this.getNode(neighborId);
          if (!neighbor) continue;

          const distance = this.distanceFn(vectorArray, neighbor.vector);
          if (distance < currentDistance) {
            currentNodeId = neighborId;
            currentDistance = distance;
            improved = true;
          }
        }
      }
    }

    // Insert into layers from nodeLayer down to 0
    for (let layer = Math.min(nodeLayer, this.maxLayerInGraph); layer >= 0; layer--) {
      const candidates = searchLayer(
        vectorArray,
        currentNodeId,
        this.efConstruction,
        layer,
        this.getNode.bind(this),
        this.distanceFn
      );
      const neighbors = selectNeighbors(vectorArray, candidates, this.m);

      const nodeConnections = node.connections.get(layer) ?? [];
      for (const neighbor of neighbors) {
        nodeConnections.push(neighbor.nodeId);

        const neighborNode = this.getNode(neighbor.nodeId);
        if (neighborNode) {
          const neighborConnections = neighborNode.connections.get(layer) ?? [];
          neighborConnections.push(nodeId);

          if (neighborConnections.length > this.m * 2) {
            const prunedNeighbors = pruneConnections(
              neighborNode.vector,
              neighborConnections,
              this.m * 2,
              this.getNode.bind(this),
              this.distanceFn
            );
            neighborNode.connections.set(layer, prunedNeighbors);
          } else {
            neighborNode.connections.set(layer, neighborConnections);
          }
        }
      }
      node.connections.set(layer, nodeConnections);

      if (candidates.length > 0) {
        currentNodeId = candidates[0]!.nodeId;
      }
    }

    // Update global entry point if this node has higher layer
    if (nodeLayer > this.maxLayerInGraph) {
      this.entryPoint = nodeId;
      this.maxLayerInGraph = nodeLayer;
    }

    return true;
  }

  /**
   * Update an existing vector
   */
  update(vector: number[] | Float32Array, metadata: ArticleMetadata): boolean {
    if (vector.length !== this.dimensions) {
      return false;
    }

    const docId = metadata.id;
    const existed = this.docIdToNodeId.has(docId);

    if (existed) {
      this.remove(docId);
    }

    this.insert(vector, metadata);
    return existed;
  }

  /**
   * Remove a document from the index
   */
  remove(docId: string): boolean {
    const nodeId = this.docIdToNodeId.get(docId);
    if (nodeId === undefined) return false;

    const node = this.getNode(nodeId);
    if (!node) {
      this.docIdToNodeId.delete(docId);
      this.totalNodeCount--;
      return true;
    }

    // Remove connections to this node from all neighbors
    for (let layer = 0; layer <= node.maxLayer; layer++) {
      const connections = node.connections.get(layer) ?? [];
      for (const neighborId of connections) {
        const neighbor = this.getNode(neighborId);
        if (neighbor) {
          const neighborConnections = neighbor.connections.get(layer) ?? [];
          const filtered = neighborConnections.filter((id) => id !== nodeId);
          neighbor.connections.set(layer, filtered);
        }
      }
    }

    this.deleteNode(nodeId);
    this.docIdToNodeId.delete(docId);
    this.totalNodeCount--;

    // Update entry point if necessary
    if (this.entryPoint === nodeId) {
      if (this.nodeCache.size === 0) {
        this.entryPoint = null;
        this.maxLayerInGraph = -1;
      } else {
        let newEntryPoint: number | null = null;
        let maxLayer = -1;
        for (const n of this.iterateNodes()) {
          if (n.maxLayer > maxLayer) {
            maxLayer = n.maxLayer;
            newEntryPoint = n.id;
          }
        }
        this.entryPoint = newEntryPoint;
        this.maxLayerInGraph = maxLayer;
      }
    }

    return true;
  }

  /**
   * Clear all entries from the index
   */
  clear(): void {
    this.nodeCache.clear();
    this.docIdToNodeId.clear();
    this.entryPoint = null;
    this.maxLayerInGraph = -1;
    this.nextNodeId = 0;
    this.totalNodeCount = 0;
  }

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  /**
   * Build index from an array of records
   */
  buildFromRecords(
    records: Array<{
      embedding: number[] | Float32Array;
      metadata: ArticleMetadata;
    }>,
    onProgress?: (processed: number, total: number) => void
  ): void {
    this.clear();

    const total = records.length;
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!;
      this.insert(record.embedding, record.metadata);

      if (onProgress && (i + 1) % 1000 === 0) {
        onProgress(i + 1, total);
      }
    }

    if (onProgress) {
      onProgress(total, total);
    }
  }

  /**
   * Build index from an async iterator
   */
  async build(
    data: AsyncIterable<{
      embedding: number[] | Float32Array;
      metadata: ArticleMetadata;
    }>,
    onProgress?: (processed: number) => void
  ): Promise<void> {
    this.clear();

    let processed = 0;
    for await (const record of data) {
      this.insert(record.embedding, record.metadata);

      processed++;
      if (onProgress && processed % 1000 === 0) {
        onProgress(processed);
      }
    }

    if (onProgress) {
      onProgress(processed);
    }
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get index statistics
   */
  getStats(): VectorIndexStats {
    return {
      totalVectors: this.totalNodeCount,
      cachedVectors: this.nodeCache.size,
      memoryBytes: this.nodeCache.bytes,
      maxLayer: this.maxLayerInGraph,
      dimensions: this.dimensions,
      metric: this.metric,
    };
  }

  /**
   * Get the number of entries
   */
  get size(): number {
    return this.totalNodeCount;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new vector index with default BGE-M3 configuration
 */
export function createVectorIndex(config?: VectorIndexConfig): VectorIndex {
  return new VectorIndex({
    dimensions: EMBEDDING_DIMENSIONS,
    metric: 'cosine',
    ...config,
  });
}

/**
 * Create a vector index optimized for Wikipedia article search
 */
export function createWikipediaVectorIndex(
  options?: {
    maxNodes?: number;
    maxBytes?: number;
  }
): VectorIndex {
  return new VectorIndex({
    dimensions: EMBEDDING_DIMENSIONS,
    metric: 'cosine',
    m: 16,
    efConstruction: 200,
    maxNodes: options?.maxNodes ?? DEFAULT_MAX_NODES,
    maxBytes: options?.maxBytes ?? DEFAULT_MAX_BYTES,
  });
}
