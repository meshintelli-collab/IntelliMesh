import * as THREE from "three";
import { MeshStats } from "./meshSimplifier";
import { VertexRemovalStitcher } from "./vertexRemovalStitcher";
import { computeFlatNormals } from "../visualization/flatNormals";

/**
 * STL Manipulation utilities for cleaning, simplifying, and highlighting STL geometries
 * Now uses OBJ format internally for better manipulation capabilities
 */
export class STLManipulator {
  /**
   * Simple mesh decimation using JavaScript implementation
   */
  static async reducePoints(
    geometry: THREE.BufferGeometry,
    targetReduction: number = 0.5,
    method:
      | "quadric_edge_collapse"
      | "vertex_clustering" = "quadric_edge_collapse",
  ): Promise<{
    geometry: THREE.BufferGeometry;
    originalStats: MeshStats;
    newStats: MeshStats;
    reductionAchieved: number;
    processingTime: number;
  }> {
    const originalStats = this.calculateMeshStats(geometry);

    // Try to use Open3D Python service first (preferred), fall back to JavaScript if not available
    try {
      const { PythonMeshProcessor } = await import("./pythonMeshProcessor");

      // Check if Python service is available
      const isAvailable = await PythonMeshProcessor.checkServiceHealth();

      if (isAvailable) {
        console.log("🐍 Using Python Open3D service for decimation");
        const pythonResult = await PythonMeshProcessor.decimateMesh(
          geometry,
          targetReduction,
        );

        const newStats = this.calculateMeshStats(pythonResult.geometry);
        const reductionAchieved =
          1 - newStats.vertices / originalStats.vertices;

        console.log("🐍 ✅ Python Open3D decimation completed successfully");
        return {
          geometry: pythonResult.geometry,
          originalStats,
          newStats,
          reductionAchieved,
          processingTime: pythonResult.processingTime,
        };
      } else {
        console.log("🐍 ❌ Python service not available, using JavaScript fallback");
      }
    } catch (error) {
      console.log("🐍 ❌ Python service error, using JavaScript fallback:", error);
    }

    // Choose implementation based on method
    if (method === "vertex_clustering") {
      return this.performVertexClustering(geometry, targetReduction);
    }

    // Fallback to JavaScript implementation
    const result = await VertexRemovalStitcher.removeVertices(
      geometry,
      targetReduction,
      "quadric_edge_collapse",
    );

    // Simple summary log
    const reductionPercent = (result.reductionAchieved * 100).toFixed(1);
    console.log(
      `✅ Decimation complete: ${result.originalStats.vertices} → ${result.newStats.vertices} vertices (${reductionPercent}% reduction)`,
    );

    // Validate the result geometry before returning
    const finalGeometry = result.simplifiedGeometry;

    if (!finalGeometry.attributes.position) {
      console.error("❌ Decimation produced geometry without positions");
      throw new Error("Invalid decimated geometry - missing positions");
    }

    if (finalGeometry.index && finalGeometry.index.count === 0) {
      console.error("❌ Decimation produced geometry with no triangles");
      throw new Error("Invalid decimated geometry - no triangles remain");
    }

    // Geometry validation passed

    return {
      geometry: finalGeometry,
      originalStats: result.originalStats,
      newStats: result.newStats,
      reductionAchieved: result.reductionAchieved,
      processingTime: result.processingTime,
    };
  }

