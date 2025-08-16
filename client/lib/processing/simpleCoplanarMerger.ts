import * as THREE from "three";

export interface SimpleMergedFace {
  vertices: THREE.Vector3[];
  normal: THREE.Vector3;
  type: "triangle" | "quad";
  originalTriangleIndices: number[];
}

/**
 * Simple Coplanar Merger
 * Only merges PAIRS of triangles that share a complete edge and are coplanar
 * Much simpler and safer than complex polygon merging
 */
export class SimpleCoplanarMerger {
  private static readonly NORMAL_TOLERANCE = 0.9999; // Very strict coplanar check
  private static readonly EDGE_TOLERANCE = 0.0001; // Very strict edge matching
  private static readonly PLANE_TOLERANCE = 0.0001; // Must be on same plane

  /**
   * Main interface: merge pairs of coplanar triangles
   */
  static mergePairsOnly(geometry: THREE.BufferGeometry): {
    mergedGeometry: THREE.BufferGeometry;
    faces: SimpleMergedFace[];
    stats: {
      originalTriangles: number;
      finalFaces: number;
      triangles: number;
      quads: number;
      mergedPairs: number;
    };
  } {
    console.log(`🔧 SIMPLE COPLANAR MERGER: Starting with triangles only`);
    
    const triangles = this.extractTriangles(geometry);
    console.log(`   📊 Extracted ${triangles.length} triangles`);

    // Find pairs that can be merged
    const mergedFaces = this.findAndMergePairs(triangles);
    console.log(`   📊 Created ${mergedFaces.length} faces from ${triangles.length} triangles`);

    // Create new geometry
    const mergedGeometry = this.createGeometryFromFaces(mergedFaces);

    // Calculate stats
    const stats = this.calculateStats(triangles.length, mergedFaces);
    
    console.log(`✅ SIMPLE MERGE COMPLETE: ${triangles.length} triangles → ${mergedFaces.length} faces`);
    console.log(`   📊 ${stats.quads} quads, ${stats.triangles} triangles, ${stats.mergedPairs} pairs merged`);

    return {
      mergedGeometry,
      faces: mergedFaces,
      stats
    };
  }

  /**
   * Extract triangles from geometry
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

      if (normal.length() > 0.001) {
        triangles.push({
          vertices: [v1, v2, v3],
          normal: normal,
          index: Math.floor(i / 3),
          used: false
        });
      }
    }

    return triangles;
  }

  /**
   * Find pairs of triangles that can be merged and merge them
   * Only handles pairs - no complex polygons
   */
  private static findAndMergePairs(triangles: Triangle[]): SimpleMergedFace[] {
    const faces: SimpleMergedFace[] = [];
    let mergedPairs = 0;

    // Mark all triangles as unused
    triangles.forEach(tri => tri.used = false);

    // Try to pair each triangle with another
    for (let i = 0; i < triangles.length; i++) {
      if (triangles[i].used) continue;

      let merged = false;

      // Look for a partner for this triangle
      for (let j = i + 1; j < triangles.length; j++) {
        if (triangles[j].used) continue;

        // Check if these two triangles can be merged
        if (this.canMergeTrianglePair(triangles[i], triangles[j])) {
          console.log(`   ✅ Merging triangles ${i} and ${j} into quad`);
          
          // Merge the two triangles into a quad
          const quad = this.mergeTwoTriangles(triangles[i], triangles[j]);
          if (quad) {
            faces.push(quad);
            triangles[i].used = true;
            triangles[j].used = true;
            merged = true;
            mergedPairs++;
            break; // Found a partner, move to next triangle
          }
        }
      }

      // If no partner found, keep as triangle
      if (!merged) {
        faces.push({
          vertices: triangles[i].vertices,
          normal: triangles[i].normal,
          type: "triangle",
          originalTriangleIndices: [triangles[i].index]
        });
        triangles[i].used = true;
      }
    }

    return faces;
  }

  /**
   * Check if two specific triangles can be merged
   * STRICT: must share complete edge and be coplanar
   */
  private static canMergeTrianglePair(tri1: Triangle, tri2: Triangle): boolean {
    // 1. Check coplanarity (normals must be nearly parallel)
    const normalDot = Math.abs(tri1.normal.dot(tri2.normal));
    if (normalDot < this.NORMAL_TOLERANCE) {
      return false;
    }

    // 2. Check if on same plane
    if (!this.areCoplanar(tri1, tri2)) {
      return false;
    }

    // 3. Check for shared edge
    return this.shareCompleteEdge(tri1, tri2);
  }

