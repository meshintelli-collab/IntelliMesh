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
   * CORRECT CHAMFERING: Keep original front/back faces, only chamfer the side walls
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

    // FULL-THROUGH CHAMFERING: Front face full size, back face chamfered
    // This creates truncated pyramid for proper part mating

    const frontVertices = originalVertices; // FRONT: Full size (original polygon)
    const offset = normal.clone().multiplyScalar(thickness);

    // Calculate chamfered back vertices (inset by chamfer amount)
    // For FULL-THROUGH chamfering, pass the thickness so vertices move correctly
    const chamferedBackVertices = this.generateChamferedVertices(
      originalVertices.map((v) => v.clone().add(offset)), // Start with full back face
      thickness, // Use thickness for full-through chamfering calculation
      edgeAngles || Array(originalVertices.length).fill(defaultChamferAngle),
    );

    const backVertices = chamferedBackVertices; // BACK: Chamfered (smaller)

    console.log(`🔧 FULL-THROUGH CHAMFERING: Front face FULL SIZE, back face CHAMFERED (smaller)`);
    console.log(`🔧 Creates truncated pyramid - parts can mate together properly`);
    console.log(`🔧 Chamfer goes ALL THE WAY THROUGH the ${thickness}mm thick part`);

    let stlContent = `solid chamfered_polygon_${polygon.index || 0}\n`;

    // Use original triangulation if available
    const polygonAny = polygon as any;
    let frontTriangles: THREE.Vector3[][];

    if (polygonAny.originalTriangulation && polygonAny.originalTriangulation.length > 0) {
      console.log(`   Using original triangulation for chamfered polygon (${polygonAny.originalTriangulation.length} triangles)`);

      // Use original triangulation with ORIGINAL vertices (not chamfered ones)
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

    // Front face - ORIGINAL polygon (full cross-sectional area)
    for (const triangle of frontTriangles) {
      stlContent += this.addTriangleToSTL(
        triangle[0],
        triangle[1],
        triangle[2],
        normal,
      );
    }

    // Back face - ORIGINAL polygon (full cross-sectional area), reversed winding
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

    // CHAMFERED side walls - this is where the chamfering happens
    console.log(`🔧 About to create chamfered side walls...`);
    const sideWallsContent = this.createChamferedSideWalls(
      frontVertices,
      backVertices,
      originalVertices,
      thickness, // Pass actual thickness, not chamferDepth
      edgeAngles || Array(originalVertices.length).fill(defaultChamferAngle),
    );

    console.log(`🔧 Chamfered side walls content length: ${sideWallsContent.length} characters`);
    if (sideWallsContent.length === 0) {
      console.error(`❌ CRITICAL: No side walls content generated! This is why STL has no side faces.`);
    }

    stlContent += sideWallsContent;

    stlContent += `endsolid chamfered_polygon_${polygon.index || 0}\n`;

    console.log(`✅ Total STL content length: ${stlContent.length} characters`);
    return stlContent;
  }

  /**
   * Generate chamfered vertices using parametric edge-direction movement
   * Each vertex moves along its adjacent edge directions by thickness * tan(chamfer_angle)
   * All movements happen parametrically (simultaneously) maintaining quad side faces
   */
  private static generateChamferedVertices(
    originalVertices: THREE.Vector3[],
    chamferDepth: number,
    chamferAngles: number[],
  ): THREE.Vector3[] {
    console.log(`🔧 Generating PARAMETRIC chamfered vertices with edge-direction movements`);
    console.log(`🔧 Mathematical approach: Move vertices along adjacent edge directions`);
    console.log(`🔧 All movements happen parametrically (simultaneously)`);

    const partThickness = chamferDepth; // chamferDepth is actually the part thickness
    const numVertices = originalVertices.length;

    // Calculate parametric movements for each vertex
    const vertexMovements = new Array(numVertices).fill(null).map(() => new THREE.Vector3());

    // For each edge, calculate how it affects its vertices
    for (let edgeIndex = 0; edgeIndex < numVertices; edgeIndex++) {
      const nextVertexIndex = (edgeIndex + 1) % numVertices;

      // Get chamfer angle for this edge
      const edgeChamferAngle = chamferAngles[edgeIndex] || 45;
      const chamferRadians = (edgeChamferAngle * Math.PI) / 180;

      // Calculate chamfer offset: thickness * tan(chamfer_angle)
      const chamferOffset = partThickness * Math.tan(chamferRadians);

      // Get the edge direction (from current vertex to next vertex)
      const currentVertex = originalVertices[edgeIndex];
      const nextVertex = originalVertices[nextVertexIndex];
      const edgeDirection = new THREE.Vector3().subVectors(nextVertex, currentVertex).normalize();

      // For the current vertex: move along the direction TO the next vertex
      const currentVertexMovement = edgeDirection.clone().multiplyScalar(chamferOffset);
      vertexMovements[edgeIndex].add(currentVertexMovement);

      // For the next vertex: move along the direction FROM the current vertex (opposite)
      const nextVertexMovement = edgeDirection.clone().multiplyScalar(-chamferOffset);
      vertexMovements[nextVertexIndex].add(nextVertexMovement);

      if (edgeIndex < 3) {
        console.log(`🔢 PARAMETRIC CHAMFER Edge ${edgeIndex}:`);
        console.log(`   📐 Edge chamfer angle: ${edgeChamferAngle.toFixed(1)}°`);
        console.log(`   📏 Part thickness: ${partThickness.toFixed(3)}mm`);
        console.log(`   🧮 Formula: offset = thickness × tan(angle) = ${partThickness.toFixed(3)} × tan(${edgeChamferAngle.toFixed(1)}°) = ${chamferOffset.toFixed(3)}`);
        console.log(`   ↗️ Edge direction: (${edgeDirection.x.toFixed(3)}, ${edgeDirection.y.toFixed(3)})`);
        console.log(`   🎯 Vertex ${edgeIndex} moves: (${currentVertexMovement.x.toFixed(3)}, ${currentVertexMovement.y.toFixed(3)})`);
        console.log(`   🎯 Vertex ${nextVertexIndex} moves: (${nextVertexMovement.x.toFixed(3)}, ${nextVertexMovement.y.toFixed(3)})`);
      }
    }

    // Apply all parametric movements simultaneously to create chamfered vertices
    const chamferedVertices: THREE.Vector3[] = [];
    for (let i = 0; i < numVertices; i++) {
      const chamferedVertex = originalVertices[i].clone().add(vertexMovements[i]);
      chamferedVertices.push(chamferedVertex);

      if (i < 3) {
        console.log(`📊 FINAL Vertex ${i}:`);
        console.log(`   Original: (${originalVertices[i].x.toFixed(3)}, ${originalVertices[i].y.toFixed(3)})`);
        console.log(`   Total movement: (${vertexMovements[i].x.toFixed(3)}, ${vertexMovements[i].y.toFixed(3)})`);
        console.log(`   Final: (${chamferedVertex.x.toFixed(3)}, ${chamferedVertex.y.toFixed(3)})`);
      }
    }

    console.log(`✅ Generated ${chamferedVertices.length} chamfered vertices using parametric edge-direction movements`);
    console.log(`✅ All movements applied simultaneously - maintains quad side face structure`);
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
        console.warn("🚨 Ear clipping failed - this creates WINDMILLING!");
        console.warn("🚨 AVOIDING fan triangulation that causes windmill pattern");

        // Instead of fan triangulation (which creates windmills),
        // try to connect adjacent vertices sequentially
        if (indices.length > 3) {
          // Connect first 3 vertices as triangle and continue
          triangles.push([
            vertices[indices[0]],
            vertices[indices[1]],
            vertices[indices[2]],
          ]);
          indices.splice(1, 1); // Remove middle vertex
        }
        continue; // Try ear clipping again with reduced polygon
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
   * Create full-through chamfered side walls - connecting full front to chamfered back
   * This creates truncated pyramid geometry for proper part mating
   */
  private static createChamferedSideWalls(
    frontVertices: THREE.Vector3[], // These are FULL SIZE
    backVertices: THREE.Vector3[],  // These are CHAMFERED (smaller)
    originalVertices: THREE.Vector3[],
    chamferDepth: number,
    chamferAngles: number[],
  ): string {
    console.log(`🔧 Creating FULL-THROUGH chamfer walls: FULL front → CHAMFERED back`);

    // Step 1: Create angled chamfer walls connecting chamfered front to full back
    let content = "";
    let triangleCount = 0;

    for (let i = 0; i < frontVertices.length; i++) {
      const next = (i + 1) % frontVertices.length;

      // FULL front edge vertices (original size)
      const ff1 = frontVertices[i];
      const ff2 = frontVertices[next];

      // CHAMFERED back edge vertices (smaller)
      const cb1 = backVertices[i];
      const cb2 = backVertices[next];

      // Validate vertices before creating the full-through chamfer quad
      if (!ff1 || !ff2 || !cb1 || !cb2) {
        console.error(`❌ Invalid vertices for wall ${i}: ff1=${!!ff1}, ff2=${!!ff2}, cb1=${!!cb1}, cb2=${!!cb2}`);
        continue;
      }

      // Create FULL-THROUGH CHAMFER QUAD: unified angled face
      // Order vertices: FULL front edge → CHAMFERED back edge (truncated pyramid)
      const chamferQuad = [ff1, ff2, cb2, cb1]; // Quad vertices in proper order

      // Calculate consistent normal for the entire quad face
      const edge1 = new THREE.Vector3().subVectors(ff2, ff1); // Full front edge
      const edge2 = new THREE.Vector3().subVectors(cb1, ff1); // Diagonal to chamfered back
      const quadNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      // Validate normal
      if (quadNormal.length() < 0.001) {
        console.warn(`⚠️ Degenerate quad normal for wall ${i}, using fallback`);
        quadNormal.set(0, 0, 1); // Fallback normal
      }

      // Split quad into two triangles but with CONSISTENT normal
      // This creates the angled wall that tapers from full front to chamfered back
      const triangle1 = this.addTriangleToSTL(ff1, ff2, cb2, quadNormal);
      const triangle2 = this.addTriangleToSTL(ff1, cb2, cb1, quadNormal);

      content += triangle1;
      content += triangle2;
      triangleCount += 2;

      if (i < 3) {
        console.log(`   FULL-THROUGH Chamfer Wall ${i}: ${chamferAngles[i] || 45}° taper through entire part`);
        console.log(`   FULL front(${ff1.x.toFixed(2)}, ${ff1.y.toFixed(2)}) → CHAMFERED back(${cb1.x.toFixed(2)}, ${cb1.y.toFixed(2)})`);
        console.log(`   Creates truncated pyramid for part mating`);
      }
    }

    console.log(`✅ Generated ${triangleCount} ANGLED CHAMFER wall triangles (${content.length} characters of STL content)`);
    if (content.length === 0) {
      console.error(`❌ NO WALL CONTENT GENERATED! This is why STL is missing side faces.`);
    }

    console.log(`✅ Created ${frontVertices.length} angled chamfer walls connecting chamfered front to full back`);
    return content;
  }

  /**
   * Calculate chamfered back vertices using plane intersection method
   * This ensures vertices that are shared between edges move to the correct intersection points
   */
  private static calculateChamferedVerticesFromPlaneIntersections(
    frontVertices: THREE.Vector3[],
    backVertices: THREE.Vector3[],
    chamferDepth: number,
    chamferAngles: number[]
  ): THREE.Vector3[] {
    const chamferedBackVertices: THREE.Vector3[] = [];
    const numVertices = frontVertices.length;

    console.log(`🔧 Calculating chamfered vertices using plane intersections for ${numVertices} vertices`);

    for (let i = 0; i < numVertices; i++) {
      // Get the two edges that meet at this vertex
      const prevEdgeIndex = (i - 1 + numVertices) % numVertices;
      const currentEdgeIndex = i;

      // Get chamfer angles for the two adjacent edges
      const prevChamferAngle = chamferAngles[prevEdgeIndex] || 45;
      const currentChamferAngle = chamferAngles[currentEdgeIndex] || 45;

      // Calculate the intersection of the two chamfer planes
      const chamferedVertex = this.calculateVertexChamferIntersection(
        i,
        frontVertices,
        backVertices,
        chamferDepth,
        prevChamferAngle,
        currentChamferAngle
      );

      chamferedBackVertices.push(chamferedVertex);

      if (i < 3) {
        console.log(`   Vertex ${i}: original(${backVertices[i].x.toFixed(3)}, ${backVertices[i].y.toFixed(3)}) → chamfered(${chamferedVertex.x.toFixed(3)}, ${chamferedVertex.y.toFixed(3)})`);
      }
    }

    return chamferedBackVertices;
  }

  /**
   * Calculate where a vertex should move based on the intersection of two adjacent chamfer planes
   */
  private static calculateVertexChamferIntersection(
    vertexIndex: number,
    frontVertices: THREE.Vector3[],
    backVertices: THREE.Vector3[],
    chamferDepth: number,
    prevChamferAngle: number,
    currentChamferAngle: number
  ): THREE.Vector3 {
    const numVertices = frontVertices.length;
    const prevIndex = (vertexIndex - 1 + numVertices) % numVertices;
    const nextIndex = (vertexIndex + 1) % numVertices;

    // Get the vertex and its neighbors
    const currentVertex = backVertices[vertexIndex];
    const frontCurrentVertex = frontVertices[vertexIndex];

    // Get edge directions
    const prevEdgeDir = new THREE.Vector3()
      .subVectors(frontCurrentVertex, frontVertices[prevIndex])
      .normalize();
    const nextEdgeDir = new THREE.Vector3()
      .subVectors(frontVertices[nextIndex], frontCurrentVertex)
      .normalize();

    // Calculate face normal (extrusion direction)
    const thickness = new THREE.Vector3().subVectors(currentVertex, frontCurrentVertex);
    const faceNormal = thickness.clone().normalize();

    // Calculate outward normals for each edge
    const prevOutwardNormal = new THREE.Vector3()
      .crossVectors(prevEdgeDir, faceNormal)
      .normalize();
    const nextOutwardNormal = new THREE.Vector3()
      .crossVectors(nextEdgeDir, faceNormal)
      .normalize();

    // CORRECT CHAMFER FORMULA: chamfer angle = 90° - internal edge angle / 2
    // The chamfer angles passed in should already be calculated correctly in the exporter
    // but let's ensure we're using them properly
    const prevChamferRadians = (prevChamferAngle * Math.PI) / 180;
    const currentChamferRadians = (currentChamferAngle * Math.PI) / 180;

    const prevChamferOffset = chamferDepth * Math.tan(prevChamferRadians);
    const currentChamferOffset = chamferDepth * Math.tan(currentChamferRadians);

    if (vertexIndex < 3) {
      console.log(`   Vertex ${vertexIndex}: prevAngle=${prevChamferAngle.toFixed(1)}°, currentAngle=${currentChamferAngle.toFixed(1)}°`);
      console.log(`   Offsets: prev=${prevChamferOffset.toFixed(3)}, current=${currentChamferOffset.toFixed(3)}`);
    }

    // Calculate the two chamfer plane movements
    const prevInwardDirection = prevOutwardNormal.clone().negate();
    const currentInwardDirection = nextOutwardNormal.clone().negate();

    // Create the two chamfer planes
    const plane1Point = currentVertex.clone().add(prevInwardDirection.clone().multiplyScalar(prevChamferOffset));
    const plane2Point = currentVertex.clone().add(currentInwardDirection.clone().multiplyScalar(currentChamferOffset));

    // VERTEX INTERSECTION: Average the two movements to find where chamfer planes meet
    // NOTE: This is VERTEX positioning, not chamfer angle averaging!
    // Each edge keeps its individual chamfer angle, but shared vertices move to intersection point
    const averageMovement = new THREE.Vector3()
      .addVectors(
        prevInwardDirection.clone().multiplyScalar(prevChamferOffset),
        currentInwardDirection.clone().multiplyScalar(currentChamferOffset)
      )
      .multiplyScalar(0.5);

    if (vertexIndex < 3) {
      console.log(`   VERTEX ${vertexIndex}: Using individual angles prev=${prevChamferAngle.toFixed(1)}°, current=${currentChamferAngle.toFixed(1)}°`);
      console.log(`   VERTEX ${vertexIndex}: Averaging MOVEMENTS (not angles) to find intersection point`);
    }

    // Apply the movement to get the final chamfered vertex position
    const chamferedVertex = currentVertex.clone().add(averageMovement);

    // For more complex shapes, we could implement full plane-plane intersection here
    // But averaging works well for most cases and is much simpler

    return chamferedVertex;
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

    console.log(`🔍 EXTRACTING ${polygonFaces.length} polygon faces from merged geometry:`);

    return polygonFaces.map((faceInfo: any, index: number) => {
      console.log(`   Face ${index}: ${faceInfo.type}, ${faceInfo.originalVertices?.length || 0} vertices`);
      if (faceInfo.originalVertices && faceInfo.originalVertices.length > 0) {
        console.log(`     Vertices:`, faceInfo.originalVertices.map((v: any, i: number) =>
          `${i}: (${v.x?.toFixed(2) || 'N/A'}, ${v.y?.toFixed(2) || 'N/A'}, ${v.z?.toFixed(2) || 'N/A'})`));
      }

      return {
        vertices: faceInfo.originalVertices || [],
        normal: faceInfo.normal || new THREE.Vector3(0, 0, 1),
        type: faceInfo.type || "polygon",
        index,
        originalTriangulation: faceInfo.originalTriangulation || [], // Preserve triangulation data
      };
    });
  }
}
