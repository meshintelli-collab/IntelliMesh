import * as THREE from "three";

/**
 * Interface for a polygon face with vertices and optional metadata
 */
export interface PolygonFace {
  vertices: THREE.Vector3[];
  normal?: THREE.Vector3;
  type?: string;
  index?: number;
  originalTriangulation?: number[][]; // Preserves exact original triangle vertex indices
}

/**
 * Options for polygon extrusion
 */
export interface ExtrusionOptions {
  thickness: number;
  scale: number;
  centerZ?: number; // Optional Z-center for the polygon
}

/**
 * Options for chamfering
 */
export interface ChamferOptions {
  chamferDepth: number;
  edgeAngles?: number[]; // Optional specific angles for each edge
  defaultChamferAngle?: number; // Default chamfer angle if no specific angles provided
}

/**
 * PolygonExtruder - Generalized polygon extrusion and chamfering utilities
 *
 * This class provides robust methods for creating 3D parts from polygon faces
 * with consistent geometry generation across different export types.
 */
export class PolygonExtruder {
  /**
   * Create a simple extruded polygon (prism) from vertices
   * This is the basic building block for all polygon parts
   */
  static createExtrudedPolygon(
    polygon: PolygonFace,
    options: ExtrusionOptions,
  ): string {
    const { thickness, scale, centerZ = 0 } = options;

    // Scale and position vertices
    const scaledVertices = polygon.vertices.map(
      (v) => new THREE.Vector3(v.x * scale, v.y * scale, v.z * scale + centerZ),
    );

    // Calculate or use provided normal
    let normal = polygon.normal?.clone().normalize();
    if (!normal || normal.length() < 0.001) {
      normal = this.calculatePolygonNormal(scaledVertices);
    }

    // Create front and back face vertices
    const frontVertices = scaledVertices;
    const offset = normal.clone().multiplyScalar(thickness);
    const backVertices = scaledVertices.map((v) => v.clone().add(offset));

    let stlContent = `solid extruded_polygon_${polygon.index || 0}\n`;

    // Use original triangulation if available, otherwise fall back to re-triangulation
    const polygonAny = polygon as any;
    let frontTriangles: THREE.Vector3[][];

    console.log(`🔍 DEBUGGING WINDMILLING: Polygon has ${frontVertices.length} vertices`);
    console.log(`🔍 originalTriangulation available:`, !!polygonAny.originalTriangulation);
    console.log(`🔍 originalTriangulation length:`, polygonAny.originalTriangulation?.length || 0);

    if (polygonAny.originalTriangulation && polygonAny.originalTriangulation.length > 0) {
      console.log(`✅ USING ORIGINAL TRIANGULATION to preserve exact shape (${polygonAny.originalTriangulation.length} triangles)`);
      console.log(`🎯 NO WINDMILLING: Using preserved triangulation pattern`);

      // Use original triangulation with current vertices
      frontTriangles = [];
      for (const triangle of polygonAny.originalTriangulation) {
        const v1 = frontVertices[triangle[0]];
        const v2 = frontVertices[triangle[1]];
        const v3 = frontVertices[triangle[2]];

        if (v1 && v2 && v3) {
          frontTriangles.push([v1, v2, v3]);
        } else {
          console.warn(`⚠️ Invalid triangle indices:`, triangle, `for ${frontVertices.length} vertices`);
        }
      }
      console.log(`✅ Created ${frontTriangles.length} triangles from original pattern`);
    } else {
      console.log(`❌ NO ORIGINAL TRIANGULATION - WILL CAUSE WINDMILLING!`);
      console.log(`🚨 Falling back to polygon triangulation (windmill risk)`);
      // Fallback to re-triangulation
      frontTriangles = this.triangulatePolygon(frontVertices, normal);
      console.log(`⚠️ Created ${frontTriangles.length} triangles via re-triangulation (may windmill)`);
    }

    // Front face
    for (const triangle of frontTriangles) {
      stlContent += this.addTriangleToSTL(
        triangle[0],
        triangle[1],
        triangle[2],
        normal,
      );
    }

    // Back face - same triangulation but reversed winding and offset
    const backTriangles = frontTriangles.map((triangle) =>
      triangle.map((v) => v.clone().add(offset)).reverse(),
    );
    for (const triangle of backTriangles) {
      stlContent += this.addTriangleToSTL(
        triangle[0],
        triangle[1],
        triangle[2],
        normal.clone().negate(),
      );
    }

    // Side walls
    stlContent += this.createSideWalls(frontVertices, backVertices);

    stlContent += `endsolid extruded_polygon_${polygon.index || 0}\n`;
    return stlContent;
  }