  /**
   * Check if two triangles are coplanar (on same geometric plane)
   */
  private static areCoplanar(tri1: Triangle, tri2: Triangle): boolean {
    const planePoint = tri1.vertices[0];
    const planeNormal = tri1.normal;

    // All vertices of tri2 must lie on the plane of tri1
    for (const vertex of tri2.vertices) {
      const vectorToVertex = vertex.clone().sub(planePoint);
      const distanceToPlane = Math.abs(vectorToVertex.dot(planeNormal));
      
      if (distanceToPlane > this.PLANE_TOLERANCE) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if two triangles share a complete edge
   */
  private static shareCompleteEdge(tri1: Triangle, tri2: Triangle): boolean {
    const edges1 = this.getTriangleEdges(tri1);
    const edges2 = this.getTriangleEdges(tri2);

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
   * Get edges of a triangle
   */
  private static getTriangleEdges(triangle: Triangle): [THREE.Vector3, THREE.Vector3][] {
    const [v1, v2, v3] = triangle.vertices;
    return [
      [v1, v2],
      [v2, v3],
      [v3, v1]
    ];
  }

  /**
   * Check if two edges match (same endpoints, any direction)
   */
  private static edgesMatch(edge1: [THREE.Vector3, THREE.Vector3], edge2: [THREE.Vector3, THREE.Vector3]): boolean {
    const [a1, b1] = edge1;
    const [a2, b2] = edge2;

    const forwardMatch = a1.distanceTo(a2) < this.EDGE_TOLERANCE && b1.distanceTo(b2) < this.EDGE_TOLERANCE;
    const reverseMatch = a1.distanceTo(b2) < this.EDGE_TOLERANCE && b1.distanceTo(a2) < this.EDGE_TOLERANCE;

    return forwardMatch || reverseMatch;
  }

  /**
   * Merge two triangles into a quad with correct winding
   */
  private static mergeTwoTriangles(tri1: Triangle, tri2: Triangle): SimpleMergedFace | null {
    try {
      // Get all unique vertices from both triangles
      const allVertices = [...tri1.vertices, ...tri2.vertices];
      const uniqueVertices = this.removeDuplicateVertices(allVertices);

      // Should have exactly 4 unique vertices for a quad
      if (uniqueVertices.length !== 4) {
        console.warn(`   ⚠️ Expected 4 unique vertices, got ${uniqueVertices.length}`);
        return null;
      }

      // Order vertices with correct winding (right-hand rule)
      const orderedVertices = this.orderQuadVertices(uniqueVertices, tri1.normal);

      return {
        vertices: orderedVertices,
        normal: tri1.normal.clone(),
        type: "quad",
        originalTriangleIndices: [tri1.index, tri2.index]
      };
    } catch (error) {
      console.warn(`   ⚠️ Failed to merge triangles:`, error);
      return null;
    }
  }

  /**
   * Remove duplicate vertices
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
   * Order quad vertices with correct winding (right-hand rule)
   */
  private static orderQuadVertices(vertices: THREE.Vector3[], normal: THREE.Vector3): THREE.Vector3[] {
    if (vertices.length !== 4) {
      return vertices;
    }

    // Find centroid
    const centroid = new THREE.Vector3();
    vertices.forEach(v => centroid.add(v));
    centroid.divideScalar(4);

    // Create local coordinate system
    const zAxis = normal.clone().normalize();
    let xAxis = new THREE.Vector3(1, 0, 0);
    if (Math.abs(zAxis.dot(xAxis)) > 0.9) {
      xAxis = new THREE.Vector3(0, 1, 0);
    }
    xAxis = xAxis.cross(zAxis).normalize();
    const yAxis = zAxis.clone().cross(xAxis);

    // Convert to polar coordinates and sort
    const polarVertices = vertices.map(vertex => {
      const relative = vertex.clone().sub(centroid);
      const x = relative.dot(xAxis);
      const y = relative.dot(yAxis);
      const angle = Math.atan2(y, x);
      
      return { vertex, angle };
    });

    // Sort by angle (counter-clockwise)
    polarVertices.sort((a, b) => a.angle - b.angle);

    return polarVertices.map(pv => pv.vertex);
  }

  /**
   * Create geometry from merged faces
   */
  private static createGeometryFromFaces(faces: SimpleMergedFace[]): THREE.BufferGeometry {
    const vertices: number[] = [];

    for (const face of faces) {
      if (face.type === "triangle") {
        // Add triangle vertices directly
        face.vertices.forEach(v => {
          vertices.push(v.x, v.y, v.z);
        });
      } else if (face.type === "quad") {
        // Triangulate quad: two triangles
        const [v1, v2, v3, v4] = face.vertices;
        
        // Triangle 1: v1, v2, v3
        vertices.push(v1.x, v1.y, v1.z);
        vertices.push(v2.x, v2.y, v2.z);
        vertices.push(v3.x, v3.y, v3.z);
        
        // Triangle 2: v1, v3, v4
        vertices.push(v1.x, v1.y, v1.z);
        vertices.push(v3.x, v3.y, v3.z);
        vertices.push(v4.x, v4.y, v4.z);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Calculate statistics
   */
  private static calculateStats(originalTriangles: number, faces: SimpleMergedFace[]) {
    let triangles = 0;
    let quads = 0;
    let mergedPairs = 0;

    faces.forEach(face => {
      if (face.type === "triangle") {
        triangles++;
      } else if (face.type === "quad") {
        quads++;
        mergedPairs++;
      }
    });

    return {
      originalTriangles,
      finalFaces: faces.length,
      triangles,
      quads,
      mergedPairs
    };
  }
}

interface Triangle {
  vertices: THREE.Vector3[];
  normal: THREE.Vector3;
  index: number;
  used: boolean;
}
