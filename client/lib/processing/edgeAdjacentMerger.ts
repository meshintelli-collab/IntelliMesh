import * as THREE from "three";

export interface PolygonFace {
  type: string;
  originalVertices: THREE.Vector3[];
  normal: THREE.Vector3;
  triangleIndices?: number[];
}

/**
 * Edge-Adjacent Coplanar Merger
 * Only merges triangles that share complete edges AND are coplanar
 * This prevents unwanted merging across voids/gaps in shapes like crosses
 *
 * REPLACES: CoplanarMerger and SimpleCoplanarMerger (removed)
 * WHY: Old mergers created unwanted connections across gaps by merging
 *      triangles that only shared vertices, not complete edges
 *
 * USE THIS APPROACH FOR:
 * - Shapes with voids/holes (crosses, rings, L-brackets)
 * - When you need clean faces but no connections across gaps
 * - General-purpose coplanar merging that respects geometric boundaries
 *
 * This is now the ONLY coplanar merging approach in the codebase
 */
export class EdgeAdjacentMerger {
  private static readonly DISTANCE_TOLERANCE = 0.01; // Slightly more permissive for procedural shapes
  private static readonly NORMAL_TOLERANCE = 0.995; // Still strict but allow tiny variations
  private static readonly EDGE_TOLERANCE = 0.01; // More permissive for edge matching

  /**
   * Merge coplanar triangles in a BufferGeometry (main interface)
   */
  static mergeCoplanarTriangles(geometry: THREE.BufferGeometry): PolygonFace[] {
    const faces = this.extractTrianglesFromGeometry(geometry);
    return this.groupEdgeAdjacentTriangles(faces);
  }

  /**
   * Extract triangles from BufferGeometry as PolygonFaces
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
   * Group coplanar triangles that share complete edges
   */
  static groupEdgeAdjacentTriangles(faces: PolygonFace[]): PolygonFace[] {
    // Debug first few faces to understand the geometry
    for (let i = 0; i < Math.min(5, faces.length); i++) {
      const face = faces[i];
      const normal = this.ensureVector3(face.normal);
      console.log(
        `   Face ${i}: ${face.type}, normal(${normal.x.toFixed(3)}, ${normal.y.toFixed(3)}, ${normal.z.toFixed(3)}), vertices: ${face.originalVertices.length}`,
      );
    }

    // Build adjacency graph based on shared edges
    const adjacencyGraph = this.buildEdgeAdjacencyGraph(faces);

    // Find connected components of coplanar faces
    const components = this.findCoplanarComponents(faces, adjacencyGraph);

    console.log(`   Found ${components.length} connected components:`);

    // Merge each component into a single polygon
    const mergedFaces = components.map((component, index) => {
      return this.mergeComponent(component, faces);
    });

    console.log(
      `✅ Output: ${mergedFaces.length} merged faces (from ${components.length} components)`,
    );
    return mergedFaces;
  }