  /**
   * Create a chamfered extruded polygon with angled edges
   * This builds upon the basic extrusion and adds chamfering
   */
  static createChamferedPolygon(
    polygon: PolygonFace,
    extrusionOptions: ExtrusionOptions,
    chamferOptions: ChamferOptions,
  ): string {
    const { thickness, scale, centerZ = 0 } = extrusionOptions;
    const {
      chamferDepth,
      edgeAngles,
      defaultChamferAngle = 45,
    } = chamferOptions;

    // Scale and position vertices
    const originalVertices = polygon.vertices.map(
      (v) => new THREE.Vector3(v.x * scale, v.y * scale, v.z * scale + centerZ),
    );

    // Calculate or use provided normal
    let normal = polygon.normal?.clone().normalize();
    if (!normal || normal.length() < 0.001) {
      normal = this.calculatePolygonNormal(originalVertices);
    }

    // Generate chamfered vertices by insetting
    const chamferedVertices = this.generateChamferedVertices(
      originalVertices,
      chamferDepth,
      edgeAngles || Array(originalVertices.length).fill(defaultChamferAngle),
    );

    // Create front and back face vertices
    const frontVertices = chamferedVertices;
    const offset = normal.clone().multiplyScalar(thickness);
    const backVertices = chamferedVertices.map((v) => v.clone().add(offset));

    let stlContent = `solid chamfered_polygon_${polygon.index || 0}\n`;

    // Use original triangulation if available for chamfered polygons too
    const polygonAny = polygon as any;
    let frontTriangles: THREE.Vector3[][];

    if (polygonAny.originalTriangulation && polygonAny.originalTriangulation.length > 0) {
      console.log(`   Using original triangulation for chamfered polygon (${polygonAny.originalTriangulation.length} triangles)`);

      // Use original triangulation with chamfered vertices
      frontTriangles = [];
      for (const triangle of polygonAny.originalTriangulation) {
        const v1 = frontVertices[triangle[0]];
        const v2 = frontVertices[triangle[1]];
        const v3 = frontVertices[triangle[2]];

        if (v1 && v2 && v3) {
          frontTriangles.push([v1, v2, v3]);
        }
      }
    } else {
      console.log(`   No original triangulation found for chamfered polygon, using fallback triangulation`);
      // Fallback to re-triangulation
      frontTriangles = this.triangulatePolygon(frontVertices, normal);
    }

    // Front face
    for (const triangle of frontTriangles) {
      stlContent += this.addTriangleToSTL(
        triangle[0],
        triangle[1],
        triangle[2],
        normal,
      );
    }

    // Back face - same triangulation but reversed winding and offset
    const backTriangles = frontTriangles.map((triangle) =>
      triangle.map((v) => v.clone().add(offset)).reverse(),
    );
    for (const triangle of backTriangles) {
      stlContent += this.addTriangleToSTL(
        triangle[0],
        triangle[1],
        triangle[2],
        normal.clone().negate(),
      );
    }

    // Chamfered side walls
    stlContent += this.createChamferedSideWalls(
      frontVertices,
      backVertices,
      originalVertices,
      chamferDepth,
      edgeAngles || Array(originalVertices.length).fill(defaultChamferAngle),
    );

    stlContent += `endsolid chamfered_polygon_${polygon.index || 0}\n`;
    return stlContent;
  }

