import * as THREE from "three";

/**
 * Simple face with vertices and normal
 */
export interface Face {
  vertices: THREE.Vector3[];
  normal: THREE.Vector3;
  type: string; // "triangle", "quad", "polygon", etc.
}

/**
 * Extruded face result containing original face + back face + side walls
 */
export interface ExtrudedFace {
  frontFace: Face;
  backFace: Face; 
  sideWalls: Face[];
}

/**
 * Clean, simple face extrusion utility
 * Takes faces from 3D model and adds thickness by extruding in reverse direction of normal
 */
export class FaceExtruder {
  /**
   * Take a face from the 3D model and extrude it with specified thickness
   * @param face - The face to extrude (preserves exact vertex order)
   * @param thickness - Thickness to apply in reverse direction of normal
   * @returns ExtrudedFace with front, back, and side walls
   */
  static extrudeFace(face: Face, thickness: number): ExtrudedFace {

    // DEBUG: Log input face details
    console.log(`   📊 Input vertices:`, face.vertices.map((v, idx) =>
      `${idx}: (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`));
    console.log(`   📊 Input normal:`, `(${face.normal.x.toFixed(3)}, ${face.normal.y.toFixed(3)}, ${face.normal.z.toFixed(3)})`);

    // Ensure normal is normalized and pointing outward (right hand rule)
    const normal = face.normal.clone().normalize();
    
    // Calculate extrusion offset (in REVERSE direction of normal for thickness)
    const extrusionOffset = normal.clone().multiplyScalar(-thickness);
    
    // Create front face (original face)
    const frontFace: Face = {
      vertices: face.vertices.map(v => v.clone()),
      normal: normal.clone(),
      type: face.type
    };
    
    // Create back face (extruded vertices with reversed normal and winding)
    const backVertices = face.vertices.map(v => v.clone().add(extrusionOffset));
    const backFace: Face = {
      vertices: backVertices.reverse(), // Reverse winding for correct normal direction
      normal: normal.clone().negate(),  // Reverse normal
      type: face.type
    };
    
    // Create side walls (quads connecting front and back edges)
    const sideWalls: Face[] = [];
    const frontVerts = frontFace.vertices;
    const backVerts = backFace.vertices;
    
    // Reverse back vertices again to get correct edge pairing
    const correctedBackVerts = [...backVerts].reverse();
    
    for (let i = 0; i < frontVerts.length; i++) {
      const nextI = (i + 1) % frontVerts.length;
      
      // Create quad wall connecting front edge to back edge
      const wallVertices = [
        frontVerts[i],           // Front current
        frontVerts[nextI],       // Front next  
        correctedBackVerts[nextI], // Back next
        correctedBackVerts[i]      // Back current
      ];
      
      // Calculate wall normal (outward facing)
      const edge1 = new THREE.Vector3().subVectors(wallVertices[1], wallVertices[0]);
      const edge2 = new THREE.Vector3().subVectors(wallVertices[3], wallVertices[0]);
      const wallNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
      
      sideWalls.push({
        vertices: wallVertices,
        normal: wallNormal,
        type: "quad"
      });
    }
    
    console.log(`✅ Extruded face: 1 front + 1 back + ${sideWalls.length} side walls`);
    
    return {
      frontFace,
      backFace,
      sideWalls
    };
  }
  
  /**
   * Convert extruded face to STL format
   * Triangulates only for STL output while preserving face structure
   */
  static extrudedFaceToSTL(extrudedFace: ExtrudedFace, partName: string): string {
    let stlContent = `solid ${partName}\n`;
    
    // Add front face triangles
    stlContent += this.faceToSTLTriangles(extrudedFace.frontFace);
    
    // Add back face triangles  
    stlContent += this.faceToSTLTriangles(extrudedFace.backFace);
    
    // Add side wall triangles
    for (const wall of extrudedFace.sideWalls) {
      stlContent += this.faceToSTLTriangles(wall);
    }
    
    stlContent += `endsolid ${partName}\n`;
    return stlContent;
  }
  