  /**
   * Build graph where edges connect faces that share a complete edge
   */
  private static buildEdgeAdjacencyGraph(
    faces: PolygonFace[],
  ): Map<number, Set<number>> {
    const graph = new Map<number, Set<number>>();

    // Initialize empty adjacency lists
    for (let i = 0; i < faces.length; i++) {
      graph.set(i, new Set());
    }

    console.log(
      `   Building edge adjacency graph for ${faces.length} faces...`,
    );
    let sharedEdgeCount = 0;

    // Check each pair of faces for shared edges
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        if (this.facesShareCompleteEdge(faces[i], faces[j])) {
          graph.get(i)!.add(j);
          graph.get(j)!.add(i);
          sharedEdgeCount++;
        }
      }
    }

    // Debug graph connectivity
    let connectedFaces = 0;
    for (const [faceId, neighbors] of graph) {
      if (neighbors.size > 0) connectedFaces++;
    }

    return graph;
  }

  /**
   * Check if two faces share a complete edge (not just vertices)
   */
  private static facesShareCompleteEdge(
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
   * Get all edges of a face as pairs of vertices
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
   * Check if two edges match (same vertices, possibly reversed)
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
   * Find connected components of coplanar faces using DFS
   */
  private static findCoplanarComponents(
    faces: PolygonFace[],
    graph: Map<number, Set<number>>,
  ): number[][] {
    const visited = new Set<number>();
    const components: number[][] = [];

    for (let i = 0; i < faces.length; i++) {
      if (!visited.has(i)) {
        const component = this.dfsCoplanarComponent(i, faces, graph, visited);
        components.push(component);
      }
    }

    return components;
  }

  /**
   * DFS to find all coplanar faces connected via edges
   */
  private static dfsCoplanarComponent(
    startIndex: number,
    faces: PolygonFace[],
    graph: Map<number, Set<number>>,
    visited: Set<number>,
  ): number[] {
    const component: number[] = [];
    const stack = [startIndex];
    const startFace = faces[startIndex];

    while (stack.length > 0) {
      const currentIndex = stack.pop()!;

      if (visited.has(currentIndex)) continue;
      visited.add(currentIndex);
      component.push(currentIndex);

      // Add adjacent faces that are coplanar
      const neighbors = graph.get(currentIndex) || new Set();
      for (const neighborIndex of neighbors) {
        if (
          !visited.has(neighborIndex) &&
          this.facesAreCoplanar(startFace, faces[neighborIndex])
        ) {
          stack.push(neighborIndex);
        }
      }
    }

    return component;
  }

  /**
   * Check if two faces are coplanar
   */
  private static facesAreCoplanar(
    face1: PolygonFace,
    face2: PolygonFace,
  ): boolean {
    const normal1 = this.ensureVector3(face1.normal);
    const normal2 = this.ensureVector3(face2.normal);

    // Check normal similarity
    const normalDot = Math.abs(normal1.dot(normal2));
    const normalCheck = normalDot >= this.NORMAL_TOLERANCE;

    if (!normalCheck) {
      return false;
    }

    // Check if faces lie on the same plane
    const face1Center = this.getFaceCenter(face1.originalVertices);
    const face2Center = this.getFaceCenter(face2.originalVertices);
    const planeDistance = this.distanceToPlane(
      face1Center,
      face2Center,
      normal2,
    );
    const planeCheck = Math.abs(planeDistance) < this.DISTANCE_TOLERANCE;

    return planeCheck;
  }

  /**
   * Merge a component of faces into a single polygon
   */
  private static mergeComponent(
    componentIndices: number[],
    faces: PolygonFace[],
  ): PolygonFace {
    if (componentIndices.length === 1) {
      return faces[componentIndices[0]];
    }

    // Combine all vertices from the component
    const allVertices: THREE.Vector3[] = [];
    const allTriangleIndices: number[] = [];

    for (const index of componentIndices) {
      const face = faces[index];
      allVertices.push(...face.originalVertices);
      allTriangleIndices.push(...(face.triangleIndices || []));
    }

    // Get unique vertices and remove center vertices (from triangle fans)
    const uniqueVertices = this.removeDuplicateVertices(allVertices);
    const perimeterVertices = this.removeInteriorVertices(uniqueVertices, faces.slice(componentIndices[0], componentIndices[0] + componentIndices.length));
    const normal = this.ensureVector3(faces[componentIndices[0]].normal);
    let orderedVertices = this.orderPolygonVertices(perimeterVertices, normal);

    // Ensure right-hand rule compliance by checking face winding
    // Calculate face normal from ordered vertices
    if (orderedVertices.length >= 3) {
      const edge1 = new THREE.Vector3().subVectors(orderedVertices[1], orderedVertices[0]);
      const edge2 = new THREE.Vector3().subVectors(orderedVertices[2], orderedVertices[0]);
      const calculatedNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      // If calculated normal doesn't match expected normal, reverse vertex order
      if (calculatedNormal.dot(normal) < 0) {
        orderedVertices = orderedVertices.reverse();
        console.log(`   ✅ Applied right-hand rule: reversed vertex order for ${orderedVertices.length}-vertex face`);
      }
    }

    // Determine face type
    const faceType =
      orderedVertices.length === 3
        ? "triangle"
        : orderedVertices.length === 4
          ? "quad"
          : "polygon";

    return {
      type: faceType,
      originalVertices: orderedVertices,
      normal: normal.clone().normalize(),
      triangleIndices: allTriangleIndices,
    };
  }

  // Helper methods (reused from existing merger)
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

  private static removeDuplicateVertices(
    vertices: THREE.Vector3[],
  ): THREE.Vector3[] {
    const unique: THREE.Vector3[] = [];

    for (const vertex of vertices) {
      const isDuplicate = unique.some(
        (existing) => existing.distanceTo(vertex) < this.DISTANCE_TOLERANCE,
      );

      if (!isDuplicate) {
        unique.push(vertex);
      }
    }

    return unique;
  }

  private static orderPolygonVertices(
    vertices: THREE.Vector3[],
    normal: THREE.Vector3,
  ): THREE.Vector3[] {
    if (vertices.length <= 3) return vertices;

    // Calculate centroid
    const centroid = new THREE.Vector3();
    for (const vertex of vertices) {
      centroid.add(vertex);
    }
    centroid.divideScalar(vertices.length);

    // Sort vertices by angle around the centroid
    return vertices.sort((a, b) => {
      const vecA = a.clone().sub(centroid);
      const vecB = b.clone().sub(centroid);

      // Project vectors onto plane perpendicular to normal
      const tangent = new THREE.Vector3(1, 0, 0);
      if (Math.abs(normal.dot(tangent)) > 0.9) {
        tangent.set(0, 1, 0);
      }
      tangent.cross(normal).normalize();

      const angleA = Math.atan2(
        vecA.dot(normal.clone().cross(tangent)),
        vecA.dot(tangent),
      );
      const angleB = Math.atan2(
        vecB.dot(normal.clone().cross(tangent)),
        vecB.dot(tangent),
      );

      return angleA - angleB;
    });
  }
}