  /**
   * Generate chamfered vertices by insetting based on chamfer angles
   */
  private static generateChamferedVertices(
    originalVertices: THREE.Vector3[],
    chamferDepth: number,
    chamferAngles: number[],
  ): THREE.Vector3[] {
    const chamferedVertices: THREE.Vector3[] = [];

    for (let i = 0; i < originalVertices.length; i++) {
      const vertex = originalVertices[i];
      const prevVertex =
        originalVertices[
          (i - 1 + originalVertices.length) % originalVertices.length
        ];
      const nextVertex = originalVertices[(i + 1) % originalVertices.length];

      // Calculate inset direction
      const prevDir = new THREE.Vector3()
        .subVectors(vertex, prevVertex)
        .normalize();
      const nextDir = new THREE.Vector3()
        .subVectors(nextVertex, vertex)
        .normalize();

      // Calculate angle bisector for inset direction
      const bisector = new THREE.Vector3()
        .addVectors(prevDir, nextDir)
        .normalize();

      // Use the chamfer angle for this vertex
      const chamferAngle = chamferAngles[i] || 45;
      const insetDistance =
        chamferDepth / Math.sin((chamferAngle * Math.PI) / 180);

      // Inset the vertex
      const chamferedVertex = vertex
        .clone()
        .sub(
          bisector.multiplyScalar(Math.min(insetDistance, chamferDepth * 2)),
        );

      chamferedVertices.push(chamferedVertex);
    }

    return chamferedVertices;
  }

  /**
   * Calculate polygon normal from vertices using Newell's method
   */
  private static calculatePolygonNormal(
    vertices: THREE.Vector3[],
  ): THREE.Vector3 {
    const normal = new THREE.Vector3();

    for (let i = 0; i < vertices.length; i++) {
      const current = vertices[i];
      const next = vertices[(i + 1) % vertices.length];

      normal.x += (current.y - next.y) * (current.z + next.z);
      normal.y += (current.z - next.z) * (current.x + next.x);
      normal.z += (current.x - next.x) * (current.y + next.y);
    }

    return normal.normalize();
  }

  /**
   * Robust polygon triangulation that avoids water wheel effect
   * Uses ear clipping algorithm for better polygon decomposition
   */
  private static triangulatePolygon(
    vertices: THREE.Vector3[],
    normal: THREE.Vector3,
  ): THREE.Vector3[][] {
    const triangles: THREE.Vector3[][] = [];

    if (vertices.length < 3) return triangles;

    if (vertices.length === 3) {
      // Already a triangle
      triangles.push([vertices[0], vertices[1], vertices[2]]);
    } else if (vertices.length === 4) {
      // Quad - split into two triangles (diagonal from 0 to 2)
      triangles.push([vertices[0], vertices[1], vertices[2]]);
      triangles.push([vertices[0], vertices[2], vertices[3]]);
    } else {
      // Complex polygon - use ear clipping algorithm
      triangles.push(...this.earClippingTriangulation(vertices, normal));
    }

    return triangles;
  }

  /**
   * Ear clipping triangulation algorithm
   * Creates a more natural triangulation without water wheel artifacts
   */
  private static earClippingTriangulation(
    vertices: THREE.Vector3[],
    normal: THREE.Vector3,
  ): THREE.Vector3[][] {
    const triangles: THREE.Vector3[][] = [];

    // Create a working copy of vertex indices
    const indices: number[] = [];
    for (let i = 0; i < vertices.length; i++) {
      indices.push(i);
    }

    // Keep removing ears until we have a triangle
    while (indices.length > 3) {
      let earFound = false;

      for (let i = 0; i < indices.length; i++) {
        const prev = indices[(i - 1 + indices.length) % indices.length];
        const curr = indices[i];
        const next = indices[(i + 1) % indices.length];

        if (this.isEar(vertices, indices, prev, curr, next, normal)) {
          // Found an ear - create triangle and remove the ear tip
          triangles.push([vertices[prev], vertices[curr], vertices[next]]);

          // Remove the ear tip from the polygon
          indices.splice(i, 1);
          earFound = true;
          break;
        }
      }

      // Fallback if no ear found (degenerate polygon)
      if (!earFound) {
        console.warn("Ear clipping failed, falling back to fan triangulation");
        // Use simple fan triangulation as fallback
        for (let i = 1; i < indices.length - 1; i++) {
          triangles.push([
            vertices[indices[0]],
            vertices[indices[i]],
            vertices[indices[i + 1]],
          ]);
        }
        break;
      }
    }

    // Add the final triangle
    if (indices.length === 3) {
      triangles.push([
        vertices[indices[0]],
        vertices[indices[1]],
        vertices[indices[2]],
      ]);
    }

    return triangles;
  }

