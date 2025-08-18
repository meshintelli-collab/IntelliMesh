import * as THREE from "three";

export interface PolygonFace {
  type: string;
  originalVertices: THREE.Vector3[];
  normal: THREE.Vector3;
  triangleIndices?: number[];
  originalTriangulation?: number[][]; // Preserves exact original triangle vertex indices
}

/**
 * Edge-Adjacent Coplanar Merger - Systematic & Thorough
 * Finds ALL groups of edge-adjacent coplanar triangles and merges them properly
 *
 * Key improvements:
 * - More thorough edge detection algorithm
 * - Systematic processing of ALL triangle groups (no arbitrary limits)
 * - Better vertex ordering and polygon reconstruction
 * - Clear debugging to understand what's happening
 */
export class EdgeAdjacentMerger {
  private static readonly DISTANCE_TOLERANCE = 0.1;
  private static readonly NORMAL_TOLERANCE = 0.9999; // Perfectly parallel faces only
  private static readonly EDGE_TOLERANCE = 0.1;

  /**
   * Main entry point: merge coplanar triangles in BufferGeometry
   */
  static mergeCoplanarTriangles(geometry: THREE.BufferGeometry): PolygonFace[] {
    const faces = this.extractTrianglesFromGeometry(geometry);
    // Processing triangles for parallel merging

    return this.systematicMergeProcess(faces);
  }

  /**
   * Extract triangles from BufferGeometry
   */
  private static extractTrianglesFromGeometry(
    geometry: THREE.BufferGeometry,
  ): PolygonFace[] {
    const positions = geometry.attributes.position;
    const faces: PolygonFace[] = [];

    for (let i = 0; i < positions.count; i += 3) {
      const v1 = new THREE.Vector3(
        positions.getX(i),
        positions.getY(i),
        positions.getZ(i),
      );
      const v2 = new THREE.Vector3(
        positions.getX(i + 1),
        positions.getY(i + 1),
        positions.getZ(i + 1),
      );
      const v3 = new THREE.Vector3(
        positions.getX(i + 2),
        positions.getY(i + 2),
        positions.getZ(i + 2),
      );

      // Calculate normal
      const edge1 = new THREE.Vector3().subVectors(v2, v1);
      const edge2 = new THREE.Vector3().subVectors(v3, v1);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      // Skip degenerate triangles
      if (normal.length() > 0.001) {
        faces.push({
          type: "triangle",
          originalVertices: [v1, v2, v3],
          normal: normal,
          triangleIndices: [Math.floor(i / 3)],
        });
      }
    }

    return faces;
  }

  /**
   * Systematic merge process - find and merge ALL coplanar groups
   */
  private static systematicMergeProcess(faces: PolygonFace[]): PolygonFace[] {
    // Step 1: Build comprehensive adjacency map
    const adjacencyMap = this.buildComprehensiveAdjacencyMap(faces);

    // Step 2: Find all connected components
    const components = this.findAllConnectedComponents(faces, adjacencyMap);

    // Found connected components

    // Step 3: Merge each component systematically
    const mergedFaces: PolygonFace[] = [];
    let mergedTriangleCount = 0;
    let preservedTriangleCount = 0;

    for (let i = 0; i < components.length; i++) {
      const component = components[i];

      if (component.length === 1) {
        // Single triangle - keep as is
        mergedFaces.push(faces[component[0]]);
        preservedTriangleCount++;
      } else {
        // Multiple triangles - merge into polygon
        const mergedPolygon = this.mergeComponentSystematically(
          component,
          faces,
        );
        if (mergedPolygon) {
          mergedFaces.push(mergedPolygon);
          mergedTriangleCount += component.length;
          // Component merged successfully
        } else {
          // Fallback: keep as individual triangles
          for (const triIndex of component) {
            mergedFaces.push(faces[triIndex]);
          }
          preservedTriangleCount += component.length;
          // Component preserved as triangles
        }
      }
    }

    // Merge complete

    return mergedFaces;
  }

