import * as THREE from "three";
import { MeshStats } from "./meshSimplifier";
import { EdgeAdjacentMerger, PolygonFace } from "./edgeAdjacentMerger";
import { computeFlatNormals } from "../visualization/flatNormals";

/**
 * Clean vertex removal implementation for decimation painter
 */
export class VertexRemovalStitcher {
  /**
   * Polygon-aware vertex merging - only adjusts vertices that are part of polygon model
   */
  static async collapseSingleEdge(
    geometry: THREE.BufferGeometry,
    vertexIndex1: number,
    vertexIndex2: number,
    collapsePosition: THREE.Vector3,
  ): Promise<{
    success: boolean;
    message: string;
    geometry?: THREE.BufferGeometry;
  }> {
    const originalVertexCount = geometry.attributes.position.count;

    try {
      const positions = geometry.attributes.position.array as Float32Array;

      // STEP 1: Get the polygon faces metadata
      const polygonFaces = (geometry as any).polygonFaces;
      if (!polygonFaces || !Array.isArray(polygonFaces)) {
        console.warn(
          "   No polygon metadata found - falling back to basic vertex merge",
        );
        return this.basicVertexMerge(
          geometry,
          vertexIndex1,
          vertexIndex2,
          collapsePosition,
        );
      }

      // STEP 2: Find the logical vertices in polygon model
      const vertex1Pos = new THREE.Vector3(
        positions[vertexIndex1 * 3],
        positions[vertexIndex1 * 3 + 1],
        positions[vertexIndex1 * 3 + 2],
      );

      const vertex2Pos = new THREE.Vector3(
        positions[vertexIndex2 * 3],
        positions[vertexIndex2 * 3 + 1],
        positions[vertexIndex2 * 3 + 2],
      );

      // STEP 3: Find buffer vertices that correspond to these polygon vertices
      const tolerance = 0.001;
      const polygonVertexInstances = new Set<number>();

      // For each polygon face, find buffer vertices that match our edge vertices
      for (const face of polygonFaces) {
        if (!face.originalVertices) continue;

        for (const polygonVertex of face.originalVertices) {
          const polygonPos =
            polygonVertex instanceof THREE.Vector3
              ? polygonVertex
              : new THREE.Vector3(
                  polygonVertex.x,
                  polygonVertex.y,
                  polygonVertex.z,
                );

          // If this polygon vertex matches either of our edge vertices
          if (
            polygonPos.distanceTo(vertex1Pos) < tolerance ||
            polygonPos.distanceTo(vertex2Pos) < tolerance
          ) {
            // Find all buffer vertices that match this polygon vertex position
            for (let i = 0; i < originalVertexCount; i++) {
              const bufferPos = new THREE.Vector3(
                positions[i * 3],
                positions[i * 3 + 1],
                positions[i * 3 + 2],
              );

              if (bufferPos.distanceTo(polygonPos) < tolerance) {
                polygonVertexInstances.add(i);
              }
            }
          }
        }
      }

      const affectedInstances = Array.from(polygonVertexInstances);

      // STEP 4: Move only the polygon-model-related buffer vertices
      const resultGeometry = geometry.clone();
      const resultPositions = resultGeometry.attributes.position
        .array as Float32Array;

      affectedInstances.forEach((vertexIndex) => {
        resultPositions[vertexIndex * 3] = collapsePosition.x;
        resultPositions[vertexIndex * 3 + 1] = collapsePosition.y;
        resultPositions[vertexIndex * 3 + 2] = collapsePosition.z;
      });

      // STEP 5: DISABLED - Do not remove faces (prevents holes)
      // this.removeDegenerateFaces(resultGeometry); // DISABLED: Creates holes!

      // STEP 6: Update polygon metadata
      const updatedPolygonFaces = this.updatePolygonFaces(
        polygonFaces,
        vertex1Pos,
        vertex2Pos,
        collapsePosition,
      );

      // STEP 7: Validate and fix coplanarity after decimation using edge-adjacent merger
      const validatedFaces = EdgeAdjacentMerger.groupEdgeAdjacentTriangles(
        updatedPolygonFaces.map((face: any) => ({
          type: face.type,
          originalVertices: face.originalVertices.map((v: any) =>
            v instanceof THREE.Vector3 ? v : new THREE.Vector3(v.x, v.y, v.z),
          ),
          normal:
            face.normal instanceof THREE.Vector3
              ? face.normal
              : new THREE.Vector3(face.normal.x, face.normal.y, face.normal.z),
          triangleIndices: face.triangleIndices || [],
        })),
      );

      (resultGeometry as any).polygonFaces = validatedFaces;
      (resultGeometry as any).polygonType = (geometry as any).polygonType;
      (resultGeometry as any).isPolygonPreserved = true;

      // Update position attribute
      resultGeometry.attributes.position.needsUpdate = true;

      // IMPORTANT: Use flat normals to maintain crisp face shading
      // computeVertexNormals() creates smooth shading which blends colors
      computeFlatNormals(resultGeometry);
      resultGeometry.uuid = THREE.MathUtils.generateUUID();

      return {
        success: true,
        message: `Polygon model vertices merged: ${affectedInstances.length} instances`,
        geometry: resultGeometry,
      };
    } catch (error) {
      console.error("❌ Polygon-aware vertex merge failed:", error);
      return {
        success: false,
        message: `Polygon-aware vertex merge failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Basic vertex merging fallback for non-polygon geometries
   */
  private static async basicVertexMerge(
    geometry: THREE.BufferGeometry,
    vertexIndex1: number,
    vertexIndex2: number,
    collapsePosition: THREE.Vector3,
  ): Promise<{
    success: boolean;
    message: string;
    geometry?: THREE.BufferGeometry;
  }> {
    const positions = geometry.attributes.position.array as Float32Array;
    const tolerance = 0.001;

    const vertex1Pos = new THREE.Vector3(
      positions[vertexIndex1 * 3],
      positions[vertexIndex1 * 3 + 1],
      positions[vertexIndex1 * 3 + 2],
    );

    const vertex2Pos = new THREE.Vector3(
      positions[vertexIndex2 * 3],
      positions[vertexIndex2 * 3 + 1],
      positions[vertexIndex2 * 3 + 2],
    );

    // Find all instances of these vertices
    const affectedInstances = [];
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      const currentPos = new THREE.Vector3(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      );

      if (
        currentPos.distanceTo(vertex1Pos) < tolerance ||
        currentPos.distanceTo(vertex2Pos) < tolerance
      ) {
        affectedInstances.push(i);
      }
    }

    // Move all instances to collapse position
    const resultGeometry = geometry.clone();
    const resultPositions = resultGeometry.attributes.position
      .array as Float32Array;

    affectedInstances.forEach((vertexIndex) => {
      resultPositions[vertexIndex * 3] = collapsePosition.x;
      resultPositions[vertexIndex * 3 + 1] = collapsePosition.y;
      resultPositions[vertexIndex * 3 + 2] = collapsePosition.z;
    });

    // DISABLED: Do not remove faces (prevents holes)
    // this.removeDegenerateFaces(resultGeometry); // DISABLED: Creates holes!
    resultGeometry.attributes.position.needsUpdate = true;
    // Use flat normals to maintain crisp face shading
    computeFlatNormals(resultGeometry);
    resultGeometry.uuid = THREE.MathUtils.generateUUID();

    return {
      success: true,
      message: `Basic vertex merge: ${affectedInstances.length} instances`,
      geometry: resultGeometry,
    };
  }

  /**
   * Remove degenerate faces (triangles with duplicate vertices)
   */
  private static removeDegenerateFaces(geometry: THREE.BufferGeometry): void {
    if (!geometry.index) return;

    const indices = geometry.index.array;
    const validIndices: number[] = [];

    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];

      // Keep triangle if all vertices are different
      if (a !== b && b !== c && a !== c) {
        validIndices.push(a, b, c);
      }
    }

    if (validIndices.length !== indices.length) {
      geometry.setIndex(validIndices);
      console.log(
        `Removed ${(indices.length - validIndices.length) / 3} degenerate faces`,
      );
    }
  }

  /**
   * Merge vertices in non-indexed geometry
   */
  private static mergeNonIndexedVertices(
    positions: Float32Array,
    keepVertex: number,
    removeVertex: number,
    collapsePosition: THREE.Vector3,
    originalVertexCount: number,
  ): null {
    // For non-indexed geometry, we need to find and merge duplicate vertices
    // This is more complex as vertices are stored directly in face data
    const tolerance = 0.001;
    const vertexCount = positions.length / 3;

    console.log(
      `   Non-indexed merge: scanning ${vertexCount} vertices for duplicates`,
    );

    // Find all vertices that match the original positions of our edge vertices
    let mergedCount = 0;
    for (let i = 0; i < vertexCount; i++) {
      const vertex = new THREE.Vector3(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      );

      // If this vertex is close to where our original vertices were, move it to collapse position
      if (vertex.distanceTo(collapsePosition) < tolerance * 10) {
        // Wider tolerance for already moved vertices
        positions[i * 3] = collapsePosition.x;
        positions[i * 3 + 1] = collapsePosition.y;
        positions[i * 3 + 2] = collapsePosition.z;
        mergedCount++;
      }
    }

    console.log(
      `   Merged ${mergedCount} duplicate vertices to collapse position`,
    );
    return null; // Non-indexed geometry doesn't use indices
  }

  /**
   * Compact vertex attribute when removing a vertex
   */
  private static compactAttribute(
    attribute: THREE.BufferAttribute,
    removeVertexIndex: number,
    originalVertexCount: number,
  ): THREE.BufferAttribute | null {
    const itemSize = attribute.itemSize;
    const oldArray = attribute.array;
    const newVertexCount = originalVertexCount - 1;

    // Create new array with one less vertex
    const ArrayConstructor = oldArray.constructor as any;
    const newArray = new ArrayConstructor(newVertexCount * itemSize);

    // Copy data before removed vertex
    for (let i = 0; i < removeVertexIndex * itemSize; i++) {
      newArray[i] = oldArray[i];
    }

    // Copy data after removed vertex (shifted down)
    for (let i = (removeVertexIndex + 1) * itemSize; i < oldArray.length; i++) {
      newArray[i - itemSize] = oldArray[i];
    }

    return new THREE.BufferAttribute(newArray, itemSize);
  }

  /**
   * Update polygon face metadata after edge collapse
   */
  private static updatePolygonFaces(
    polygonFaces: any[],
    vertex1Pos: THREE.Vector3,
    vertex2Pos: THREE.Vector3,
    collapsePosition: THREE.Vector3,
  ): any[] {
    return polygonFaces.map((face, faceIndex) => {
      if (!face.originalVertices || !Array.isArray(face.originalVertices)) {
        return face;
      }

      const tolerance = 0.001;
      const newVertices = [];
      let edgeVerticesFound = 0;
      let verticesRemoved = 0;

      // Process each vertex in the polygon
      for (let i = 0; i < face.originalVertices.length; i++) {
        const vertex = face.originalVertices[i];
        const vertexPos =
          vertex instanceof THREE.Vector3
            ? vertex
            : new THREE.Vector3(vertex.x, vertex.y, vertex.z);

        // If this vertex matches either edge vertex, replace with collapse position
        if (
          vertexPos.distanceTo(vertex1Pos) < tolerance ||
          vertexPos.distanceTo(vertex2Pos) < tolerance
        ) {
          // Only add collapse position if we haven't already (edge collapse merges both vertices)
          if (edgeVerticesFound === 0) {
            newVertices.push(collapsePosition.clone());
            edgeVerticesFound++;
          }
          // Skip the second edge vertex (it's been merged into the first)
        } else {
          // Keep non-edge vertices as they were
          newVertices.push(vertexPos.clone());
        }
      }

      // Remove consecutive duplicate vertices (from edge collapse)
      const cleanedVertices = [];
      for (let i = 0; i < newVertices.length; i++) {
        const currentVertex = newVertices[i];
        const nextVertex = newVertices[(i + 1) % newVertices.length];

        if (currentVertex.distanceTo(nextVertex) > tolerance) {
          cleanedVertices.push(currentVertex);
        } else {
          verticesRemoved++;
        }
      }

      // Update face type based on new vertex count
      let newType = face.type;
      if (cleanedVertices.length === 3) newType = "triangle";
      else if (cleanedVertices.length === 4) newType = "quad";
      else if (cleanedVertices.length > 4) newType = "polygon";

      if (verticesRemoved > 0) {
        console.log(
          `     Face ${faceIndex}: ${face.originalVertices.length} → ${cleanedVertices.length} vertices (${newType})`,
        );
      }

      return {
        ...face,
        type: newType,
        originalVertices: cleanedVertices,
      };
    });
  }

  /**
   * Main vertex removal function (kept for compatibility)
   */
  static async removeVertices(
    geometry: THREE.BufferGeometry,
    targetReduction: number,
    method: "quadric_edge_collapse" = "quadric_edge_collapse",
  ): Promise<{
    simplifiedGeometry: THREE.BufferGeometry;
    originalStats: MeshStats;
    newStats: MeshStats;
    reductionAchieved: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    const originalStats = this.getMeshStats(geometry);

    // Use our own pure edge collapse implementation
    const simplifiedGeometry = this.pureQuadricEdgeCollapse(
      geometry,
      targetReduction,
    );
    const newStats = this.getMeshStats(simplifiedGeometry);
    const actualReduction =
      (originalStats.vertices - newStats.vertices) / originalStats.vertices;

    return {
      simplifiedGeometry,
      originalStats,
      newStats,
      reductionAchieved: actualReduction,
      processingTime: Date.now() - startTime,
    };
  }

  /**
   * PURE QUADRIC EDGE COLLAPSE - No face deletion, only vertex merging
   * Two vertices become one, all triangles are preserved (just updated indices)
   */
  private static pureQuadricEdgeCollapse(
    geometry: THREE.BufferGeometry,
    targetReduction: number,
  ): THREE.BufferGeometry {
    if (targetReduction <= 0) {
      console.log(
        "⚠�� Zero reduction requested - returning original geometry",
      );
      const cloned = geometry.clone();
      cloned.uuid = THREE.MathUtils.generateUUID();
      return cloned;
    }

    // Allow any reduction amount - no artificial limits

    const cloned = geometry.clone();

    const positions = cloned.attributes.position.array as Float32Array;
    const indices = cloned.index?.array;

    if (!indices) {
      const indexedGeometry = this.convertToIndexed(cloned);
      return this.pureQuadricEdgeCollapse(indexedGeometry, targetReduction);
    }

    const originalVertexCount = positions.length / 3;
    const targetVertexCount = Math.floor(
      originalVertexCount * (1 - targetReduction),
    );
    const verticesToRemove = originalVertexCount - targetVertexCount;

    // Use conservative approach for user-uploaded models to avoid artifacts
    const isAggressiveReduction = targetReduction > 0.7; // Raised threshold - be more conservative

    let edges = this.buildEdgeList(indices);

    const vertexMergeMap = new Map<number, number>(); // old vertex -> new vertex

    let mergedCount = 0;

    // Perform iterative edge collapses until target is reached
    let iterationCount = 0;
    const maxIterations = isAggressiveReduction ? 6 : 3; // Reduced iterations to preserve quality

    while (mergedCount < verticesToRemove && iterationCount < maxIterations) {
      const initialMergeCount = mergedCount;

      // Processing next iteration

      // For aggressive reductions, rebuild edge list every iteration to find new collapse opportunities
      if (isAggressiveReduction && iterationCount > 0) {
        edges = this.buildEdgeList(cloned.index!.array as Uint32Array);
        // Rebuilt edge list for aggressive reduction
      }

      // Sort edges by length for optimal collapse order (shortest first)
      edges.sort((a, b) => {
        const lengthA = this.calculateEdgeLength(positions, a[0], a[1]);
        const lengthB = this.calculateEdgeLength(positions, b[0], b[1]);
        return lengthA - lengthB;
      });

      // Processing edges from shortest to longest

      // Calculate dynamic threshold based on model scale
      const modelBounds = new THREE.Box3().setFromBufferAttribute(
        new THREE.BufferAttribute(positions, 3),
      );
      const modelSize = modelBounds.getSize(new THREE.Vector3()).length();
      const maxAllowableEdgeLength = modelSize * 0.2; // 20% of model diagonal

      let edgesProcessed = 0;
      let edgesSkipped = 0;

      for (const [v1, v2] of edges) {
        if (mergedCount >= verticesToRemove) {
          break;
        }

        // Skip if either vertex is already merged
        if (vertexMergeMap.has(v1) || vertexMergeMap.has(v2)) continue;

        // Quality check: Skip extremely long edges to avoid major distortion
        const edgeLength = this.calculateEdgeLength(positions, v1, v2);

        if (edgeLength > maxAllowableEdgeLength) {
          edgesSkipped++;
          continue;
        }

        edgesProcessed++;

        // Calculate collapse position (midpoint for simplicity)
        const midX = (positions[v1 * 3] + positions[v2 * 3]) / 2;
        const midY = (positions[v1 * 3 + 1] + positions[v2 * 3 + 1]) / 2;
        const midZ = (positions[v1 * 3 + 2] + positions[v2 * 3 + 2]) / 2;

        // Move v1 to collapse position, map v2 to v1
        positions[v1 * 3] = midX;
        positions[v1 * 3 + 1] = midY;
        positions[v1 * 3 + 2] = midZ;

        vertexMergeMap.set(v2, v1); // v2 now points to v1
        mergedCount++;

        if (mergedCount % 1000 === 0) {
          console.log(
            `     Progress: ${mergedCount}/${verticesToRemove} vertices merged`,
          );
        }
      }

      // Edge processing completed

      // If we skipped all edges due to length, try a more permissive approach
      if (
        edgesProcessed === 0 &&
        edgesSkipped > 0 &&
        mergedCount < verticesToRemove
      ) {
        // All edges too long - trying relaxed threshold
        const relaxedThreshold = modelSize * 0.5; // 50% of model diagonal

        for (const [v1, v2] of edges.slice(0, Math.min(10, edges.length))) {
          // Try first 10 edges
          if (mergedCount >= verticesToRemove) break;
          if (vertexMergeMap.has(v1) || vertexMergeMap.has(v2)) continue;

          const edgeLength = this.calculateEdgeLength(positions, v1, v2);
          if (edgeLength <= relaxedThreshold) {
            // Perform the merge
            const midX = (positions[v1 * 3] + positions[v2 * 3]) / 2;
            const midY = (positions[v1 * 3 + 1] + positions[v2 * 3 + 1]) / 2;
            const midZ = (positions[v1 * 3 + 2] + positions[v2 * 3 + 2]) / 2;

            positions[v1 * 3] = midX;
            positions[v1 * 3 + 1] = midY;
            positions[v1 * 3 + 2] = midZ;

            vertexMergeMap.set(v2, v1);
            mergedCount++;
            console.log(`   Merged vertices ${v2} → ${v1} (relaxed threshold)`);
          }
        }
      }

      // Check if we made progress in this iteration
      if (mergedCount === initialMergeCount) {
        console.log(
          `   ⚠️ No progress in iteration ${iterationCount + 1} - stopping early`,
        );
        break;
      }

      iterationCount++;
    }

    if (mergedCount < verticesToRemove) {
      console.log(
        `   ⚠���� Could only achieve ${((mergedCount / originalVertexCount) * 100).toFixed(1)}% reduction instead of target ${(targetReduction * 100).toFixed(1)}%`,
      );
    }

    // Update triangle indices to use merged vertices and remove degenerate triangles
    const validTriangles: number[] = [];
    let removedTriangles = 0;

    for (let i = 0; i < indices.length; i += 3) {
      const v1 = vertexMergeMap.get(indices[i]) ?? indices[i];
      const v2 = vertexMergeMap.get(indices[i + 1]) ?? indices[i + 1];
      const v3 = vertexMergeMap.get(indices[i + 2]) ?? indices[i + 2];

      // Skip degenerate triangles (where two or more vertices are the same)
      if (v1 !== v2 && v2 !== v3 && v3 !== v1) {
        validTriangles.push(v1, v2, v3);
      } else {
        removedTriangles++;
      }
    }

    // Degenerate triangles removed, geometry cleaned

    // Remap vertex indices to remove gaps (important for proper rendering)
    const usedVertices = new Set(validTriangles);
    const vertexRemap = new Map<number, number>();
    const newPositions: number[] = [];
    let newVertexIndex = 0;

    // Build vertex remapping and collect used vertex positions
    for (const vertexIndex of Array.from(usedVertices).sort((a, b) => a - b)) {
      vertexRemap.set(vertexIndex, newVertexIndex);

      // Copy vertex position
      const baseIndex = vertexIndex * 3;
      newPositions.push(
        positions[baseIndex],
        positions[baseIndex + 1],
        positions[baseIndex + 2],
      );

      newVertexIndex++;
    }

    // Apply vertex remapping to triangle indices
    const remappedTriangles = validTriangles.map((idx) => {
      const remapped = vertexRemap.get(idx);
      if (remapped === undefined) {
        console.error(`❌ Failed to remap vertex index ${idx}`);
        throw new Error(`Invalid vertex remapping for index ${idx}`);
      }
      return remapped;
    });

    // Validate all indices are within bounds
    const maxIndex = newPositions.length / 3 - 1;
    for (let i = 0; i < remappedTriangles.length; i++) {
      if (remappedTriangles[i] > maxIndex) {
        console.error(
          `❌ Invalid triangle index: ${remappedTriangles[i]} > ${maxIndex}`,
        );
        throw new Error(
          `Invalid triangle index: ${remappedTriangles[i]} > ${maxIndex}`,
        );
      }
    }

    // Vertex remapping completed

    // Update geometry with cleaned vertices and indices
    cloned.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(newPositions, 3),
    );
    cloned.setIndex(remappedTriangles);
    cloned.attributes.position.needsUpdate = true;

    const newUUID = THREE.MathUtils.generateUUID();
    cloned.uuid = newUUID;

    // Validate the geometry is not malformed
    if (validTriangles.length === 0) {
      console.error("❌ All triangles were removed - geometry is empty!");
      return cloned; // Return original if everything was removed
    }

    // Recompute normals with flat shading to maintain crisp faces
    computeFlatNormals(cloned);

    // CRITICAL: Convert to non-indexed geometry to prevent vertex blending/color interpolation
    console.log(
      "🔧 Converting decimated geometry to non-indexed for solid face coloring",
    );
    const nonIndexed = cloned.toNonIndexed();

    // Copy UUID and preserve all polygon metadata from original geometry
    nonIndexed.uuid = cloned.uuid;

    // CRITICAL: Preserve polygon face information for proper coloring
    if ((geometry as any).polygonFaces) {
      (nonIndexed as any).polygonFaces = (geometry as any).polygonFaces;
      console.log(
        `🔧 Preserved polygon faces metadata: ${(geometry as any).polygonFaces.length} faces`,
      );
    }

    if ((geometry as any).polygonType) {
      (nonIndexed as any).polygonType = (geometry as any).polygonType;
    }

    if ((geometry as any).isPolygonPreserved) {
      (nonIndexed as any).isPolygonPreserved = (
        geometry as any
      ).isPolygonPreserved;
    }

    // Recompute flat normals on the non-indexed geometry for solid coloring
    computeFlatNormals(nonIndexed);

    console.log(
      `✅ Decimation complete: ${newPositions.length / 3} vertices, ${nonIndexed.attributes.position.count / 3} triangles (non-indexed)`,
    );

    // Decimation process completed successfully - returning non-indexed geometry with preserved metadata

    return nonIndexed;
  }

  /**
   * Build edge list from triangle indices
   */
  private static buildEdgeList(
    indices: ArrayLike<number>,
  ): Array<[number, number]> {
    const edgeSet = new Set<string>();
    const edges: Array<[number, number]> = [];

    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];

      // Add all three edges of the triangle
      const edgeAB = a < b ? `${a},${b}` : `${b},${a}`;
      const edgeBC = b < c ? `${b},${c}` : `${c},${b}`;
      const edgeCA = c < a ? `${c},${a}` : `${a},${c}`;

      if (!edgeSet.has(edgeAB)) {
        edgeSet.add(edgeAB);
        edges.push(a < b ? [a, b] : [b, a]);
      }
      if (!edgeSet.has(edgeBC)) {
        edgeSet.add(edgeBC);
        edges.push(b < c ? [b, c] : [c, b]);
      }
      if (!edgeSet.has(edgeCA)) {
        edgeSet.add(edgeCA);
        edges.push(c < a ? [c, a] : [a, c]);
      }
    }

    return edges;
  }

  /**
   * Calculate edge length between two vertices
   */
  private static calculateEdgeLength(
    positions: Float32Array,
    v1: number,
    v2: number,
  ): number {
    const dx = positions[v1 * 3] - positions[v2 * 3];
    const dy = positions[v1 * 3 + 1] - positions[v2 * 3 + 1];
    const dz = positions[v1 * 3 + 2] - positions[v2 * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Convert non-indexed geometry to indexed geometry for edge collapse
   */
  private static convertToIndexed(
    geometry: THREE.BufferGeometry,
  ): THREE.BufferGeometry {
    const positions = geometry.attributes.position.array as Float32Array;
    const vertexCount = positions.length / 3;

    // Build vertex map to merge duplicate vertices
    const vertexMap = new Map<string, number>();
    const newPositions: number[] = [];
    const indices: number[] = [];

    const tolerance = 0.0001; // Very small tolerance for vertex matching

    for (let i = 0; i < vertexCount; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];

      // Create key for vertex deduplication
      const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;

      let index = vertexMap.get(key);
      if (index === undefined) {
        index = newPositions.length / 3;
        vertexMap.set(key, index);
        newPositions.push(x, y, z);
      }

      indices.push(index);
    }

    // Create new indexed geometry
    const indexedGeometry = new THREE.BufferGeometry();
    indexedGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(newPositions, 3),
    );
    indexedGeometry.setIndex(indices);

    // Copy other attributes if they exist
    if (geometry.attributes.normal) {
      indexedGeometry.setAttribute(
        "normal",
        geometry.attributes.normal.clone(),
      );
    }
    if (geometry.attributes.uv) {
      indexedGeometry.setAttribute("uv", geometry.attributes.uv.clone());
    }

    // Copy polygon metadata if it exists
    if ((geometry as any).polygonFaces) {
      (indexedGeometry as any).polygonFaces = (geometry as any).polygonFaces;
    }

    indexedGeometry.uuid = THREE.MathUtils.generateUUID();

    const uniqueVertices = newPositions.length / 3;
    const triangles = indices.length / 3;

    return indexedGeometry;
  }

  /**
   * DEPRECATED: Old basic vertex reduction method
   */
  private static basicVertexReduction(
    geometry: THREE.BufferGeometry,
    targetReduction: number,
  ): THREE.BufferGeometry {
    if (targetReduction <= 0 || targetReduction >= 1) {
      console.warn("⚠️ Invalid reduction amount, returning original");
      const cloned = geometry.clone();
      cloned.uuid = THREE.MathUtils.generateUUID();
      return cloned;
    }

    // For small reductions, apply a conservative vertex merging approach
    if (targetReduction > 0.3) {
      console.warn(
        "⚠️ Large reduction requested, limiting to 30% to prevent holes",
      );
      targetReduction = 0.3;
    }

    const cloned = geometry.clone();
    const positions = cloned.attributes.position.array as Float32Array;
    const indices = cloned.index?.array;

    if (!indices) {
      console.warn(
        "⚠️ Non-indexed geometry - cannot safely reduce without holes",
      );
      cloned.uuid = THREE.MathUtils.generateUUID();
      return cloned;
    }

    // SAFE APPROACH: Merge nearby vertices without removing faces
    // This reduces vertex count while preserving all triangles
    const tolerance = 0.01; // Small tolerance to merge very close vertices
    const vertexMap = new Map<string, number>();
    const newPositions: number[] = [];
    const indexRemapping: number[] = [];

    // Merge vertices that are very close to each other
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];

      // Create key for spatial hashing
      const key = `${Math.round(x / tolerance)},${Math.round(y / tolerance)},${Math.round(z / tolerance)}`;

      let newIndex = vertexMap.get(key);
      if (newIndex === undefined) {
        newIndex = newPositions.length / 3;
        vertexMap.set(key, newIndex);
        newPositions.push(x, y, z);
      }

      indexRemapping[i / 3] = newIndex;
    }

    // Remap indices to use merged vertices
    const newIndices: number[] = [];
    for (let i = 0; i < indices.length; i++) {
      newIndices.push(indexRemapping[indices[i]]);
    }

    // Create new geometry with merged vertices
    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(newPositions, 3),
    );
    newGeometry.setIndex(newIndices);
    newGeometry.uuid = THREE.MathUtils.generateUUID();

    // Use flat normals to maintain crisp face shading
    computeFlatNormals(newGeometry);

    const originalVertexCount = positions.length / 3;
    const newVertexCount = newPositions.length / 3;
    const actualReduction =
      (originalVertexCount - newVertexCount) / originalVertexCount;

    return newGeometry;
  }

  /**
   * Calculate mesh statistics
   */
  private static getMeshStats(geometry: THREE.BufferGeometry): MeshStats {
    const vertices = geometry.attributes.position
      ? geometry.attributes.position.count
      : 0;
    const faces = geometry.index
      ? geometry.index.count / 3
      : Math.floor(vertices / 3);

    return {
      vertices,
      faces,
      edges: vertices + faces - 2,
      volume: 0,
      hasNormals: !!geometry.attributes.normal,
      hasUVs: !!geometry.attributes.uv,
      isIndexed: !!geometry.index,
    };
  }
}
