import * as THREE from "three";

export interface MergedPolygon {
  vertices: THREE.Vector3[];
  normal: THREE.Vector3;
  type: string;
  originalTriangleIndices: number[];
}

/**
 * Triangle to Polygon Merger
 * Actually merges edge-adjacent coplanar triangles into larger polygons
 * Creates new BufferGeometry with fewer, larger faces
 */
export class TrianglePolygonMerger {
  private static readonly NORMAL_TOLERANCE = 0.9999; // Extremely strict for coplanar detection
  private static readonly EDGE_TOLERANCE = 0.0001; // Very tight tolerance for shared edges
  private static readonly PLANE_DISTANCE_TOLERANCE = 0.0001; // Must be on same plane
  private static readonly MIN_AREA_THRESHOLD = 0.0001; // Skip degenerate polygons

  /**
   * Main interface: merge triangles into polygons and return new geometry
   */
  static mergeTrianglesToPolygons(geometry: THREE.BufferGeometry): {
    mergedGeometry: THREE.BufferGeometry;
    polygons: MergedPolygon[];
    stats: {
      originalTriangles: number;
      mergedPolygons: number;
      triangles: number;
      quads: number;
      pentagons: number;
      hexagons: number;
      largerPolygons: number;
    };
  } {
    console.log(`🔧 TRIANGLE POLYGON MERGER: Starting merge process`);
    
    const startTime = performance.now();
    const triangles = this.extractTriangles(geometry);
    console.log(`   📊 Extracted ${triangles.length} triangles from geometry`);

    // Build adjacency graph
    const adjacencyGraph = this.buildAdjacencyGraph(triangles);
    console.log(`   📊 Built adjacency graph`);

    // Find connected components of coplanar triangles
    const components = this.findCoplanarComponents(triangles, adjacencyGraph);
    console.log(`   📊 Found ${components.length} connected components`);

    // Merge components into polygons
    const polygons = this.mergeComponentsToPolygons(triangles, components);
    console.log(`   📊 Created ${polygons.length} merged polygons`);

    // Create new geometry from polygons
    const mergedGeometry = this.createGeometryFromPolygons(polygons);
    console.log(`   📊 Generated new merged geometry`);

    // Calculate stats
    const stats = this.calculateStats(triangles.length, polygons);
    
    const processingTime = performance.now() - startTime;
    console.log(`✅ MERGE COMPLETE: ${triangles.length} triangles → ${polygons.length} polygons in ${processingTime.toFixed(1)}ms`);
    console.log(`   📊 Reduction: ${((triangles.length - polygons.length) / triangles.length * 100).toFixed(1)}%`);

    return {
      mergedGeometry,
      polygons,
      stats
    };
  }

  /**
   * Extract triangles with their properties
   */
  private static extractTriangles(geometry: THREE.BufferGeometry): Triangle[] {
    const positions = geometry.attributes.position;
    const triangles: Triangle[] = [];

    for (let i = 0; i < positions.count; i += 3) {
      const v1 = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
      const v2 = new THREE.Vector3(positions.getX(i + 1), positions.getY(i + 1), positions.getZ(i + 1));
      const v3 = new THREE.Vector3(positions.getX(i + 2), positions.getY(i + 2), positions.getZ(i + 2));

      // Calculate normal using right-hand rule
      const edge1 = new THREE.Vector3().subVectors(v2, v1);
      const edge2 = new THREE.Vector3().subVectors(v3, v1);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      // Skip degenerate triangles
      if (normal.length() > 0.001) {
        triangles.push({
          vertices: [v1, v2, v3],
          normal: normal,
          index: Math.floor(i / 3),
          edges: [
            [v1, v2],
            [v2, v3],
            [v3, v1]
          ]
        });
      }
    }

    return triangles;
  }

