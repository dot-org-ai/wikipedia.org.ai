/**
 * HNSW Search Implementation
 *
 * Search algorithms for Hierarchical Navigable Small World (HNSW) graphs
 * including layer search and neighbor selection.
 *
 * @module indexes/hnsw/search
 */

import {
  type HNSWNode,
  type SearchCandidate,
  MinHeap,
  MaxHeap,
} from './graph.js';

/**
 * Function type for retrieving a node by ID
 */
export type GetNodeFn = (nodeId: number) => HNSWNode | undefined;

/**
 * Function type for computing distance between vectors
 */
export type DistanceFn = (a: number[] | Float32Array, b: number[] | Float32Array) => number;

/**
 * Search a single layer for nearest neighbors using HNSW algorithm.
 *
 * @param query - Query vector to search for
 * @param entryPointId - Starting node ID for the search
 * @param ef - Number of candidates to track during search
 * @param layer - Graph layer to search
 * @param getNode - Function to retrieve a node by ID
 * @param distanceFn - Distance function to use
 * @returns Array of search candidates sorted by distance
 */
export function searchLayer(
  query: number[] | Float32Array,
  entryPointId: number,
  ef: number,
  layer: number,
  getNode: GetNodeFn,
  distanceFn: DistanceFn
): SearchCandidate[] {
  const visited = new Set<number>();
  const candidates = new MinHeap();
  const results = new MaxHeap();

  const entryNode = getNode(entryPointId);
  if (!entryNode) return [];

  const entryDistance = distanceFn(query, entryNode.vector);
  candidates.push({ nodeId: entryPointId, distance: entryDistance });
  results.push({ nodeId: entryPointId, distance: entryDistance });
  visited.add(entryPointId);

  while (candidates.size > 0) {
    const current = candidates.pop()!;

    const farthestResult = results.peek();
    if (farthestResult && current.distance > farthestResult.distance) {
      break;
    }

    const currentNode = getNode(current.nodeId);
    if (!currentNode) continue;

    const connections = currentNode.connections.get(layer) ?? [];
    for (const neighborId of connections) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);

      const neighbor = getNode(neighborId);
      if (!neighbor) continue;

      const distance = distanceFn(query, neighbor.vector);
      const farthest = results.peek();

      if (results.size < ef || (farthest && distance < farthest.distance)) {
        candidates.push({ nodeId: neighborId, distance });
        results.push({ nodeId: neighborId, distance });

        if (results.size > ef) {
          results.pop();
        }
      }
    }
  }

  return results.toArray();
}

/**
 * Select M best neighbors from candidates.
 * Simple selection strategy - takes first M candidates by distance.
 *
 * @param vector - Query vector (unused in simple selection, kept for advanced strategies)
 * @param candidates - Candidates sorted by distance
 * @param m - Maximum number of neighbors to select
 * @returns Selected neighbors
 */
export function selectNeighbors(
  _vector: number[] | Float32Array,
  candidates: SearchCandidate[],
  m: number
): SearchCandidate[] {
  return candidates.slice(0, m);
}

/**
 * Prune connections to maintain M limit.
 * Keeps the nearest M connections by distance.
 *
 * @param nodeVector - Vector of the node being pruned
 * @param connections - Current connection IDs
 * @param maxConnections - Maximum connections to keep
 * @param getNode - Function to retrieve a node by ID
 * @param distanceFn - Distance function to use
 * @returns Pruned list of connection IDs
 */
export function pruneConnections(
  nodeVector: number[],
  connections: number[],
  maxConnections: number,
  getNode: GetNodeFn,
  distanceFn: DistanceFn
): number[] {
  if (connections.length <= maxConnections) {
    return connections;
  }

  const withDistances = connections
    .map((id) => {
      const node = getNode(id);
      if (!node) return null;
      return {
        id,
        distance: distanceFn(nodeVector, node.vector),
      };
    })
    .filter((x): x is { id: number; distance: number } => x !== null);

  withDistances.sort((a, b) => a.distance - b.distance);

  return withDistances.slice(0, maxConnections).map((x) => x.id);
}

/**
 * Perform greedy search through upper layers of HNSW graph.
 * Finds the best entry point for the target layer.
 *
 * @param query - Query vector
 * @param startNodeId - Starting node ID
 * @param startDistance - Distance from query to start node
 * @param fromLayer - Starting layer (highest)
 * @param toLayer - Target layer (exclusive, search stops above this)
 * @param getNode - Function to retrieve a node by ID
 * @param distanceFn - Distance function to use
 * @returns Best node ID and distance found
 */
export function greedySearchUpperLayers(
  query: number[] | Float32Array,
  startNodeId: number,
  startDistance: number,
  fromLayer: number,
  toLayer: number,
  getNode: GetNodeFn,
  distanceFn: DistanceFn
): { nodeId: number; distance: number } {
  let currentNodeId = startNodeId;
  let currentDistance = startDistance;

  for (let layer = fromLayer; layer > toLayer; layer--) {
    let improved = true;
    while (improved) {
      improved = false;
      const node = getNode(currentNodeId);
      if (!node) break;

      const connections = node.connections.get(layer) ?? [];

      for (const neighborId of connections) {
        const neighbor = getNode(neighborId);
        if (!neighbor) continue;

        const distance = distanceFn(query, neighbor.vector);
        if (distance < currentDistance) {
          currentNodeId = neighborId;
          currentDistance = distance;
          improved = true;
        }
      }
    }
  }

  return { nodeId: currentNodeId, distance: currentDistance };
}