  /**
   * Build comprehensive adjacency map between triangles
   */
  private static buildComprehensiveAdjacencyMap(
    faces: PolygonFace[],
  ): Map<number, Set<number>> {
    const adjacencyMap = new Map<number, Set<number>>();

    // Initialize empty sets for all faces
    for (let i = 0; i < faces.length; i++) {
      adjacencyMap.set(i, new Set());
    }

    let edgeConnectionCount = 0;

    // Check every pair of faces
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        if (this.facesAreAdjacentAndCoplanar(faces[i], faces[j])) {
          adjacencyMap.get(i)!.add(j);
          adjacencyMap.get(j)!.add(i);
          edgeConnectionCount++;
        }
      }
    }


    // Debug connectivity statistics
    let connectedFaces = 0;
    let totalConnections = 0;
    for (const [faceId, neighbors] of adjacencyMap) {
      if (neighbors.size > 0) {
        connectedFaces++;
        totalConnections += neighbors.size;
      }
    }



    return adjacencyMap;
  }

  /**
   * Check if two faces are both perfectly parallel AND share a complete edge
   */
  private static facesAreAdjacentAndCoplanar(
    face1: PolygonFace,
    face2: PolygonFace,
  ): boolean {
    // First check coplanarity (faster check)
    if (!this.areCoplanar(face1, face2)) {
      return false;
    }

    // Then check edge adjacency
    return this.shareCompleteEdge(face1, face2);
  }

  /**
   * Check if two faces are perfectly parallel and coplanar
   */
  private static areCoplanar(face1: PolygonFace, face2: PolygonFace): boolean {
    const normal1 = this.ensureVector3(face1.normal);
    const normal2 = this.ensureVector3(face2.normal);

    // Check for perfect parallelism - normals must be nearly identical
    const normalDot = Math.abs(normal1.dot(normal2));
    if (normalDot < this.NORMAL_TOLERANCE) {
      return false;
    }

    // For perfectly parallel faces, also check they're on the same plane
    const face1Center = this.getFaceCenter(face1.originalVertices);
    const face2Center = this.getFaceCenter(face2.originalVertices);
    const planeDistance = this.distanceToPlane(
      face1Center,
      face2Center,
      normal1,
    );

    return Math.abs(planeDistance) < this.DISTANCE_TOLERANCE;
  }

  /**
   * Check if two faces share a complete edge
   */
  private static shareCompleteEdge(
    face1: PolygonFace,
    face2: PolygonFace,
  ): boolean {
    const edges1 = this.getFaceEdges(face1);
    const edges2 = this.getFaceEdges(face2);

    for (const edge1 of edges1) {
      for (const edge2 of edges2) {
        if (this.edgesMatch(edge1, edge2)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get all edges of a face
   */
  private static getFaceEdges(
    face: PolygonFace,
  ): Array<[THREE.Vector3, THREE.Vector3]> {
    const vertices = face.originalVertices;
    const edges: Array<[THREE.Vector3, THREE.Vector3]> = [];

    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      edges.push([vertices[i], vertices[next]]);
    }

    return edges;
  }

  /**
   * Check if two edges match (same vertices, any orientation)
   */
  private static edgesMatch(
    edge1: [THREE.Vector3, THREE.Vector3],
    edge2: [THREE.Vector3, THREE.Vector3],
  ): boolean {
    const [a1, b1] = edge1;
    const [a2, b2] = edge2;

    // Check both orientations
    const forwardMatch =
      a1.distanceTo(a2) < this.EDGE_TOLERANCE &&
      b1.distanceTo(b2) < this.EDGE_TOLERANCE;

    const reverseMatch =
      a1.distanceTo(b2) < this.EDGE_TOLERANCE &&
      b1.distanceTo(a2) < this.EDGE_TOLERANCE;

    return forwardMatch || reverseMatch;
  }

  /**
   * Find all connected components using DFS
   */
  private static findAllConnectedComponents(
    faces: PolygonFace[],
    adjacencyMap: Map<number, Set<number>>,
  ): number[][] {
    const visited = new Set<number>();
    const components: number[][] = [];

    for (let i = 0; i < faces.length; i++) {
      if (!visited.has(i)) {
        const component = this.exploreComponent(i, adjacencyMap, visited);
        components.push(component);
      }
    }

    return components;
  }

  /**
   * Explore a connected component using DFS
   */
  private static exploreComponent(
    startIndex: number,
    adjacencyMap: Map<number, Set<number>>,
    visited: Set<number>,
  ): number[] {
    const component: number[] = [];
    const stack = [startIndex];

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (visited.has(current)) continue;

      visited.add(current);
      component.push(current);

      // Add all unvisited neighbors
      const neighbors = adjacencyMap.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }

    return component;
  }

  /**
   * Merge a component of triangles into a single polygon
   */
  private static mergeComponentSystematically(
    componentIndices: number[],
    faces: PolygonFace[],
  ): PolygonFace | null {
    if (componentIndices.length === 0) return null;
    if (componentIndices.length === 1) return faces[componentIndices[0]];



    try {
      // Collect all vertices from component triangles
      const allVertices: THREE.Vector3[] = [];
      const allTriangleIndices: number[] = [];

      for (const index of componentIndices) {
        const face = faces[index];
        allVertices.push(...face.originalVertices);
        if (face.triangleIndices) {
          allTriangleIndices.push(...face.triangleIndices);
        }
      }

      // Find unique vertices
      const uniqueVertices = this.removeDuplicateVertices(allVertices);


      // Build perimeter by tracing edges
      const perimeterVertices = this.tracePerimeter(componentIndices, faces);

      if (!perimeterVertices || perimeterVertices.length < 3) {
        return null;
      }



      // Get normal from first triangle
      const normal = this.ensureVector3(faces[componentIndices[0]].normal);

      // Determine face type
      const faceType =
        perimeterVertices.length === 3
          ? "triangle"
          : perimeterVertices.length === 4
            ? "quad"
            : "polygon";

      // Create merged face
      const mergedFace: PolygonFace = {
        type: faceType,
        originalVertices: perimeterVertices,
        normal: normal.clone().normalize(),
        triangleIndices: allTriangleIndices,
        originalTriangulation: this.preserveTriangulation(
          componentIndices,
          faces,
          perimeterVertices,
        ),
      };

      return mergedFace;
    } catch (error) {
      return null;
    }
  }

  /**
   * Trace the perimeter of a set of connected triangles
   */
  private static tracePerimeter(
    componentIndices: number[],
    faces: PolygonFace[],
  ): THREE.Vector3[] | null {
    // Build edge usage map
    const edgeUsage = new Map<string, number>();
    const edgeToVertices = new Map<string, [THREE.Vector3, THREE.Vector3]>();

    // Count how many times each edge appears
    for (const index of componentIndices) {
      const face = faces[index];
      const edges = this.getFaceEdges(face);

      for (const edge of edges) {
        const edgeKey = this.getEdgeKey(edge[0], edge[1]);
        edgeUsage.set(edgeKey, (edgeUsage.get(edgeKey) || 0) + 1);
        edgeToVertices.set(edgeKey, edge);
      }
    }

    // Find boundary edges (appear only once)
    const boundaryEdges: Array<[THREE.Vector3, THREE.Vector3]> = [];
    for (const [edgeKey, count] of edgeUsage) {
      if (count === 1) {
        const edge = edgeToVertices.get(edgeKey);
        if (edge) {
          boundaryEdges.push(edge);
        }
      }
    }

    if (boundaryEdges.length === 0) {
      return null;
    }


    // Trace the perimeter by connecting boundary edges
    return this.connectBoundaryEdges(boundaryEdges);
  }

  /**
   * Connect boundary edges into a continuous perimeter
   */
  private static connectBoundaryEdges(
    boundaryEdges: Array<[THREE.Vector3, THREE.Vector3]>,
  ): THREE.Vector3[] | null {
    if (boundaryEdges.length === 0) return null;

    const perimeter: THREE.Vector3[] = [];
    const usedEdges = new Set<number>();

    // Start with first edge
    let currentEdge = boundaryEdges[0];
    perimeter.push(currentEdge[0].clone());
    perimeter.push(currentEdge[1].clone());
    usedEdges.add(0);

    // Connect remaining edges
    while (usedEdges.size < boundaryEdges.length) {
      const lastVertex = perimeter[perimeter.length - 1];
      let foundConnection = false;

      for (let i = 0; i < boundaryEdges.length; i++) {
        if (usedEdges.has(i)) continue;

        const edge = boundaryEdges[i];

        // Check if this edge connects to our current position
        if (lastVertex.distanceTo(edge[0]) < this.EDGE_TOLERANCE) {
          perimeter.push(edge[1].clone());
          usedEdges.add(i);
          foundConnection = true;
          break;
        } else if (lastVertex.distanceTo(edge[1]) < this.EDGE_TOLERANCE) {
          perimeter.push(edge[0].clone());
          usedEdges.add(i);
          foundConnection = true;
          break;
        }
      }

      if (!foundConnection) {
        break;
      }
    }

    // Remove the last vertex if it's the same as the first (closed loop)
    if (perimeter.length > 3) {
      const first = perimeter[0];
      const last = perimeter[perimeter.length - 1];
      if (first.distanceTo(last) < this.EDGE_TOLERANCE) {
        perimeter.pop();
      }
    }

    return perimeter.length >= 3 ? perimeter : null;
  }

  /**
   * Generate a unique key for an edge (order independent)
   */
  private static getEdgeKey(v1: THREE.Vector3, v2: THREE.Vector3): string {
    const key1 = `${v1.x.toFixed(6)},${v1.y.toFixed(6)},${v1.z.toFixed(6)}`;
    const key2 = `${v2.x.toFixed(6)},${v2.y.toFixed(6)},${v2.z.toFixed(6)}`;

    // Ensure consistent ordering for the same edge
    return key1 < key2 ? `${key1}-${key2}` : `${key2}-${key1}`;
  }

  /**
   * Remove duplicate vertices
   */
  private static removeDuplicateVertices(
    vertices: THREE.Vector3[],
  ): THREE.Vector3[] {
    const unique: THREE.Vector3[] = [];

    for (const vertex of vertices) {
      const isDuplicate = unique.some(
        (existing) => existing.distanceTo(vertex) < this.DISTANCE_TOLERANCE,
      );

      if (!isDuplicate) {
        unique.push(vertex.clone());
      }
    }

    return unique;
  }

  /**
   * Preserve original triangulation pattern
   */
  private static preserveTriangulation(
    componentIndices: number[],
    faces: PolygonFace[],
    perimeterVertices: THREE.Vector3[],
  ): number[][] {
    const triangulation: number[][] = [];

    for (const triangleIndex of componentIndices) {
      const triangle = faces[triangleIndex];
      const triangleVertices = triangle.originalVertices;

      if (triangleVertices.length === 3) {
        const indices: number[] = [];

        for (const triVertex of triangleVertices) {
          let matchIndex = -1;
          for (let i = 0; i < perimeterVertices.length; i++) {
            if (
              triVertex.distanceTo(perimeterVertices[i]) < this.EDGE_TOLERANCE
            ) {
              matchIndex = i;
              break;
            }
          }

          if (matchIndex !== -1) {
            indices.push(matchIndex);
          }
        }

        if (indices.length === 3) {
          triangulation.push(indices);
        }
      }
    }

    return triangulation;
  }

  // Helper utility methods
  private static ensureVector3(vector: any): THREE.Vector3 {
    if (vector instanceof THREE.Vector3) return vector;
    if (
      vector?.x !== undefined &&
      vector?.y !== undefined &&
      vector?.z !== undefined
    ) {
      return new THREE.Vector3(vector.x, vector.y, vector.z);
    }
    return new THREE.Vector3(0, 0, 1);
  }

  private static getFaceCenter(vertices: THREE.Vector3[]): THREE.Vector3 {
    const center = new THREE.Vector3();
    for (const vertex of vertices) {
      center.add(vertex);
    }
    center.divideScalar(vertices.length);
    return center;
  }

  private static distanceToPlane(
    point: THREE.Vector3,
    planePoint: THREE.Vector3,
    planeNormal: THREE.Vector3,
  ): number {
    const diff = point.clone().sub(planePoint);
    return diff.dot(planeNormal);
  }
}
