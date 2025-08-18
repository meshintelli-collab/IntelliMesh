import * as THREE from "three";
import { computeFlatNormals } from "./flatNormals";
import {
  validateAndFixGeometry,
  hasNaNValues,
  logGeometryStats,
} from "../utilities/geometryValidator";

/**
 * UNIFIED GEOMETRY PREPARATION
 *
 * This function ensures ALL geometry (initial load, post-decimation, etc.)
 * goes through the same preparation pipeline for consistent viewing.
 */
export function prepareGeometryForViewing(
  geometry: THREE.BufferGeometry,
  source: "initial_load" | "decimation" | "restoration" = "initial_load",
): THREE.BufferGeometry {
  const prepared = geometry.clone();

  // Quick validation of clone
  if (hasNaNValues(prepared)) {
    validateAndFixGeometry(prepared, `${source} clone fix`);
  }

  // CRITICAL: Copy polygon metadata that clone() doesn't preserve
  if ((geometry as any).polygonFaces) {
    (prepared as any).polygonFaces = (geometry as any).polygonFaces;
  }
  if ((geometry as any).polygonType) {
    (prepared as any).polygonType = (geometry as any).polygonType;
  }
  if ((geometry as any).isPolygonPreserved) {
    (prepared as any).isPolygonPreserved = (geometry as any).isPolygonPreserved;
  }
  if ((geometry as any).isProcedurallyGenerated) {
    (prepared as any).isProcedurallyGenerated = (
      geometry as any
    ).isProcedurallyGenerated;
  }

  // Step 1: Ensure proper face orientation for solid display
  ensureSolidObjectDisplay(prepared);
  if (hasNaNValues(prepared)) {
    validateAndFixGeometry(prepared, `${source} solid display fix`);
  }

  // Step 2: ALWAYS compute flat normals for crisp shading
  // Remove any existing normals first to ensure clean flat normals
  if (prepared.attributes.normal) {
    prepared.deleteAttribute("normal");
  }

  // Force flat normals for solid face coloring (no vertex-based blending)
  computeFlatNormals(prepared);

  // Applied flat normals
  if (hasNaNValues(prepared)) {
    validateAndFixGeometry(prepared, `${source} normals fix`);
  }

  // Step 3: Generate new UUID for React updates
  prepared.uuid = THREE.MathUtils.generateUUID();

  // Final validation
  if (hasNaNValues(prepared)) {
    validateAndFixGeometry(prepared, `${source} final`);
  }

  return prepared;
}

/**
 * Helper function to ensure geometries display as solid objects
 * (Moved from STLContext for reusability)
 */
function ensureSolidObjectDisplay(geometry: THREE.BufferGeometry): void {
  // For geometries that already have proper normals (like decimated ones), check if they need recalculation
  const hasExistingNormals =
    geometry.attributes.normal && geometry.attributes.normal.count > 0;

  if (!hasExistingNormals) {
    // Use flat normals to maintain crisp face shading
    computeFlatNormals(geometry);
  }

  // Check if we need to flip faces by examining face normals
  const positions = geometry.attributes.position.array;
  const normals = geometry.attributes.normal.array;

  // Count how many normals point inward vs outward
  let outwardCount = 0;
  let inwardCount = 0;

  // Sample every 10th normal to check general orientation
  for (let i = 0; i < normals.length; i += 30) {
    // Every 10th vertex (30 = 10 * 3)
    const normal = new THREE.Vector3(
      normals[i],
      normals[i + 1],
      normals[i + 2],
    );
    const vertex = new THREE.Vector3(
      positions[i],
      positions[i + 1],
      positions[i + 2],
    );

    // Get geometry center
    geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    geometry.boundingBox!.getCenter(center);

    // Vector from center to vertex
    const centerToVertex = vertex.clone().sub(center).normalize();

    // If normal and center-to-vertex point in same direction, normal is outward
    if (centerToVertex.dot(normal) > 0) {
      outwardCount++;
    } else {
      inwardCount++;
    }
  }

  // If more normals point inward, flip all faces
  if (inwardCount > outwardCount) {
    // Flip indices to reverse winding order
    const indices = geometry.index;
    if (indices) {
      const indexArray = indices.array;
      for (let i = 0; i < indexArray.length; i += 3) {
        // Swap second and third vertices to flip winding
        const temp = indexArray[i + 1];
        indexArray[i + 1] = indexArray[i + 2];
        indexArray[i + 2] = temp;
      }
      indices.needsUpdate = true;
    } else {
      // Non-indexed geometry - swap position attributes
      const posArray = new Float32Array(positions);
      for (let i = 0; i < posArray.length; i += 9) {
        // Swap vertices 1 and 2 of each triangle
        [posArray[i + 3], posArray[i + 6]] = [posArray[i + 6], posArray[i + 3]];
        [posArray[i + 4], posArray[i + 7]] = [posArray[i + 7], posArray[i + 4]];
        [posArray[i + 5], posArray[i + 8]] = [posArray[i + 8], posArray[i + 5]];
      }
      geometry.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
    }

    // Recompute normals only after face flipping since orientation changed
    computeFlatNormals(geometry);
  }
}