  /**
   * Check if a vertex forms an ear (a triangle that can be safely removed)
   */
  private static isEar(
    vertices: THREE.Vector3[],
    indices: number[],
    prevIdx: number,
    currIdx: number,
    nextIdx: number,
    normal: THREE.Vector3,
  ): boolean {
    const prev = vertices[prevIdx];
    const curr = vertices[currIdx];
    const next = vertices[nextIdx];

    // Check if the triangle has correct winding order
    const v1 = new THREE.Vector3().subVectors(curr, prev);
    const v2 = new THREE.Vector3().subVectors(next, curr);
    const cross = new THREE.Vector3().crossVectors(v1, v2);

    // If the cross product points in the wrong direction, it's a reflex vertex
    if (cross.dot(normal) <= 0) {
      return false;
    }

    // Check if any other vertex is inside this triangle
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      if (idx === prevIdx || idx === currIdx || idx === nextIdx) continue;

      if (this.pointInTriangle(vertices[idx], prev, curr, next)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a point is inside a triangle using barycentric coordinates
   */
  private static pointInTriangle(
    point: THREE.Vector3,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
  ): boolean {
    // Convert to 2D by projecting onto the triangle plane
    const v0 = new THREE.Vector3().subVectors(c, a);
    const v1 = new THREE.Vector3().subVectors(b, a);
    const v2 = new THREE.Vector3().subVectors(point, a);

    const dot00 = v0.dot(v0);
    const dot01 = v0.dot(v1);
    const dot02 = v0.dot(v2);
    const dot11 = v1.dot(v1);
    const dot12 = v1.dot(v2);

    const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;

    return u >= 0 && v >= 0 && u + v <= 1;
  }

  /**
   * Create side walls for a simple extruded polygon
   */
  private static createSideWalls(
    frontVertices: THREE.Vector3[],
    backVertices: THREE.Vector3[],
  ): string {
    let content = "";

    for (let i = 0; i < frontVertices.length; i++) {
      const next = (i + 1) % frontVertices.length;

      const v1 = frontVertices[i];
      const v2 = frontVertices[next];
      const v3 = backVertices[next];
      const v4 = backVertices[i];

      // Calculate normal for this side face
      const edge1 = new THREE.Vector3().subVectors(v2, v1);
      const edge2 = new THREE.Vector3().subVectors(v4, v1);
      const sideNormal = new THREE.Vector3()
        .crossVectors(edge1, edge2)
        .normalize();

      // Add two triangles to form the side quad
      content += this.addTriangleToSTL(v1, v2, v3, sideNormal);
      content += this.addTriangleToSTL(v1, v3, v4, sideNormal);
    }

    return content;
  }

  /**
   * Create chamfered side walls with angled edges
   */
  private static createChamferedSideWalls(
    frontVertices: THREE.Vector3[],
    backVertices: THREE.Vector3[],
    originalVertices: THREE.Vector3[],
    chamferDepth: number,
    chamferAngles: number[],
  ): string {
    let content = "";

    for (let i = 0; i < frontVertices.length; i++) {
      const next = (i + 1) % frontVertices.length;

      const v1 = frontVertices[i];
      const v2 = frontVertices[next];
      const v3 = backVertices[next];
      const v4 = backVertices[i];

      // Calculate chamfer angle for this edge
      const chamferAngle = chamferAngles[i] || 45;
      const chamferAngleRad = (chamferAngle * Math.PI) / 180;

      // Create chamfered edge geometry
      const edgeDirection = new THREE.Vector3().subVectors(v2, v1).normalize();
      const sideDirection = new THREE.Vector3().subVectors(v4, v1).normalize();
      const chamferNormal = new THREE.Vector3()
        .crossVectors(edgeDirection, sideDirection)
        .normalize();

      // Apply chamfer by creating angled side face
      const chamferOffset = new THREE.Vector3()
        .copy(chamferNormal)
        .multiplyScalar(chamferDepth * Math.tan(chamferAngleRad));

      const cv1 = v1.clone().add(chamferOffset);
      const cv2 = v2.clone().add(chamferOffset);
      const cv3 = v3.clone().add(chamferOffset);
      const cv4 = v4.clone().add(chamferOffset);

      // Calculate normal for the chamfered side face
      const sideNormal = new THREE.Vector3()
        .crossVectors(
          new THREE.Vector3().subVectors(cv2, cv1),
          new THREE.Vector3().subVectors(cv4, cv1),
        )
        .normalize();

      // Add chamfered side face
      content += this.addTriangleToSTL(cv1, cv2, cv3, sideNormal);
      content += this.addTriangleToSTL(cv1, cv3, cv4, sideNormal);
    }

    return content;
  }

  /**
   * Add a triangle to STL content with proper formatting
   */
  private static addTriangleToSTL(
    v1: THREE.Vector3,
    v2: THREE.Vector3,
    v3: THREE.Vector3,
    normal: THREE.Vector3,
  ): string {
    return (
      `  facet normal ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}\n` +
      `    outer loop\n` +
      `      vertex ${v1.x.toFixed(6)} ${v1.y.toFixed(6)} ${v1.z.toFixed(6)}\n` +
      `      vertex ${v2.x.toFixed(6)} ${v2.y.toFixed(6)} ${v2.z.toFixed(6)}\n` +
      `      vertex ${v3.x.toFixed(6)} ${v3.y.toFixed(6)} ${v3.z.toFixed(6)}\n` +
      `    endloop\n` +
      `  endfacet\n`
    );
  }

  /**
   * Extract polygon faces from triangulated geometry
   * This is the backup option when merged polygon faces aren't available
   */
  static extractPolygonsFromTriangulatedGeometry(
    geometry: THREE.BufferGeometry,
  ): PolygonFace[] {
    const faces: PolygonFace[] = [];
    const positions = geometry.attributes.position;

    if (!positions) return faces;

    // For triangulated geometry, each set of 3 vertices is a triangle
    for (let i = 0; i < positions.count; i += 3) {
      const vertices = [
        new THREE.Vector3(
          positions.getX(i),
          positions.getY(i),
          positions.getZ(i),
        ),
        new THREE.Vector3(
          positions.getX(i + 1),
          positions.getY(i + 1),
          positions.getZ(i + 1),
        ),
        new THREE.Vector3(
          positions.getX(i + 2),
          positions.getY(i + 2),
          positions.getZ(i + 2),
        ),
      ];

      // Calculate normal for this triangle
      const edge1 = new THREE.Vector3().subVectors(vertices[1], vertices[0]);
      const edge2 = new THREE.Vector3().subVectors(vertices[2], vertices[0]);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      faces.push({
        vertices,
        normal,
        type: "triangle",
        index: Math.floor(i / 3),
      });
    }

    return faces;
  }

  /**
   * Extract polygon faces from merged geometry
   * This uses the polygonFaces data structure when available
   */
  static extractPolygonsFromMergedGeometry(
    geometry: THREE.BufferGeometry,
  ): PolygonFace[] {
    const polygonFaces = (geometry as any).polygonFaces;

    if (!polygonFaces || !Array.isArray(polygonFaces)) {
      return [];
    }

    return polygonFaces.map((faceInfo: any, index: number) => ({
      vertices: faceInfo.originalVertices || [],
      normal: faceInfo.normal || new THREE.Vector3(0, 0, 1),
      type: faceInfo.type || "polygon",
      index,
    }));
  }
}
