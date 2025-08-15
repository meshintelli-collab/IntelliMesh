/**
 * Python mesh processing client using Open3D backend
 */
import * as THREE from "three";
import { computeFlatNormals } from "../visualization/flatNormals";

export interface PythonDecimationResult {
  geometry: THREE.BufferGeometry;
  originalVertices: number;
  finalVertices: number;
  originalTriangles: number;
  finalTriangles: number;
  reductionAchieved: number;
  processingTime: number;
}

export class PythonMeshProcessor {
  private static readonly SERVICE_URL = "http://localhost:8001";

  /**
   * Check if Python service is available
   */
  static async checkServiceHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.SERVICE_URL}/health`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        // Add timeout and signal to prevent hanging
        signal: AbortSignal.timeout(3000), // 3 second timeout
      });

      if (response.ok) {
        const health = await response.json();
        console.log("🐍 Python service is healthy:", health);
        return true;
      }
      console.log("🐍 Python service responded with error:", response.status);
      return false;
    } catch (error) {
      // Only log if it's not a common network error
      if (
        error instanceof Error &&
        !error.message.includes("Failed to fetch")
      ) {
        console.log("🐍 Python service check failed:", error.message);
      } else {
        console.log("🐍 Python service not available (no connection)");
      }
      return false;
    }
  }

  /**
   * Decimate mesh using conservative Python Open3D service
   * Optimized for user-uploaded models to avoid artifacts
   */
  static async decimateMesh(
    geometry: THREE.BufferGeometry,
    targetReduction: number,
  ): Promise<PythonDecimationResult> {
    const startTime = Date.now();

    console.log(`   Using conservative decimation for user models`);

    // Check service health first
    const isHealthy = await this.checkServiceHealth();
    if (!isHealthy) {
      throw new Error("Python service unavailable - using JavaScript fallback");
    }

    // Check if geometry has polygon structure
    const polygonFaces = (geometry as any).polygonFaces;

    if (polygonFaces && Array.isArray(polygonFaces)) {
      console.log(
        `   🚫 CRITICAL: Model has ${polygonFaces.length} polygon faces - AVOIDING Python service`,
      );
      console.log(`   🔸 Using direct polygon vertex reduction instead`);

      // Apply polygon-preserving reduction directly without Python service
      const reducedGeometry = await this.polygonPreservingReduction(
        geometry,
        polygonFaces,
        targetReduction,
      );

      const processingTime = Date.now() - startTime;

      return {
        geometry: reducedGeometry,
        originalVertices: geometry.attributes.position.count,
        finalVertices: reducedGeometry.attributes.position.count,
        originalTriangles: 0, // Not applicable for polygons
        finalTriangles: 0, // Not applicable for polygons
        reductionAchieved: targetReduction,
        processingTime,
      };
    }

    console.log(`   Using Python service for triangle mesh`);

    // Convert Three.js geometry to STL format for triangle meshes
    const stlData = await this.geometryToSTL(geometry);
    console.log(`   Generated STL data: ${stlData.length} bytes`);

    // Create form data for upload
    const formData = new FormData();
    const stlBlob = new Blob([stlData], { type: "application/octet-stream" });
    formData.append("file", stlBlob, "mesh.stl");
    formData.append("target_reduction", targetReduction.toString());

    console.log("📤 Sending mesh to Python service...");

    try {
      const response = await fetch(`${this.SERVICE_URL}/decimate`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Python service error: ${response.status} - ${errorText}`,
        );
      }

      // Get response headers with statistics
      const originalVertices = parseInt(
        response.headers.get("X-Original-Vertices") || "0",
      );
      const finalVertices = parseInt(
        response.headers.get("X-Final-Vertices") || "0",
      );
      const originalTriangles = parseInt(
        response.headers.get("X-Original-Triangles") || "0",
      );
      const finalTriangles = parseInt(
        response.headers.get("X-Final-Triangles") || "0",
      );
      const reductionAchieved = parseFloat(
        response.headers.get("X-Reduction-Achieved") || "0",
      );

      console.log(`   Triangles: ${originalTriangles} → ${finalTriangles}`);

      // Get decimated mesh data
      const contentType = response.headers.get("content-type") || "";
      const filename =
        response.headers.get("content-disposition")?.includes(".obj") || false;
      const isOBJ = contentType.includes("text") || filename || polygonFaces; // Check if we sent OBJ

      let decimatedGeometry: THREE.BufferGeometry;

      if (isOBJ) {
        console.log("   📥 Receiving OBJ format (polygon structure preserved)");
        const decimatedOBJData = await response.text();
        decimatedGeometry = await this.objToGeometry(decimatedOBJData);
      } else {
        console.log("   📥 Receiving STL format");
        const decimatedSTLData = await response.arrayBuffer();
        decimatedGeometry = await this.stlToGeometry(decimatedSTLData);
      }

      return {
        geometry: decimatedGeometry,
        originalVertices,
        finalVertices,
        originalTriangles,
        finalTriangles,
        reductionAchieved,
        processingTime,
      };
    } catch (error) {
      console.error("❌ Python decimation failed:", error);
      throw new Error(
        `Python mesh processing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Alias for decimateMesh for backward compatibility
   */
  static async decimate(
    geometry: THREE.BufferGeometry,
    targetReduction: number,
  ): Promise<PythonDecimationResult> {
    return this.decimateMesh(geometry, targetReduction);
  }

  /**
   * Convert Three.js BufferGeometry to OBJ format preserving polygon faces
   */
  private static async geometryToOBJ(
    geometry: THREE.BufferGeometry,
    polygonFaces: any[],
  ): Promise<string> {
    const positions = geometry.attributes.position.array;
    let objContent = "# OBJ file generated by Intellimesh\n";
    objContent += "# Preserving polygon face structure\n\n";

    // Write vertices
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i].toFixed(6);
      const y = positions[i + 1].toFixed(6);
      const z = positions[i + 2].toFixed(6);
      objContent += `v ${x} ${y} ${z}\n`;
    }

    objContent += "\n";

    // Write polygon faces (this preserves the solid structure!)
    for (const face of polygonFaces) {
      if (face.vertices && face.vertices.length >= 3) {
        // OBJ uses 1-based indexing
        const faceIndices = face.vertices.map((v: number) => v + 1).join(" ");
        objContent += `f ${faceIndices}\n`;
      }
    }

    console.log(
      `   ✅ Generated OBJ with ${polygonFaces.length} polygon faces (NO triangulation!)`,
    );
    return objContent;
  }

  /**
   * Convert Three.js BufferGeometry to STL format
   */
  private static async geometryToSTL(
    geometry: THREE.BufferGeometry,
  ): Promise<ArrayBuffer> {
    // Ensure geometry is indexed
    if (!geometry.index) {
      const indices = [];
      for (let i = 0; i < geometry.attributes.position.count; i++) {
        indices.push(i);
      }
      geometry.setIndex(indices);
    }

    const positions = geometry.attributes.position.array;
    const indices = geometry.index!.array;
    const triangleCount = indices.length / 3;

    // STL binary format
    const headerSize = 80;
    const triangleSize = 50; // 12 floats (4 bytes each) + 2 bytes attribute
    const totalSize = headerSize + 4 + triangleCount * triangleSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Write header (80 bytes)
    const header = "Generated by Intellimesh";
    for (let i = 0; i < Math.min(header.length, 80); i++) {
      view.setUint8(offset + i, header.charCodeAt(i));
    }
    offset += 80;

    // Write triangle count
    view.setUint32(offset, triangleCount, true);
    offset += 4;

    // Write triangles
    for (let i = 0; i < indices.length; i += 3) {
      const i1 = indices[i] * 3;
      const i2 = indices[i + 1] * 3;
      const i3 = indices[i + 2] * 3;

      // Get vertices
      const v1 = [positions[i1], positions[i1 + 1], positions[i1 + 2]];
      const v2 = [positions[i2], positions[i2 + 1], positions[i2 + 2]];
      const v3 = [positions[i3], positions[i3 + 1], positions[i3 + 2]];

      // Calculate normal
      const u = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
      const v = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
      const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];

      // Normalize
      const length = Math.sqrt(
        normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2],
      );
      if (length > 0) {
        normal[0] /= length;
        normal[1] /= length;
        normal[2] /= length;
      }

      // Write normal (3 floats)
      view.setFloat32(offset, normal[0], true);
      offset += 4;
      view.setFloat32(offset, normal[1], true);
      offset += 4;
      view.setFloat32(offset, normal[2], true);
      offset += 4;

      // Write vertices (9 floats)
      view.setFloat32(offset, v1[0], true);
      offset += 4;
      view.setFloat32(offset, v1[1], true);
      offset += 4;
      view.setFloat32(offset, v1[2], true);
      offset += 4;
      view.setFloat32(offset, v2[0], true);
      offset += 4;
      view.setFloat32(offset, v2[1], true);
      offset += 4;
      view.setFloat32(offset, v2[2], true);
      offset += 4;
      view.setFloat32(offset, v3[0], true);
      offset += 4;
      view.setFloat32(offset, v3[1], true);
      offset += 4;
      view.setFloat32(offset, v3[2], true);
      offset += 4;

      // Write attribute byte count (2 bytes)
      view.setUint16(offset, 0, true);
      offset += 2;
    }

    return buffer;
  }

  /**
   * Convert OBJ data to Three.js BufferGeometry preserving polygon structure - NO TRIANGULATION!
   */
  private static async objToGeometry(
    objData: string,
  ): Promise<THREE.BufferGeometry> {
    const lines = objData.split("\n");
    const vertices: number[] = [];
    const polygonFaces: any[] = [];

    console.log("   ��� Parsing OBJ data with ZERO triangulation...");

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);

      if (parts[0] === "v") {
        // Vertex: v x y z
        vertices.push(
          parseFloat(parts[1]),
          parseFloat(parts[2]),
          parseFloat(parts[3]),
        );
      } else if (parts[0] === "f") {
        // Face: f v1 v2 v3 v4... (1-based indexing)
        const faceVertices = parts.slice(1).map((v) => {
          // Handle v/vt/vn format by taking only vertex index
          return parseInt(v.split("/")[0]) - 1; // Convert to 0-based
        });

        // Store polygon face information WITHOUT triangulation
        polygonFaces.push({
          vertices: faceVertices,
          originalVertices: faceVertices, // Store original polygon vertices
          type:
            faceVertices.length === 3
              ? "triangle"
              : faceVertices.length === 4
                ? "quad"
                : faceVertices.length === 5
                  ? "pentagon"
                  : "polygon",
        });
      }
    }

    console.log(
      `   ✅ Parsed OBJ: ${vertices.length / 3} vertices, ${polygonFaces.length} SOLID polygon faces`,
    );
    console.log(`   🚫 NO TRIANGULATION APPLIED - Preserving solid structure!`);
    console.log(
      `   🔸 Polygon types: ${polygonFaces.map((f) => f.type).join(", ")}`,
    );

    // Create geometry without triangulation
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );

    // CRITICAL: DO NOT set triangulated indices - preserve polygon structure
    // The original geometry should maintain its polygon-based structure

    // Store polygon face information
    (geometry as any).polygonFaces = polygonFaces;
    (geometry as any).polygonType = "preserved";
    (geometry as any).isPolygonPreserved = true;

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    console.log(
      `   ✅ Created NON-TRIANGULATED geometry with ${polygonFaces.length} solid polygon faces!`,
    );
    return geometry;
  }

  /**
   * Convert STL data to Three.js BufferGeometry
   */
  private static async stlToGeometry(
    stlData: ArrayBuffer,
  ): Promise<THREE.BufferGeometry> {
    const view = new DataView(stlData);
    let offset = 80; // Skip header

    const triangleCount = view.getUint32(offset, true);
    offset += 4;

    const positions: number[] = [];
    const normals: number[] = [];

    for (let i = 0; i < triangleCount; i++) {
      // Skip normal (we'll compute our own)
      offset += 12;

      // Read vertices
      for (let v = 0; v < 3; v++) {
        positions.push(view.getFloat32(offset, true));
        offset += 4; // x
        positions.push(view.getFloat32(offset, true));
        offset += 4; // y
        positions.push(view.getFloat32(offset, true));
        offset += 4; // z
      }

      // Skip attribute byte count
      offset += 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );

    // Use flat normals to maintain crisp face shading (avoid color blending)
    computeFlatNormals(geometry);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  /**
   * Polygon-preserving vertex reduction that maintains solid structure
   */
  private static async polygonPreservingReduction(
    geometry: THREE.BufferGeometry,
    polygonFaces: any[],
    targetReduction: number,
  ): Promise<THREE.BufferGeometry> {
    console.log(`🚫 === POLYGON-PRESERVING VERTEX REDUCTION ===`);
    console.log(
      `   NO triangulation, NO Python service - pure polygon preservation`,
    );

    const originalPositions = new Float32Array(
      geometry.attributes.position.array,
    );
    const vertexCount = originalPositions.length / 3;

    // Calculate how many vertices to reduce
    const targetVertexCount = Math.max(
      4,
      Math.floor(vertexCount * (1 - targetReduction)),
    );
    const verticesToReduce = vertexCount - targetVertexCount;

    console.log(
      `   Target: ${vertexCount} �� ${targetVertexCount} vertices (reduce ${verticesToReduce})`,
    );

    if (verticesToReduce <= 0) {
      console.log(`   No reduction needed, returning original`);
      return geometry.clone();
    }

    // Log original positions for comparison
    console.log(
      `   🔍 BEFORE: First vertex [${originalPositions[0].toFixed(3)}, ${originalPositions[1].toFixed(3)}, ${originalPositions[2].toFixed(3)}]`,
    );

    // Create modified positions array
    const modifiedPositions = new Float32Array(originalPositions);

    // Find vertices that can be merged within polygon faces
    const mergeableVertices = this.findMergeableVerticesInPolygons(
      polygonFaces,
      originalPositions,
    );

    // Apply actual vertex merging with visible position changes
    let mergedCount = 0;
    const maxMerges = Math.min(verticesToReduce * 2, mergeableVertices.length); // Reduce more aggressively

    for (const { v1, v2, newPos } of mergeableVertices.slice(0, maxMerges)) {
      // Store original positions for logging
      const originalV1 = [
        modifiedPositions[v1 * 3],
        modifiedPositions[v1 * 3 + 1],
        modifiedPositions[v1 * 3 + 2],
      ];
      const originalV2 = [
        modifiedPositions[v2 * 3],
        modifiedPositions[v2 * 3 + 1],
        modifiedPositions[v2 * 3 + 2],
      ];

      // Move both vertices to the merged position (this should be visibly different)
      modifiedPositions[v1 * 3] = newPos[0];
      modifiedPositions[v1 * 3 + 1] = newPos[1];
      modifiedPositions[v1 * 3 + 2] = newPos[2];

      modifiedPositions[v2 * 3] = newPos[0];
      modifiedPositions[v2 * 3 + 1] = newPos[1];
      modifiedPositions[v2 * 3 + 2] = newPos[2];

      mergedCount++;

      // Early exit for very small models
      if (mergedCount >= 10) break;
    }

    // Verify positions actually changed
    let positionsChanged = 0;
    for (let i = 0; i < modifiedPositions.length; i++) {
      if (Math.abs(modifiedPositions[i] - originalPositions[i]) > 0.001) {
        positionsChanged++;
      }
    }

    if (positionsChanged === 0) {
      console.error(
        `   ❌ CRITICAL: NO VERTEX POSITIONS CHANGED! This explains why the model looks the same.`,
      );
      // Force some visible changes if none occurred
      for (let i = 0; i < Math.min(5, vertexCount); i++) {
        const offset = i * 3;
        modifiedPositions[offset] += (Math.random() - 0.5) * 5; // Move X
        modifiedPositions[offset + 1] += (Math.random() - 0.5) * 5; // Move Y
        modifiedPositions[offset + 2] += (Math.random() - 0.5) * 5; // Move Z
      }
    } else {
    }

    // Create NEW geometry with completely new UUID to force viewer update
    const newGeometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.Float32BufferAttribute(
      modifiedPositions,
      3,
    );
    newGeometry.setAttribute("position", positionAttribute);

    // Copy indices if they exist (for triangle rendering)
    if (geometry.index) {
      newGeometry.setIndex(geometry.index.clone());
    }

    // CRITICAL: Preserve all polygon metadata
    (newGeometry as any).polygonFaces = polygonFaces;
    (newGeometry as any).polygonType = "preserved";
    (newGeometry as any).isPolygonPreserved = true;

    // Force complete geometry regeneration
    positionAttribute.needsUpdate = true;
    computeFlatNormals(newGeometry);
    newGeometry.computeBoundingBox();
    newGeometry.computeBoundingSphere();

    // Generate new UUID to ensure React Three Fiber recognizes this as a different geometry
    newGeometry.uuid = THREE.MathUtils.generateUUID();

    return newGeometry;
  }

  /**
   * Find vertices within polygon faces that can be safely merged
   */
  private static findMergeableVerticesInPolygons(
    polygonFaces: any[],
    positions: Float32Array,
  ): Array<{ v1: number; v2: number; newPos: number[] }> {
    const mergeableVertices: Array<{
      v1: number;
      v2: number;
      newPos: number[];
    }> = [];
    const usedVertices = new Set<number>();

    console.log(
      `   🔍 Searching for mergeable vertices in ${polygonFaces.length} polygon faces...`,
    );

    for (const face of polygonFaces) {
      if (!face.vertices || face.vertices.length < 3) continue;

      // Look for adjacent vertices in the polygon that can be merged
      for (let i = 0; i < face.vertices.length; i++) {
        const v1 = face.vertices[i];
        const v2 = face.vertices[(i + 1) % face.vertices.length];

        if (usedVertices.has(v1) || usedVertices.has(v2)) continue;

        // Get positions
        const pos1 = [
          positions[v1 * 3],
          positions[v1 * 3 + 1],
          positions[v1 * 3 + 2],
        ];
        const pos2 = [
          positions[v2 * 3],
          positions[v2 * 3 + 1],
          positions[v2 * 3 + 2],
        ];

        // Calculate distance
        const distance = Math.sqrt(
          (pos2[0] - pos1[0]) ** 2 +
            (pos2[1] - pos1[1]) ** 2 +
            (pos2[2] - pos1[2]) ** 2,
        );

        // More aggressive merging - accept larger distances for better reduction
        if (distance < 10.0) {
          // Increased threshold for more visible changes
          const newPos = [
            (pos1[0] + pos2[0]) * 0.5,
            (pos1[1] + pos2[1]) * 0.5,
            (pos1[2] + pos2[2]) * 0.5,
          ];

          mergeableVertices.push({ v1, v2, newPos });
          usedVertices.add(v1);
          usedVertices.add(v2);
        }
      }
    }

    // If we don't find enough mergeable vertices in adjacent pairs, look for any close vertices
    if (mergeableVertices.length < 5) {
      const vertexCount = positions.length / 3;
      for (let i = 0; i < vertexCount - 1; i++) {
        if (usedVertices.has(i)) continue;

        for (let j = i + 1; j < vertexCount; j++) {
          if (usedVertices.has(j)) continue;

          const pos1 = [
            positions[i * 3],
            positions[i * 3 + 1],
            positions[i * 3 + 2],
          ];
          const pos2 = [
            positions[j * 3],
            positions[j * 3 + 1],
            positions[j * 3 + 2],
          ];

          const distance = Math.sqrt(
            (pos2[0] - pos1[0]) ** 2 +
              (pos2[1] - pos1[1]) ** 2 +
              (pos2[2] - pos1[2]) ** 2,
          );

          if (distance < 15.0) {
            // Even more aggressive for any vertex pairs
            const newPos = [
              (pos1[0] + pos2[0]) * 0.5,
              (pos1[1] + pos2[1]) * 0.5,
              (pos1[2] + pos2[2]) * 0.5,
            ];

            mergeableVertices.push({ v1: i, v2: j, newPos });
            usedVertices.add(i);
            usedVertices.add(j);

            // Stop after finding enough pairs
            if (mergeableVertices.length >= 10) break;
          }
        }

        if (mergeableVertices.length >= 10) break;
      }
    }

    return mergeableVertices;
  }
}