  /**
   * Decimate a single edge by merging two vertices
   */
  static async decimateSingleEdge(
    geometry: THREE.BufferGeometry,
    vertexIndex1: number,
    vertexIndex2: number,
  ): Promise<ToolOperationResult> {
    if (!geometry) {
      return { success: false, message: "No geometry loaded" };
    }

    try {
      const positions = geometry.attributes.position.array as Float32Array;
      const vertexCount = geometry.attributes.position.count;

      if (vertexIndex1 >= vertexCount || vertexIndex2 >= vertexCount) {
        return { success: false, message: "Invalid vertex indices" };
      }

      // Get vertex positions
      const v1 = new THREE.Vector3(
        positions[vertexIndex1 * 3],
        positions[vertexIndex1 * 3 + 1],
        positions[vertexIndex1 * 3 + 2],
      );

      const v2 = new THREE.Vector3(
        positions[vertexIndex2 * 3],
        positions[vertexIndex2 * 3 + 1],
        positions[vertexIndex2 * 3 + 2],
      );

      // Analyze faces connected to this edge to determine optimal collapse position
      const collapsePosition = this.calculateOptimalCollapsePosition(
        geometry,
        v1,
        v2,
        vertexIndex1,
        vertexIndex2,
      );

      // Perform edge collapse
      const result = await VertexRemovalStitcher.collapseSingleEdge(
        geometry,
        vertexIndex1,
        vertexIndex2,
        collapsePosition,
      );

      if (result.success) {
        return {
          success: true,
          message: `Edge collapsed: ${vertexIndex1}↔${vertexIndex2}`,
          geometry: result.geometry,
          originalStats: { vertices: vertexCount, faces: 0 },
          newStats: {
            vertices: result.geometry?.attributes.position.count || 0,
            faces: 0,
          },
        };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        message: `Edge decimation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Calculate mesh statistics
   */
  private static calculateMeshStats(geometry: THREE.BufferGeometry): MeshStats {
    const vertices = geometry.attributes.position
      ? geometry.attributes.position.count
      : 0;
    const faces = geometry.index
      ? geometry.index.count / 3
      : Math.floor(vertices / 3);

    return {
      vertices,
      faces,
      edges: vertices + faces - 2, // Euler's formula approximation
      volume: 0,
      hasNormals: !!geometry.attributes.normal,
      hasUVs: !!geometry.attributes.uv,
      isIndexed: !!geometry.index,
    };
  }

  /**
   * Get triangle index from intersection point
   */
  static getTriangleIndexFromIntersection(
    geometry: THREE.BufferGeometry,
    intersection: THREE.Intersection,
  ): number | null {
    if (!intersection.face || intersection.face.a === undefined) {
      return null;
    }

    // For non-indexed geometry, calculate triangle index from face indices
    if (!geometry.index) {
      return Math.floor(intersection.face.a / 3);
    }

    // For indexed geometry, we need to find which triangle contains these vertices
    const indices = geometry.index.array;
    const faceA = intersection.face.a;
    const faceB = intersection.face.b;
    const faceC = intersection.face.c;

    // Find the triangle index that contains these face indices
    for (let i = 0; i < indices.length; i += 3) {
      if (
        (indices[i] === faceA &&
          indices[i + 1] === faceB &&
          indices[i + 2] === faceC) ||
        (indices[i] === faceA &&
          indices[i + 1] === faceC &&
          indices[i + 2] === faceB) ||
        (indices[i] === faceB &&
          indices[i + 1] === faceA &&
          indices[i + 2] === faceC) ||
        (indices[i] === faceB &&
          indices[i + 1] === faceC &&
          indices[i + 2] === faceA) ||
        (indices[i] === faceC &&
          indices[i + 1] === faceA &&
          indices[i + 2] === faceB) ||
        (indices[i] === faceC &&
          indices[i + 1] === faceB &&
          indices[i + 2] === faceA)
      ) {
        return Math.floor(i / 3);
      }
    }

    return null;
  }

  /**
   * Get polygon face from intersection point
   */
  static getPolygonFaceFromIntersection(
    geometry: THREE.BufferGeometry,
    intersection: THREE.Intersection,
  ): number | null {
    if (!intersection.face || intersection.face.a === undefined) {
      return null;
    }

    const polygonFaces = (geometry as any).polygonFaces;
    if (!polygonFaces || !Array.isArray(polygonFaces)) {
      // Fallback to triangle index for non-polygon geometries
      return this.getTriangleIndexFromIntersection(geometry, intersection);
    }

    // Simplified approach: Get triangle index directly from intersection
    const triangleIndex =
      intersection.faceIndex || Math.floor(intersection.face.a / 3);

    // Use triangleIndices if available (for merged faces)
    for (let faceIndex = 0; faceIndex < polygonFaces.length; faceIndex++) {
      const face = polygonFaces[faceIndex];

      if (
        face.triangleIndices &&
        face.triangleIndices.includes(triangleIndex)
      ) {
        return faceIndex;
      }
    }

    // Fallback to sequential calculation for non-merged faces
    let currentTriangleCount = 0;
    for (let faceIndex = 0; faceIndex < polygonFaces.length; faceIndex++) {
      const face = polygonFaces[faceIndex];
      const faceTriangleCount = this.getTriangleCountForPolygon(face);

      if (
        triangleIndex >= currentTriangleCount &&
        triangleIndex < currentTriangleCount + faceTriangleCount
      ) {
        return faceIndex;
      }

      currentTriangleCount += faceTriangleCount;
    }

    return null;
  }

  /**
   * Get number of triangles that make up a polygon face
   */
  static getTriangleCountForPolygon(face: any): number {
    if (!face.originalVertices) {
      if (face.type === "triangle") return 1;
      if (face.type === "quad") return 2;
      return 3; // estimate for polygon
    }

    const vertexCount = face.originalVertices.length;
    if (vertexCount === 3) return 1;
    if (vertexCount === 4) return 2;
    return vertexCount - 2; // fan triangulation
  }

  /**
   * Find triangle index from face for indexed geometry
   */
  private static findTriangleIndexFromFace(
    geometry: THREE.BufferGeometry,
    face: THREE.Face,
  ): number | null {
    if (!geometry.index) return null;

    const indices = geometry.index.array;
    const faceA = face.a;
    const faceB = face.b;
    const faceC = face.c;

    for (let i = 0; i < indices.length; i += 3) {
      if (
        (indices[i] === faceA &&
          indices[i + 1] === faceB &&
          indices[i + 2] === faceC) ||
        (indices[i] === faceA &&
          indices[i + 1] === faceC &&
          indices[i + 2] === faceB) ||
        (indices[i] === faceB &&
          indices[i + 1] === faceA &&
          indices[i + 2] === faceC) ||
        (indices[i] === faceB &&
          indices[i + 1] === faceC &&
          indices[i + 2] === faceA) ||
        (indices[i] === faceC &&
          indices[i + 1] === faceA &&
          indices[i + 2] === faceB) ||
        (indices[i] === faceC &&
          indices[i + 1] === faceB &&
          indices[i + 2] === faceA)
      ) {
        return Math.floor(i / 3);
      }
    }

    return null;
  }

  /**
   * Get detailed statistics for a specific polygon face
   */
  static getPolygonFaceStats(
    geometry: THREE.BufferGeometry,
    faceIndex: number,
  ): {
    area: number;
    perimeter: number;
    width: number;
    height: number;
    centroid: THREE.Vector3;
    vertices: THREE.Vector3[];
    faceType: string;
    vertexCount: number;
  } | null {
    const polygonFaces = (geometry as any).polygonFaces;

    if (
      !polygonFaces ||
      !Array.isArray(polygonFaces) ||
      faceIndex < 0 ||
      faceIndex >= polygonFaces.length
    ) {
      // Fallback to triangle stats for non-polygon geometries
      const triangleStats = this.getTriangleStats(geometry, faceIndex);
      if (!triangleStats) return null;

      return {
        ...triangleStats,
        faceType: "triangle",
        vertexCount: 3,
      };
    }

    const face = polygonFaces[faceIndex];
    const vertices = face.originalVertices || [];

    if (vertices.length < 3) return null;

    // Calculate polygon properties
    let area = 0;
    let perimeter = 0;

    // Calculate 3D polygon area using cross products (for planar polygons)
    if (vertices.length === 3) {
      // Triangle area
      const edge1 = new THREE.Vector3().subVectors(vertices[1], vertices[0]);
      const edge2 = new THREE.Vector3().subVectors(vertices[2], vertices[0]);
      area = edge1.cross(edge2).length() / 2;
    } else {
      // For polygons, use fan triangulation from centroid
      const centroid = new THREE.Vector3();
      vertices.forEach((v: THREE.Vector3) => centroid.add(v));
      centroid.divideScalar(vertices.length);

      for (let i = 0; i < vertices.length; i++) {
        const next = (i + 1) % vertices.length;
        const edge1 = new THREE.Vector3().subVectors(vertices[i], centroid);
        const edge2 = new THREE.Vector3().subVectors(vertices[next], centroid);
        area += edge1.cross(edge2).length() / 2;
      }
    }

    // Calculate perimeter
    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      const edge = new THREE.Vector3().subVectors(vertices[next], vertices[i]);
      perimeter += edge.length();
    }

    // Calculate centroid (if not already calculated above)
    let centroid: THREE.Vector3;
    if (vertices.length === 3) {
      centroid = new THREE.Vector3();
      vertices.forEach((v: THREE.Vector3) => centroid.add(v));
      centroid.divideScalar(vertices.length);
    } else {
      // Already calculated above for area calculation
      centroid = new THREE.Vector3();
      vertices.forEach((v: THREE.Vector3) => centroid.add(v));
      centroid.divideScalar(vertices.length);
    }

    // Calculate bounding box dimensions
    const minX = Math.min(...vertices.map((v: THREE.Vector3) => v.x));
    const maxX = Math.max(...vertices.map((v: THREE.Vector3) => v.x));
    const minY = Math.min(...vertices.map((v: THREE.Vector3) => v.y));
    const maxY = Math.max(...vertices.map((v: THREE.Vector3) => v.y));

    const width = maxX - minX;
    const height = maxY - minY;

    return {
      area,
      perimeter,
      width,
      height,
      centroid,
      vertices,
      faceType: face.type || "polygon",
      vertexCount: vertices.length,
    };
  }

  /**
   * Get detailed statistics for a specific triangle
   */
  static getTriangleStats(
    geometry: THREE.BufferGeometry,
    triangleIndex: number,
  ): {
    area: number;
    perimeter: number;
    width: number;
    height: number;
    centroid: THREE.Vector3;
    vertices: THREE.Vector3[];
  } | null {
    if (!geometry || triangleIndex < 0) return null;

    const positions = geometry.attributes.position;

    // Check bounds based on geometry type
    if (geometry.index) {
      // Indexed geometry: check triangle index against face count
      const faceCount = geometry.index.count / 3;
      if (triangleIndex >= faceCount) return null;
    } else {
      // Non-indexed geometry: check triangle index against vertex count
      const faceCount = positions.count / 3;
      if (triangleIndex >= faceCount) return null;
    }

    // Get triangle vertices - handle both indexed and non-indexed geometry
    let v1, v2, v3;

    if (geometry.index) {
      // Indexed geometry: use triangle index to get face indices
      const indices = geometry.index.array;
      const faceStart = triangleIndex * 3;

      if (faceStart + 2 >= indices.length) return null;

      const i1 = indices[faceStart];
      const i2 = indices[faceStart + 1];
      const i3_indexed = indices[faceStart + 2];

      v1 = new THREE.Vector3(
        positions.getX(i1),
        positions.getY(i1),
        positions.getZ(i1),
      );
      v2 = new THREE.Vector3(
        positions.getX(i2),
        positions.getY(i2),
        positions.getZ(i2),
      );
      v3 = new THREE.Vector3(
        positions.getX(i3_indexed),
        positions.getY(i3_indexed),
        positions.getZ(i3_indexed),
      );
    } else {
      // Non-indexed geometry: vertices are stored sequentially
      const vertexStart = triangleIndex * 3;

      if (vertexStart + 2 >= positions.count) return null;

      v1 = new THREE.Vector3(
        positions.getX(vertexStart),
        positions.getY(vertexStart),
        positions.getZ(vertexStart),
      );
      v2 = new THREE.Vector3(
        positions.getX(vertexStart + 1),
        positions.getY(vertexStart + 1),
        positions.getZ(vertexStart + 1),
      );
      v3 = new THREE.Vector3(
        positions.getX(vertexStart + 2),
        positions.getY(vertexStart + 2),
        positions.getZ(vertexStart + 2),
      );
    }

    // Calculate edges
    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v3, v1);
    const edge3 = new THREE.Vector3().subVectors(v3, v2);

    // Calculate area using cross product
    const area = edge1.clone().cross(edge2).length() / 2;

    // Calculate perimeter
    const perimeter = edge1.length() + edge2.length() + edge3.length();

    // Calculate centroid
    const centroid = new THREE.Vector3()
      .addVectors(v1, v2)
      .add(v3)
      .divideScalar(3);

    // Calculate bounding box dimensions
    const minX = Math.min(v1.x, v2.x, v3.x);
    const maxX = Math.max(v1.x, v2.x, v3.x);
    const minY = Math.min(v1.y, v2.y, v3.y);
    const maxY = Math.max(v1.y, v2.y, v3.y);

    const width = maxX - minX;
    const height = maxY - minY;

    return {
      area,
      perimeter,
      width,
      height,
      centroid,
      vertices: [v1, v2, v3],
    };
  }

  /**
   * Get detailed geometry analysis including polygon types
   */
  static getDetailedGeometryStats(geometry: THREE.BufferGeometry): {
    vertices: number;
    edges: number;
    polygonBreakdown: { type: string; count: number }[];
    hasPolygonData: boolean;
    geometryType: string;
  } {
    if (!geometry)
      return {
        vertices: 0,
        edges: 0,
        polygonBreakdown: [],
        hasPolygonData: false,
        geometryType: "unknown",
      };

    const vertices = geometry.attributes.position.count;

    // Check if geometry has polygon face data
    const polygonFaces = (geometry as any).polygonFaces;
    const polygonType = (geometry as any).polygonType;

    if (polygonFaces && Array.isArray(polygonFaces)) {
      // Analyze polygon face data to get actual geometric properties
      const faceTypeCounts: Record<string, number> = {};
      const uniqueVertices = new Set<string>();
      const edges = new Set<string>();
      const tolerance = 0.001; // Tolerance for vertex uniqueness

      polygonFaces.forEach((face: any) => {
        const faceType = face.type;
        faceTypeCounts[faceType] = (faceTypeCounts[faceType] || 0) + 1;

        if (face.originalVertices && Array.isArray(face.originalVertices)) {
          const faceVertices = face.originalVertices;

          // Add unique vertices (using string representation for uniqueness)
          faceVertices.forEach((vertex: any) => {
            const vertexKey = `${vertex.x.toFixed(3)},${vertex.y.toFixed(3)},${vertex.z.toFixed(3)}`;
            uniqueVertices.add(vertexKey);
          });

          // Add edges (each edge connects two consecutive vertices in the face)
          for (let i = 0; i < faceVertices.length; i++) {
            const v1 = faceVertices[i];
            const v2 = faceVertices[(i + 1) % faceVertices.length];

            // Create edge key (sorted to avoid duplicates like AB and BA)
            const v1Key = `${v1.x.toFixed(3)},${v1.y.toFixed(3)},${v1.z.toFixed(3)}`;
            const v2Key = `${v2.x.toFixed(3)},${v2.y.toFixed(3)},${v2.z.toFixed(3)}`;
            const edgeKey =
              v1Key < v2Key ? `${v1Key}|${v2Key}` : `${v2Key}|${v1Key}`;
            edges.add(edgeKey);
          }
        }
      });

      // Convert to sorted breakdown with proper naming
      const polygonBreakdown = Object.entries(faceTypeCounts)
        .map(([type, count]) => ({
          type:
            type === "triangle"
              ? "triangle"
              : type === "quad"
                ? "quad"
                : type === "polygon"
                  ? "polygon"
                  : type,
          count,
        }))
        .sort((a, b) => {
          // Sort by polygon complexity (triangles first, then quads, etc.)
          const order = { triangle: 1, quad: 2, polygon: 3 };
          return (
            (order[a.type as keyof typeof order] || 4) -
            (order[b.type as keyof typeof order] || 4)
          );
        });

      return {
        vertices: uniqueVertices.size,
        edges: edges.size,
        polygonBreakdown,
        hasPolygonData: true,
        geometryType: polygonType || "polygon-based",
      };
    } else {
      // Fallback to triangle analysis
      const triangleCount = Math.floor(vertices / 3);
      const edgeCount = triangleCount * 3; // Approximate edge count for triangulated mesh

      return {
        vertices,
        edges: Math.floor(edgeCount / 2),
        polygonBreakdown: [{ type: "triangle", count: triangleCount }],
        hasPolygonData: false,
        geometryType: "triangulated",
      };
    }
  }

  /**
   * Get geometry statistics for display (legacy method for compatibility)
   */
  static getGeometryStats(geometry: THREE.BufferGeometry): {
    vertices: number;
    triangles: number;
    hasIndices: boolean;
    boundingBox: THREE.Box3 | null;
  } {
    const vertices = geometry.attributes.position
      ? geometry.attributes.position.count
      : 0;
    const triangles = geometry.index
      ? geometry.index.count / 3
      : Math.floor(vertices / 3);

    geometry.computeBoundingBox();

    return {
      vertices,
      triangles,
      hasIndices: !!geometry.index,
      boundingBox: geometry.boundingBox,
    };
  }

  /**
   * Edge decimation - collapse an edge by merging two vertices
   */
  static async decimateEdge(
    geometry: THREE.BufferGeometry,
    vertexIndex1: number,
    vertexIndex2: number,
  ): Promise<ToolOperationResult> {
    try {
      const startTime = performance.now();

      if (!geometry.attributes.position) {
        return {
          success: false,
          message: "Invalid geometry: no position attribute",
        };
      }

      const positions = geometry.attributes.position;
      const vertexCount = positions.count;

      // Validate vertex indices
      if (
        vertexIndex1 < 0 ||
        vertexIndex1 >= vertexCount ||
        vertexIndex2 < 0 ||
        vertexIndex2 >= vertexCount ||
        vertexIndex1 === vertexIndex2
      ) {
        return {
          success: false,
          message: `Invalid vertex indices: ${vertexIndex1}, ${vertexIndex2}`,
        };
      }

      // Get vertex positions
      const v1 = new THREE.Vector3(
        positions.getX(vertexIndex1),
        positions.getY(vertexIndex1),
        positions.getZ(vertexIndex1),
      );
      const v2 = new THREE.Vector3(
        positions.getX(vertexIndex2),
        positions.getY(vertexIndex2),
        positions.getZ(vertexIndex2),
      );

      // Calculate optimal collapse position (midpoint for simplicity)
      const newPosition = this.calculateOptimalCollapsePosition(
        geometry,
        v1,
        v2,
        vertexIndex1,
        vertexIndex2,
      );

      // Create new geometry with edge collapsed
      const newGeometry = this.collapseEdge(
        geometry,
        vertexIndex1,
        vertexIndex2,
        newPosition,
      );

      if (!newGeometry) {
        return {
          success: false,
          message: "Failed to collapse edge - no valid triangles found",
        };
      }

      const processingTime = performance.now() - startTime;

      return {
        success: true,
        message: `Edge decimated successfully in ${processingTime.toFixed(1)}ms`,
        geometry: newGeometry,
        processingTime,
      };
    } catch (error) {
      return {
        success: false,
        message: `Edge decimation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Collapse an edge by merging two vertices into one
   */
  private static collapseEdge(
    geometry: THREE.BufferGeometry,
    vertexIndex1: number,
    vertexIndex2: number,
    newPosition: THREE.Vector3,
  ): THREE.BufferGeometry | null {
    if (geometry.index) {
      // Handle indexed geometry
      return this.collapseEdgeIndexed(
        geometry,
        vertexIndex1,
        vertexIndex2,
        newPosition,
      );
    } else {
      // Handle non-indexed geometry
      return this.collapseEdgeNonIndexed(
        geometry,
        vertexIndex1,
        vertexIndex2,
        newPosition,
      );
    }
  }

  /**
   * Collapse edge for indexed geometry
   */
  private static collapseEdgeIndexed(
    geometry: THREE.BufferGeometry,
    vertexIndex1: number,
    vertexIndex2: number,
    newPosition: THREE.Vector3,
  ): THREE.BufferGeometry | null {
    const originalIndices = Array.from(geometry.index!.array);
    const originalPositions = geometry.attributes.position
      .array as Float32Array;
    const originalNormals = geometry.attributes.normal;

    // Collapsing edge by merging vertices

    // Step 1: Find triangles that will become degenerate (contain both vertices)
    const trianglesToRemove = new Set<number>();
    for (let i = 0; i < originalIndices.length; i += 3) {
      const triIndices = [
        originalIndices[i],
        originalIndices[i + 1],
        originalIndices[i + 2],
      ];
      if (
        triIndices.includes(vertexIndex1) &&
        triIndices.includes(vertexIndex2)
      ) {
        trianglesToRemove.add(Math.floor(i / 3)); // Triangle index
        // Remove degenerate triangle
      }
    }

    // Step 2: Build new indices array, merging vertices and removing degenerate triangles
    const newIndices: number[] = [];
    let removedTriangles = 0;

    for (let i = 0; i < originalIndices.length; i += 3) {
      const triangleIndex = Math.floor(i / 3);

      if (trianglesToRemove.has(triangleIndex)) {
        removedTriangles++;
        continue; // Skip degenerate triangles
      }

      // Remap vertices: vertexIndex2 → vertexIndex1
      const a =
        originalIndices[i] === vertexIndex2 ? vertexIndex1 : originalIndices[i];
      const b =
        originalIndices[i + 1] === vertexIndex2
          ? vertexIndex1
          : originalIndices[i + 1];
      const c =
        originalIndices[i + 2] === vertexIndex2
          ? vertexIndex1
          : originalIndices[i + 2];

      // Double-check for any remaining degeneracies
      if (a !== b && b !== c && a !== c) {
        newIndices.push(a, b, c);
      } else {
        removedTriangles++;
        // Remove additional degenerate triangle
      }
    }

    if (newIndices.length === 0) {
      console.error("❌ Edge collapse failed: all triangles became degenerate");
      return null;
    }

    // Edge collapse completed successfully

    // Step 3: Update vertex position
    const newPositions = originalPositions.slice(); // Copy positions
    newPositions[vertexIndex1 * 3] = newPosition.x;
    newPositions[vertexIndex1 * 3 + 1] = newPosition.y;
    newPositions[vertexIndex1 * 3 + 2] = newPosition.z;

    // Step 4: Create new geometry
    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(newPositions, 3),
    );

    if (originalNormals) {
      newGeometry.setAttribute("normal", originalNormals.clone());
    }

    newGeometry.setIndex(newIndices);

    // Use flat normals to maintain crisp face shading
    computeFlatNormals(newGeometry);

    return newGeometry;
  }

  /**
   * Collapse edge for non-indexed geometry
   */
  private static collapseEdgeNonIndexed(
    geometry: THREE.BufferGeometry,
    vertexIndex1: number,
    vertexIndex2: number,
    newPosition: THREE.Vector3,
  ): THREE.BufferGeometry | null {
    // Non-indexed edge collapse

    const positions = geometry.attributes.position;
    const normals = geometry.attributes.normal;

    // For non-indexed geometry, we need to find all triangles that use these vertices
    const newPositions: number[] = [];
    const newNormals: number[] = [];

    // Process triangles
    for (let i = 0; i < positions.count; i += 3) {
      const triVertices = [i, i + 1, i + 2];
      let hasVertex1 = false;
      let hasVertex2 = false;

      // Check if this triangle contains either vertex
      for (let j = 0; j < 3; j++) {
        if (triVertices[j] === vertexIndex1) hasVertex1 = true;
        if (triVertices[j] === vertexIndex2) hasVertex2 = true;
      }

      // Skip degenerate triangles (those that would have both vertices)
      if (hasVertex1 && hasVertex2) {
        // Skip degenerate triangle
        continue;
      }

      // Add triangle vertices, replacing vertexIndex2 with collapsed position
      for (let j = 0; j < 3; j++) {
        const vertexIdx = triVertices[j];

        if (vertexIdx === vertexIndex2) {
          // Replace with new position
          newPositions.push(newPosition.x, newPosition.y, newPosition.z);
        } else if (vertexIdx === vertexIndex1) {
          // Use new position
          newPositions.push(newPosition.x, newPosition.y, newPosition.z);
        } else {
          // Use original position
          newPositions.push(
            positions.getX(vertexIdx),
            positions.getY(vertexIdx),
            positions.getZ(vertexIdx),
          );
        }

        // Handle normals if they exist
        if (normals) {
          newNormals.push(
            normals.getX(vertexIdx),
            normals.getY(vertexIdx),
            normals.getZ(vertexIdx),
          );
        }
      }
    }

    if (newPositions.length === 0) {
      return null;
    }

    // Create new geometry
    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(newPositions, 3),
    );

    if (newNormals.length > 0) {
      newGeometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(newNormals, 3),
      );
    }

    // Use flat normals to maintain crisp face shading (avoid color blending)
    computeFlatNormals(newGeometry);

    // Non-indexed edge collapse completed

    return newGeometry;
  }