  /**
   * Convert extruded face to OBJ format  
   * Preserves polygon structure without triangulation
   */
  static extrudedFaceToOBJ(extrudedFace: ExtrudedFace, partName: string): string {
    let objContent = `# OBJ file for ${partName}\n`;
    let vertexIndex = 1; // OBJ uses 1-based indexing
    
    // Write all vertices
    objContent += `\n# Front face vertices\n`;
    extrudedFace.frontFace.vertices.forEach(v => {
      objContent += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
    });
    
    objContent += `\n# Back face vertices\n`;
    extrudedFace.backFace.vertices.forEach(v => {
      objContent += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
    });
    
    objContent += `\n# Side wall vertices\n`;
    for (const wall of extrudedFace.sideWalls) {
      wall.vertices.forEach(v => {
        objContent += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
      });
    }
    
    // Write normals
    objContent += `\n# Normals\n`;
    objContent += `vn ${extrudedFace.frontFace.normal.x.toFixed(6)} ${extrudedFace.frontFace.normal.y.toFixed(6)} ${extrudedFace.frontFace.normal.z.toFixed(6)}\n`;
    objContent += `vn ${extrudedFace.backFace.normal.x.toFixed(6)} ${extrudedFace.backFace.normal.y.toFixed(6)} ${extrudedFace.backFace.normal.z.toFixed(6)}\n`;
    
    // Write faces (preserving polygon structure)
    objContent += `\n# Faces\n`;
    
    // Front face (preserve original polygon structure)
    objContent += `# Front face (${extrudedFace.frontFace.type})\n`;
    objContent += this.faceToOBJPolygon(extrudedFace.frontFace.vertices.length, 1, 1);
    
    // Back face
    objContent += `# Back face (${extrudedFace.backFace.type})\n`;
    const backStartIndex = extrudedFace.frontFace.vertices.length + 1;
    objContent += this.faceToOBJPolygon(extrudedFace.backFace.vertices.length, backStartIndex, 2);
    
    // Side walls (quads)
    objContent += `# Side walls\n`;
    let wallStartIndex = extrudedFace.frontFace.vertices.length + extrudedFace.backFace.vertices.length + 1;
    for (const wall of extrudedFace.sideWalls) {
      objContent += this.faceToOBJPolygon(wall.vertices.length, wallStartIndex, 1);
      wallStartIndex += wall.vertices.length;
    }
    
    return objContent;
  }
  
  /**
   * Convert a face to STL triangles (triangulate only for STL format)
   */
  private static faceToSTLTriangles(face: Face): string {
    let stlContent = "";
    
    if (face.vertices.length === 3) {
      // Already a triangle
      stlContent += this.addSTLTriangle(face.vertices[0], face.vertices[1], face.vertices[2], face.normal);
    } else if (face.vertices.length === 4) {
      // Quad - split into two triangles
      stlContent += this.addSTLTriangle(face.vertices[0], face.vertices[1], face.vertices[2], face.normal);
      stlContent += this.addSTLTriangle(face.vertices[0], face.vertices[2], face.vertices[3], face.normal);
    } else {
      // Polygon - simple fan triangulation (minimal, predictable)
      for (let i = 1; i < face.vertices.length - 1; i++) {
        stlContent += this.addSTLTriangle(face.vertices[0], face.vertices[i], face.vertices[i + 1], face.normal);
      }
    }
    
    return stlContent;
  }
  
  /**
   * Add a single triangle to STL content
   */
  private static addSTLTriangle(v1: THREE.Vector3, v2: THREE.Vector3, v3: THREE.Vector3, normal: THREE.Vector3): string {
    return `  facet normal ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}\n` +
           `    outer loop\n` +
           `      vertex ${v1.x.toFixed(6)} ${v1.y.toFixed(6)} ${v1.z.toFixed(6)}\n` +
           `      vertex ${v2.x.toFixed(6)} ${v2.y.toFixed(6)} ${v2.z.toFixed(6)}\n` +
           `      vertex ${v3.x.toFixed(6)} ${v3.y.toFixed(6)} ${v3.z.toFixed(6)}\n` +
           `    endloop\n` +
           `  endfacet\n`;
  }
  
  /**
   * Create OBJ polygon face string
   */
  private static faceToOBJPolygon(vertexCount: number, startIndex: number, normalIndex: number): string {
    let faceString = "f ";
    for (let i = 0; i < vertexCount; i++) {
      faceString += `${startIndex + i}//${normalIndex}`;
      if (i < vertexCount - 1) faceString += " ";
    }
    faceString += "\n";
    return faceString;
  }
}