  /**
   * Build adjacency graph based on shared edges and coplanarity
   */
  private static buildAdjacencyGraph(triangles: Triangle[]): Map<number, Set<number>> {
    console.log(`   🔍 BUILDING ADJACENCY GRAPH: Checking ${triangles.length} triangles for edge adjacency`);

    const graph = new Map<number, Set<number>>();
    let adjacentPairs = 0;

    // Initialize
    triangles.forEach((_, index) => {
      graph.set(index, new Set());
    });

    // Check each pair of triangles
    let checkedPairs = 0;
    const maxDebugPairs = 10; // Only log first 10 pairs for debugging

    for (let i = 0; i < triangles.length; i++) {
      for (let j = i + 1; j < triangles.length; j++) {
        const shouldDebug = checkedPairs < maxDebugPairs;
        if (shouldDebug) {
          console.log(`   🔍 Checking triangles ${i} and ${j}:`);
        }

        if (this.canMergeTriangles(triangles[i], triangles[j])) {
          graph.get(i)!.add(j);
          graph.get(j)!.add(i);
          adjacentPairs++;
          console.log(`   ✅ Added adjacency: ${i} ↔ ${j}`);
        }

        checkedPairs++;
      }
    }

    console.log(`   📊 Found ${adjacentPairs} adjacent pairs out of ${(triangles.length * (triangles.length - 1)) / 2} possible pairs`);
    return graph;
  }

  /**
   * Check if two triangles can be merged (coplanar + shared edge)
   * STRICT: Must share a complete edge AND be on the exact same plane
   */
  private static canMergeTriangles(tri1: Triangle, tri2: Triangle): boolean {
    // 1. Check normal alignment (must be nearly parallel)
    const normalDot = Math.abs(tri1.normal.dot(tri2.normal));
    if (normalDot < this.NORMAL_TOLERANCE) {
      return false;
    }

    // 2. Check if triangles lie on the same plane
    if (!this.areOnSamePlane(tri1, tri2)) {
      return false;
    }

    // 3. Check for shared edge (complete edge, not just vertices)
    const hasSharedEdge = this.shareEdge(tri1, tri2);
    if (!hasSharedEdge) {
      return false;
    }

    return true;
  }