  /**
   * Calculate collapse position - simplified to always use midpoint
   * Coplanar faces are handled separately during merging (not decimation)
   */
  private static calculateOptimalCollapsePosition(
    geometry: THREE.BufferGeometry,
    v1: THREE.Vector3,
    v2: THREE.Vector3,
    vertexIndex1: number,
    vertexIndex2: number,
  ): THREE.Vector3 {
    console.log(`   Using midpoint for edge collapse (simplified algorithm)`);

    // Always use midpoint - simple, predictable, and preserves mesh quality
    // Coplanar face merging happens separately in viewer/export pipeline
    return v1.clone().add(v2).multiplyScalar(0.5);
  }

  /**
   * Intelligent vertex clustering - analyzes model first, only processes if needed
   * Won't touch clean models, only fixes actual issues in complex user uploads
   */
  private static performVertexClustering(
    geometry: THREE.BufferGeometry,
    tolerance: number,
  ): Promise<{
    geometry: THREE.BufferGeometry;
    originalStats: any;
    newStats: any;
    reductionAchieved: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    const originalStats = this.calculateMeshStats(geometry);
    const positions = geometry.attributes.position.array as Float32Array;
    const originalVertexCount = positions.length / 3;

    // Analyze if model needs vertex clustering

    // STEP 1: Analyze if this model actually needs clustering
    const modelAnalysis = this.analyzeModelQuality(geometry, tolerance);

    if (!modelAnalysis.needsClustering) {
      // Model doesn't need clustering
      const processingTime = Date.now() - startTime;
      return Promise.resolve({
        geometry: geometry.clone(),
        originalStats,
        newStats: originalStats,
        reductionAchieved: 0,
        processingTime,
      });
    }

    // STEP 2: SAFE vertex deduplication - don't modify geometry structure
    // Model needs clustering - proceeding with safe vertex merging

    const cloned = geometry.clone();

    // TOLERANCE-BASED APPROACH: Merge vertices within tolerance distance
    // Use safe index redirection approach to preserve geometry structure
    if (cloned.index) {
      // Processing indexed geometry with tolerance-based clustering

      // For indexed geometry: update indices to point to first occurrence of vertices within tolerance
      const positionToFirstIndex = new Map<string, number>();
      const oldIndices = Array.from(cloned.index.array);
      let duplicatesRemoved = 0;
      const precision = Math.max(6, Math.floor(-Math.log10(tolerance)));

      // Build map of first occurrence of each position (using tolerance)
      for (let i = 0; i < originalVertexCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const key = `${x.toFixed(precision)},${y.toFixed(precision)},${z.toFixed(precision)}`;

        if (!positionToFirstIndex.has(key)) {
          positionToFirstIndex.set(key, i);
        }
      }

      // Update indices to point to first occurrence of each position (within tolerance)
      for (let i = 0; i < oldIndices.length; i++) {
        const vertexIndex = oldIndices[i];
        const x = positions[vertexIndex * 3];
        const y = positions[vertexIndex * 3 + 1];
        const z = positions[vertexIndex * 3 + 2];
        const key = `${x.toFixed(precision)},${y.toFixed(precision)},${z.toFixed(precision)}`;

        const firstIndex = positionToFirstIndex.get(key)!;
        if (firstIndex !== vertexIndex) {
          oldIndices[i] = firstIndex;
          duplicatesRemoved++;
        }
      }

      cloned.setIndex(oldIndices);
      // Vertex references redirected to reduce duplicates
    } else {
      // Non-indexed geometry skipped for safety
    }

    const newStats = this.calculateMeshStats(cloned);
    const effectiveVerticesUsed = positionToFirstIndex.size;
    const reductionAchieved =
      duplicatesRemoved > 0 ? duplicatesRemoved / oldIndices.length : 0;
    const processingTime = Date.now() - startTime;

    // Vertex clustering completed successfully

    return Promise.resolve({
      geometry: cloned,
      originalStats,
      newStats,
      reductionAchieved,
      processingTime,
    });
  }

