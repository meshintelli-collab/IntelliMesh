import * as THREE from "three";

export interface PolygonFace {
  type: string;
  originalVertices: THREE.Vector3[];
  normal: THREE.Vector3;
  triangleIndices?: number[];
  originalTriangulation?: number[][]; // Preserves exact original triangle vertex indices
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
  private static readonly DISTANCE_TOLERANCE = 0.1; // More permissive for procedural shapes
  private static readonly NORMAL_TOLERANCE = 0.99; // More permissive but still reasonable
  private static readonly EDGE_TOLERANCE = 0.1; // Much more permissive for edge matching

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
    console.log(`🔧 CONSERVATIVE MERGING: Starting with ${faces.length} triangles`);

    // Debug first few faces to understand the geometry
    for (let i = 0; i < Math.min(3, faces.length); i++) {
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

    console.log(
      `   📊 Found ${components.length} components from ${faces.length} triangles`,
    );

    // CONSERVATIVE MERGING: Only merge simple components, preserve complex ones
    const mergedFaces: PolygonFace[] = [];

    for (const component of components) {
      if (component.length === 1) {
        // Single triangle - keep as is
        mergedFaces.push(faces[component[0]]);
      } else if (component.length === 2) {
        // Two triangles - try to merge into quad, otherwise keep separate
        const quadResult = this.tryMergeToQuad(component, faces);
        if (quadResult) {
          mergedFaces.push(quadResult);
        } else {
          // Keep as separate triangles
          mergedFaces.push(faces[component[0]]);
          mergedFaces.push(faces[component[1]]);
        }
      } else if (component.length <= 8) {
        // Medium component (3-8 triangles) - try to merge into polygon
        console.log(`   🔧 ATTEMPTING to merge ${component.length} triangles into polygon`);
        const polygonResult = this.mergeComponent(component, faces);
        if (polygonResult && this.isReasonablePolygon(polygonResult)) {
          mergedFaces.push(polygonResult);
          console.log(`   ✅ Created ${polygonResult.type} from ${component.length} triangles`);
        } else {
          // Fallback: keep as separate triangles
          console.log(`   ⚠️ Merge failed, preserving ${component.length} triangles separately`);
          for (const triangleIndex of component) {
            mergedFaces.push(faces[triangleIndex]);
          }
        }
      } else {
        // Very complex component (9+ triangles) - DON'T MERGE to avoid windmilling
        console.log(`   ���� PRESERVING ${component.length} triangles separately (too complex, avoid windmilling)`);
        for (const triangleIndex of component) {
          mergedFaces.push(faces[triangleIndex]);
        }
      }
    }

    console.log(
      `✅ CONSERVATIVE OUTPUT: ${mergedFaces.length} faces (preserved complex shapes)`,
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

    console.log(`   📊 Found ${sharedEdgeCount} shared edges among ${faces.length} faces`);
    console.log(`   📊 ${connectedFaces} faces have connections, ${faces.length - connectedFaces} are isolated`);

    if (sharedEdgeCount === 0) {
      console.warn(`   ⚠️ NO SHARED EDGES FOUND! This suggests triangles don't share complete edges`);
      console.log(`   📊 Edge tolerance: ${this.EDGE_TOLERANCE}, Normal tolerance: ${this.NORMAL_TOLERANCE}`);

      // Debug first few triangles to understand the issue
      for (let i = 0; i < Math.min(2, faces.length); i++) {
        const face = faces[i];
        console.log(`   🔍 Face ${i} edges:`, face.originalVertices.map((v, idx) =>
          `${idx}: (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`
        ));
      }
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
    // First check coplanarity to avoid unnecessary edge checks
    if (!this.facesAreCoplanar(face1, face2)) {
      return false;
    }

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
    const componentFaces = componentIndices.map((index) => faces[index]);
    const perimeterVertices = this.removeInteriorVertices(
      uniqueVertices,
      componentFaces,
    );
    const normal = this.ensureVector3(faces[componentIndices[0]].normal);
    let orderedVertices = this.orderPolygonVertices(perimeterVertices, normal);

    // Ensure right-hand rule compliance by checking face winding
    // Calculate face normal from ordered vertices
    if (orderedVertices.length >= 3) {
      const edge1 = new THREE.Vector3().subVectors(
        orderedVertices[1],
        orderedVertices[0],
      );
      const edge2 = new THREE.Vector3().subVectors(
        orderedVertices[2],
        orderedVertices[0],
      );
      const calculatedNormal = new THREE.Vector3()
        .crossVectors(edge1, edge2)
        .normalize();

      // If calculated normal doesn't match expected normal, reverse vertex order
      if (calculatedNormal.dot(normal) < 0) {
        orderedVertices = orderedVertices.reverse();
        console.log(
          `   ✅ Applied right-hand rule: reversed vertex order for ${orderedVertices.length}-vertex face`,
        );
      }
    }

    // Determine face type
    const faceType =
      orderedVertices.length === 3
        ? "triangle"
        : orderedVertices.length === 4
          ? "quad"
          : "polygon";

    // Store the original triangulation pattern to preserve exact shape
    const originalTriangulation = this.preserveOriginalTriangulation(
      componentIndices,
      faces,
      orderedVertices
    );

    return {
      type: faceType,
      originalVertices: orderedVertices,
      normal: normal.clone().normalize(),
      triangleIndices: allTriangleIndices,
      originalTriangulation: originalTriangulation, // Preserve original shape
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

  /**
   * Remove interior vertices (like triangle fan centers) that aren't part of the polygon perimeter
   */
  private static removeInteriorVertices(
    vertices: THREE.Vector3[],
    faces: PolygonFace[],
  ): THREE.Vector3[] {
    if (vertices.length <= 3) {
      return vertices; // Can't remove vertices from triangles
    }

    // Count how many triangles each vertex appears in
    const vertexUsageCount = new Map<
      string,
      { vertex: THREE.Vector3; count: number; triangles: number[] }
    >();

    faces.forEach((face, faceIndex) => {
      face.originalVertices.forEach((vertex) => {
        const key = `${vertex.x.toFixed(6)},${vertex.y.toFixed(6)},${vertex.z.toFixed(6)}`;
        if (!vertexUsageCount.has(key)) {
          vertexUsageCount.set(key, {
            vertex: vertex.clone(),
            count: 0,
            triangles: [],
          });
        }
        const entry = vertexUsageCount.get(key)!;
        entry.count++;
        entry.triangles.push(faceIndex);
      });
    });

    // Interior vertices (like triangle fan centers) appear in ALL triangles of the component
    // Perimeter vertices appear in exactly 2 triangles (shared edge) or 1 triangle (boundary)
    const totalTriangles = faces.length;
    const perimeterVertices: THREE.Vector3[] = [];

    for (const [key, entry] of vertexUsageCount) {
      // If a vertex appears in ALL triangles, it's likely a center vertex
      if (entry.count === totalTriangles && totalTriangles > 2) {
        console.log(
          `   🗑️ Removing center vertex that appears in all ${totalTriangles} triangles`,
        );
        continue; // Skip center vertices
      }

      perimeterVertices.push(entry.vertex);
    }

    console.log(
      `   ✅ Filtered vertices: ${vertices.length} → ${perimeterVertices.length} (removed ${vertices.length - perimeterVertices.length} center vertices)`,
    );

    return perimeterVertices.length >= 3 ? perimeterVertices : vertices; // Fallback to original if filtering went wrong
  }

  private static orderPolygonVertices(
    vertices: THREE.Vector3[],
    normal: THREE.Vector3,
  ): THREE.Vector3[] {
    if (vertices.length <= 3) return vertices;

    console.log(`   🔧 Ordering ${vertices.length} vertices to preserve original shape (NO windmilling)`);

    // For preserving original polygon shape, we need to trace the edges instead of sorting by angle
    // This prevents the windmill effect that angular sorting creates
    const orderedVertices = this.tracePolygonPerimeter(vertices);

    console.log(`   ✅ Traced polygon perimeter: ${orderedVertices.length} vertices in correct order`);
    return orderedVertices;
  }

  /**
   * Preserve exact triangle connectivity to maintain original polygon shape
   * NO reordering, NO sorting - use the actual edge connections from triangulation
   */
  private static tracePolygonPerimeter(vertices: THREE.Vector3[]): THREE.Vector3[] {
    if (vertices.length <= 3) return vertices;

    console.log(`   🚫 AVOIDING vertex reordering to prevent windmilling on ${vertices.length} vertices`);

    // Return vertices in their original order without any reordering
    // The original triangulation order is what we want to preserve
    return vertices;
  }

  /**
   * Preserve the original triangulation pattern when merging triangles into polygons
   * This ensures that parts export can use the exact original shape structure
   */
  private static preserveOriginalTriangulation(
    componentIndices: number[],
    faces: PolygonFace[],
    orderedVertices: THREE.Vector3[]
  ): number[][] {
    const originalTriangulation: number[][] = [];

    console.log(`   🔧 Preserving original triangulation for ${componentIndices.length} triangles`);

    // For each triangle in the component, map its vertices to the ordered vertices array
    for (const triangleIndex of componentIndices) {
      const triangle = faces[triangleIndex];
      const triangleVertices = triangle.originalVertices;

      if (triangleVertices.length === 3) {
        // Find the indices of these triangle vertices in the ordered vertices array
        const indices: number[] = [];

        for (const triVertex of triangleVertices) {
          // Find the matching vertex in the ordered array
          let matchIndex = -1;
          for (let i = 0; i < orderedVertices.length; i++) {
            if (triVertex.distanceTo(orderedVertices[i]) < this.EDGE_TOLERANCE) {
              matchIndex = i;
              break;
            }
          }

          if (matchIndex !== -1) {
            indices.push(matchIndex);
          }
        }

        // Only add if we found all 3 vertices
        if (indices.length === 3) {
          originalTriangulation.push(indices);
        }
      }
    }

    console.log(`   ✅ Preserved ${originalTriangulation.length} triangles in original pattern`);
    return originalTriangulation;
  }

  /**
   * Try to merge two triangles into a quad (conservative approach)
   * Only merge if they form a clean rectangular quad
   */
  private static tryMergeToQuad(componentIndices: number[], faces: PolygonFace[]): PolygonFace | null {
    if (componentIndices.length !== 2) return null;

    const face1 = faces[componentIndices[0]];
    const face2 = faces[componentIndices[1]];

    // Get all vertices from both triangles
    const allVertices = [...face1.originalVertices, ...face2.originalVertices];

    // Remove duplicates to find unique vertices
    const uniqueVertices = this.removeDuplicateVertices(allVertices);

    // Should have exactly 4 unique vertices for a quad
    if (uniqueVertices.length !== 4) {
      return null; // Not a clean quad
    }

    // Check if the vertices form a reasonable quad (not too distorted)
    if (!this.isReasonableQuad(uniqueVertices)) {
      return null; // Too distorted, keep as triangles
    }

    // Create quad with simple vertex ordering (no complex reordering)
    const normal = this.ensureVector3(face1.normal);

    console.log(`   ✅ Merged 2 triangles into clean quad`);

    return {
      type: "quad",
      originalVertices: uniqueVertices, // Keep simple order
      normal: normal.clone().normalize(),
      triangleIndices: [componentIndices[0], componentIndices[1]],
      originalTriangulation: [[0, 1, 2], [0, 2, 3]], // Standard quad triangulation
    };
  }

  /**
   * Check if 4 vertices form a reasonable quad (not too distorted)
   */
  private static isReasonableQuad(vertices: THREE.Vector3[]): boolean {
    if (vertices.length !== 4) return false;

    // Simple check: all edges should be roughly similar length
    const distances: number[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      distances.push(vertices[i].distanceTo(vertices[next]));
    }

    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    const maxVariation = Math.max(...distances) / Math.min(...distances);

    // If any edge is more than 3x longer than others, probably not a good quad
    return maxVariation < 3;
  }

  /**
   * Check if a polygon is reasonable (not degenerate or too distorted)
   */
  private static isReasonablePolygon(polygon: PolygonFace): boolean {
    const vertices = polygon.originalVertices || polygon.vertices || [];

    if (vertices.length < 3) return false;
    if (vertices.length > 12) return false; // Too many vertices likely means bad merging

    // Calculate area to check for degenerate polygons
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      area += vertices[i].x * vertices[next].y - vertices[next].x * vertices[i].y;
    }
    area = Math.abs(area) / 2;

    if (area < 0.001) return false; // Too small/degenerate

    // Check edge length variation
    const distances: number[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      distances.push(vertices[i].distanceTo(vertices[next]));
    }

    if (distances.length === 0) return false;

    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    const maxVariation = Math.max(...distances) / Math.min(...distances);

    // Allow reasonable variation but not extreme distortion
    return maxVariation < 4;
  }
}