  /**
   * Check if two triangles lie on the same plane
   * Not just parallel normals, but actually on the same geometric plane
   */
  private static areOnSamePlane(tri1: Triangle, tri2: Triangle): boolean {
    // Use first vertex of tri1 as reference point on the plane
    const planePoint = tri1.vertices[0];
    const planeNormal = tri1.normal;

    // Check if all vertices of tri2 lie on the same plane
    for (const vertex of tri2.vertices) {
      const vectorToVertex = vertex.clone().sub(planePoint);
      const distanceToPlane = Math.abs(vectorToVertex.dot(planeNormal));

      if (distanceToPlane > this.PLANE_DISTANCE_TOLERANCE) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if two triangles share a complete edge (not just vertices!)
   * STRICT: Both endpoints of the edge must match exactly
   */
  private static shareEdge(tri1: Triangle, tri2: Triangle): boolean {
    for (let i = 0; i < tri1.edges.length; i++) {
      const edge1 = tri1.edges[i];
      for (let j = 0; j < tri2.edges.length; j++) {
        const edge2 = tri2.edges[j];
        if (this.edgesMatch(edge1, edge2)) {
          console.log(`     🔗 Found shared edge: Tri${tri1.index} edge ${i} matches Tri${tri2.index} edge ${j}`);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if two edges match (same vertices, any direction)
   * VERY STRICT: Both endpoints must be within extremely tight tolerance
   */
  private static edgesMatch(edge1: [THREE.Vector3, THREE.Vector3], edge2: [THREE.Vector3, THREE.Vector3]): boolean {
    const [a1, b1] = edge1;
    const [a2, b2] = edge2;

    // Check both orientations with very strict tolerance
    const dist_a1_a2 = a1.distanceTo(a2);
    const dist_b1_b2 = b1.distanceTo(b2);
    const dist_a1_b2 = a1.distanceTo(b2);
    const dist_b1_a2 = b1.distanceTo(a2);

    const forwardMatch = dist_a1_a2 < this.EDGE_TOLERANCE && dist_b1_b2 < this.EDGE_TOLERANCE;
    const reverseMatch = dist_a1_b2 < this.EDGE_TOLERANCE && dist_b1_a2 < this.EDGE_TOLERANCE;

    return forwardMatch || reverseMatch;
  }

  /**
   * Find connected components using DFS
   */
  private static findCoplanarComponents(triangles: Triangle[], graph: Map<number, Set<number>>): number[][] {
    const visited = new Set<number>();
    const components: number[][] = [];

    for (let i = 0; i < triangles.length; i++) {
      if (!visited.has(i)) {
        const component = this.dfsComponent(i, graph, visited);
        components.push(component);
      }
    }

    return components;
  }

  /**
   * DFS to find connected component
   */
  private static dfsComponent(start: number, graph: Map<number, Set<number>>, visited: Set<number>): number[] {
    const component: number[] = [];
    const stack = [start];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;

      visited.add(current);
      component.push(current);

      const neighbors = graph.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }

    return component;
  }

  /**
   * Merge components into polygons
   */
  private static mergeComponentsToPolygons(triangles: Triangle[], components: number[][]): MergedPolygon[] {
    const polygons: MergedPolygon[] = [];

    for (const component of components) {
      if (component.length === 1) {
        // Single triangle
        const tri = triangles[component[0]];
        polygons.push({
          vertices: tri.vertices,
          normal: tri.normal,
          type: "triangle",
          originalTriangleIndices: [tri.index]
        });
      } else {
        // Multiple triangles - merge into polygon
        const mergedPolygon = this.mergeTriangleComponent(triangles, component);
        if (mergedPolygon) {
          polygons.push(mergedPolygon);
        } else {
          // Fallback: keep as individual triangles
          for (const triIndex of component) {
            const tri = triangles[triIndex];
            polygons.push({
              vertices: tri.vertices,
              normal: tri.normal,
              type: "triangle",
              originalTriangleIndices: [tri.index]
            });
          }
        }
      }
    }

    return polygons;
  }

  /**
   * Merge a component of triangles into a single polygon
   */
  private static mergeTriangleComponent(triangles: Triangle[], componentIndices: number[]): MergedPolygon | null {
    try {
      // Collect all vertices
      const allVertices: THREE.Vector3[] = [];
      const originalIndices: number[] = [];
      
      for (const index of componentIndices) {
        const tri = triangles[index];
        allVertices.push(...tri.vertices);
        originalIndices.push(tri.index);
      }

      // Find unique vertices (remove duplicates)
      const uniqueVertices = this.removeDuplicateVertices(allVertices);
      
      if (uniqueVertices.length < 3) {
        return null; // Degenerate
      }

      // Get normal from first triangle
      const referenceNormal = triangles[componentIndices[0]].normal;

      // Order vertices to form a proper polygon with right-hand rule
      const orderedVertices = this.orderVerticesRightHandRule(uniqueVertices, referenceNormal);

      // Validate the polygon
      if (!this.isValidPolygon(orderedVertices)) {
        return null;
      }

      const polygonType = this.getPolygonType(orderedVertices.length);

      return {
        vertices: orderedVertices,
        normal: referenceNormal.clone(),
        type: polygonType,
        originalTriangleIndices: originalIndices
      };
    } catch (error) {
      console.warn(`⚠️ Failed to merge component:`, error);
      return null;
    }
  }

  /**
   * Remove duplicate vertices within tolerance
   */
  private static removeDuplicateVertices(vertices: THREE.Vector3[]): THREE.Vector3[] {
    const unique: THREE.Vector3[] = [];

    for (const vertex of vertices) {
      const isDuplicate = unique.some(existing => 
        existing.distanceTo(vertex) < this.EDGE_TOLERANCE
      );

      if (!isDuplicate) {
        unique.push(vertex.clone());
      }
    }

    return unique;
  }

  /**
   * Order vertices around polygon perimeter using right-hand rule
   */
  private static orderVerticesRightHandRule(vertices: THREE.Vector3[], normal: THREE.Vector3): THREE.Vector3[] {
    if (vertices.length <= 3) {
      return vertices;
    }

    // Find centroid
    const centroid = new THREE.Vector3();
    vertices.forEach(v => centroid.add(v));
    centroid.divideScalar(vertices.length);

    // Create coordinate system with normal as Z-axis
    const tempZ = normal.clone().normalize();
    const tempX = new THREE.Vector3(1, 0, 0);
    if (Math.abs(tempZ.dot(tempX)) > 0.9) {
      tempX.set(0, 1, 0);
    }
    tempX.crossVectors(tempZ, tempX).normalize();
    const tempY = new THREE.Vector3().crossVectors(tempZ, tempX);

    // Convert vertices to 2D polar coordinates
    const polarVertices = vertices.map((vertex, index) => {
      const relative = vertex.clone().sub(centroid);
      const x = relative.dot(tempX);
      const y = relative.dot(tempY);
      const angle = Math.atan2(y, x);
      
      return {
        vertex: vertex,
        angle: angle,
        index: index
      };
    });

    // Sort by angle (counter-clockwise when viewed along normal direction)
    polarVertices.sort((a, b) => a.angle - b.angle);

    return polarVertices.map(pv => pv.vertex);
  }

  /**
   * Validate polygon (non-degenerate, reasonable area)
   */
  private static isValidPolygon(vertices: THREE.Vector3[]): boolean {
    if (vertices.length < 3) return false;

    // Calculate area using shoelace formula (projected to XY plane)
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      area += vertices[i].x * vertices[next].y - vertices[next].x * vertices[i].y;
    }
    area = Math.abs(area) / 2;

    return area > this.MIN_AREA_THRESHOLD;
  }

  /**
   * Get polygon type name
   */
  private static getPolygonType(vertexCount: number): string {
    switch (vertexCount) {
      case 3: return "triangle";
      case 4: return "quad";
      case 5: return "pentagon";
      case 6: return "hexagon";
      case 7: return "heptagon";
      case 8: return "octagon";
      default: return "polygon";
    }
  }

  /**
   * Create new BufferGeometry from merged polygons
   */
  private static createGeometryFromPolygons(polygons: MergedPolygon[]): THREE.BufferGeometry {
    const vertices: number[] = [];
    
    for (const polygon of polygons) {
      // Triangulate polygon using fan triangulation
      const triangulatedVertices = this.triangulatePolygon(polygon.vertices);
      vertices.push(...triangulatedVertices);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Triangulate polygon using fan triangulation from first vertex
   */
  private static triangulatePolygon(vertices: THREE.Vector3[]): number[] {
    const triangulatedVertices: number[] = [];

    if (vertices.length === 3) {
      // Already a triangle
      vertices.forEach(v => {
        triangulatedVertices.push(v.x, v.y, v.z);
      });
    } else {
      // Fan triangulation
      for (let i = 1; i < vertices.length - 1; i++) {
        const v1 = vertices[0];
        const v2 = vertices[i];
        const v3 = vertices[i + 1];
        
        triangulatedVertices.push(
          v1.x, v1.y, v1.z,
          v2.x, v2.y, v2.z,
          v3.x, v3.y, v3.z
        );
      }
    }

    return triangulatedVertices;
  }

  /**
   * Calculate statistics
   */
  private static calculateStats(originalTriangles: number, polygons: MergedPolygon[]) {
    const stats = {
      originalTriangles,
      mergedPolygons: polygons.length,
      triangles: 0,
      quads: 0,
      pentagons: 0,
      hexagons: 0,
      largerPolygons: 0
    };

    polygons.forEach(polygon => {
      switch (polygon.type) {
        case "triangle": stats.triangles++; break;
        case "quad": stats.quads++; break;
        case "pentagon": stats.pentagons++; break;
        case "hexagon": stats.hexagons++; break;
        default: stats.largerPolygons++; break;
      }
    });

    return stats;
  }
}

interface Triangle {
  vertices: THREE.Vector3[];
  normal: THREE.Vector3;
  index: number;
  edges: [THREE.Vector3, THREE.Vector3][];
}