  /**
   * Analyze model quality to determine if vertex clustering is needed
   * ULTRA-CONSERVATIVE: Only processes models with obvious problems
   */
  private static analyzeModelQuality(
    geometry: THREE.BufferGeometry,
    tolerance: number,
  ): {
    needsClustering: boolean;
    reason: string;
  } {
    const positions = geometry.attributes.position.array as Float32Array;
    const vertexCount = positions.length / 3;

    // Check 1: Small models (likely clean examples) - NEVER touch
    if (vertexCount < 500) {
      return {
        needsClustering: false,
        reason: "Model under 500 vertices - assumed clean",
      };
    }

    // Check 2: Models under 2000 vertices - be extra careful
    if (vertexCount < 2000 && tolerance > 0.01) {
      return {
        needsClustering: false,
        reason: "Medium model with high tolerance - too risky",
      };
    }

    // Check 3: Look for duplicates within tolerance
    const positionSet = new Set<string>();
    let nearDuplicates = 0;
    const precision = Math.max(6, Math.floor(-Math.log10(tolerance)));

    for (let i = 0; i < vertexCount; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];

      // Use tolerance-based key
      const toleranceKey = `${x.toFixed(precision)},${y.toFixed(precision)},${z.toFixed(precision)}`;
      if (positionSet.has(toleranceKey)) {
        nearDuplicates++;
      } else {
        positionSet.add(toleranceKey);
      }
    }

    // Check 4: Only proceed if there are duplicates
    const duplicatePercentage = nearDuplicates / vertexCount;

    if (nearDuplicates < 5) {
      return {
        needsClustering: false,
        reason: `Only ${nearDuplicates} near duplicates found - model is clean`,
      };
    }

    if (duplicatePercentage < 0.02) {
      // Less than 2% duplicates
      return {
        needsClustering: false,
        reason: `Only ${(duplicatePercentage * 100).toFixed(1)}% near duplicates - model is clean enough`,
      };
    }

    return {
      needsClustering: true,
      reason: `Found ${nearDuplicates} near duplicates (${(duplicatePercentage * 100).toFixed(1)}%) at tolerance ${tolerance} - clustering will help`,
    };
  }
}

/**
 * Tool modes for STL manipulation
 */
export enum STLToolMode {
  None = "none",
  Highlight = "highlight",
  Reduce = "reduce",
}

/**
 * Interface for tool operation results
 */
export interface ToolOperationResult {
  success: boolean;
  message: string;
  geometry?: THREE.BufferGeometry;
  originalStats?: any;
  newStats?: any;
  processingTime?: number;
  stats?: any;
}
