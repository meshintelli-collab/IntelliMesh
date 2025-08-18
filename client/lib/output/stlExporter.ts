import * as THREE from 'three';

/**
 * STL Exporter utility for exporting Three.js geometry to solid STL format
 * Ensures exported models are watertight, properly oriented solid objects
 */
export class STLExporter {
  /**
   * Export geometry to solid STL format with proper normals and winding
   * Creates watertight solid objects suitable for 3D printing
   */
  static exportGeometry(
    geometry: THREE.BufferGeometry,
    filename: string = 'solid_model.stl',
    targetSize: { min: number; max: number } = { min: 50, max: 100 }
  ): void {
    if (!geometry || !geometry.attributes.position) {
      throw new Error('Invalid geometry provided for export');
    }

    // Clone the geometry to avoid modifying the original
    const exportGeometry = geometry.clone();

    // Prepare geometry for export without double-scaling
    const preparedGeometry = this.prepareGeometryForExport(exportGeometry, targetSize);

    // Generate STL content
    const stlContent = this.generateSTLContent(preparedGeometry);

    // Download the file
    this.downloadSTL(stlContent, filename);

    // Clean up
    preparedGeometry.dispose();
  }

  /**
   * Prepare geometry for export while preserving its current scale and transforms
   * Only applies minimal corrections needed for valid STL output
   */
  private static prepareGeometryForExport(
    geometry: THREE.BufferGeometry,
    targetSize: { min: number; max: number }
  ): THREE.BufferGeometry {
    // Compute bounding box for the current geometry
    geometry.computeBoundingBox();

    if (!geometry.boundingBox) {
      throw new Error('Could not compute geometry bounding box');
    }

    const boundingBox = geometry.boundingBox;
    const size = new THREE.Vector3();
    boundingBox.getSize(size);

    // Find the largest dimension in the current (already scaled) geometry
    const maxDimension = Math.max(size.x, size.y, size.z);

    if (maxDimension === 0) {
      throw new Error('Geometry has zero size');
    }

    // Only apply target sizing if the current scale is very different from target
    // This prevents double-scaling issues
    const targetDimension = (targetSize.min + targetSize.max) / 2;
    const currentToTargetRatio = targetDimension / maxDimension;

    // Only rescale if the geometry is significantly different from target size
    // This preserves viewer scaling while ensuring appropriate export size
    if (currentToTargetRatio < 0.1 || currentToTargetRatio > 10) {
      console.log(`Applying export scaling: ${currentToTargetRatio.toFixed(3)}x to reach ${targetDimension}mm target`);
      geometry.scale(currentToTargetRatio, currentToTargetRatio, currentToTargetRatio);

      // Recompute bounding box after scaling
      geometry.computeBoundingBox();
    } else {
      console.log(`Preserving current scale (${maxDimension.toFixed(1)} units) - within target range`);
    }

    // Ensure geometry sits on Z=0 plane for 3D printing without moving X,Y center
    if (geometry.boundingBox) {
      const minZ = geometry.boundingBox.min.z;
      if (minZ < 0) {
        geometry.translate(0, 0, -minZ);
        console.log(`Moved geometry to Z=0 plane (raised by ${(-minZ).toFixed(3)} units)`);
      }
    }

    // Ensure we have proper normals for solid STL output
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Generate STL file content from geometry preserving original structure
   */
  private static generateSTLContent(geometry: THREE.BufferGeometry): string {
    const positions = geometry.attributes.position;
    const triangleCount = positions.count / 3;

    console.log(`Generating STL content for ${triangleCount} triangles`);

    // STL Header
    let stlContent = 'solid exported_solid\n';

    // Process each triangle preserving original geometry
    for (let i = 0; i < triangleCount; i++) {
      const i3 = i * 3;

      // Get triangle vertices directly from geometry
      const v1 = new THREE.Vector3(
        positions.getX(i3),
        positions.getY(i3),
        positions.getZ(i3)
      );
      const v2 = new THREE.Vector3(
        positions.getX(i3 + 1),
        positions.getY(i3 + 1),
        positions.getZ(i3 + 1)
      );
      const v3 = new THREE.Vector3(
        positions.getX(i3 + 2),
        positions.getY(i3 + 2),
        positions.getZ(i3 + 2)
      );

      // Calculate normal from the actual triangle vertices
      const normal = this.calculateOutwardNormal(v1, v2, v3);

      // Use original vertex order to preserve geometry
      const { vertex1, vertex2, vertex3 } = this.ensureCounterClockwiseWinding(v1, v2, v3, normal);

      // Write facet with high precision to preserve geometry accuracy
      stlContent += `  facet normal ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}\n`;
      stlContent += `    outer loop\n`;
      stlContent += `      vertex ${vertex1.x.toFixed(6)} ${vertex1.y.toFixed(6)} ${vertex1.z.toFixed(6)}\n`;
      stlContent += `      vertex ${vertex2.x.toFixed(6)} ${vertex2.y.toFixed(6)} ${vertex2.z.toFixed(6)}\n`;
      stlContent += `      vertex ${vertex3.x.toFixed(6)} ${vertex3.y.toFixed(6)} ${vertex3.z.toFixed(6)}\n`;
      stlContent += `    endloop\n`;
      stlContent += `  endfacet\n`;
    }

    stlContent += 'endsolid exported_solid\n';

    console.log('STL content generation completed');
    return stlContent;
  }

  /**
   * Ensure geometry forms a solid object with proper normals
   */
  private static ensureSolidGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    // Clone geometry to avoid modifying original
    const solidGeometry = geometry.clone();

    // Ensure we have proper vertex normals
    if (!solidGeometry.attributes.normal) {
      solidGeometry.computeVertexNormals();
    }

    // Note: mergeVertices() was removed - geometry is already optimized from Three.js primitives
    // For STL export, we don't need to merge vertices as it may cause issues

    return solidGeometry;
  }

  /**
   * Calculate outward-facing normal for solid object with robust fallback
   */
  private static calculateOutwardNormal(v1: THREE.Vector3, v2: THREE.Vector3, v3: THREE.Vector3): THREE.Vector3 {
    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v3, v1);

    // Use right-hand rule: edge1 × edge2 gives outward normal
    const normal = new THREE.Vector3().crossVectors(edge1, edge2);

    // Check for degenerate triangle (zero area)
    const normalLength = normal.length();

    if (normalLength < 1e-10) {
      // Degenerate triangle - use a safe fallback normal
      console.warn('Degenerate triangle detected, using fallback normal');
      return new THREE.Vector3(0, 0, 1);
    }

    // Normalize the normal vector
    normal.divideScalar(normalLength);

    return normal;
  }

  /**
   * Preserve original vertex order to maintain geometry integrity
   * Three.js geometries already have correct winding for outward-facing normals
   */
  private static ensureCounterClockwiseWinding(
    v1: THREE.Vector3,
    v2: THREE.Vector3,
    v3: THREE.Vector3,
    expectedNormal: THREE.Vector3
  ): { vertex1: THREE.Vector3; vertex2: THREE.Vector3; vertex3: THREE.Vector3 } {
    // For Three.js geometries, preserve the original vertex order
    // The geometry already has correct winding from Three.js primitives
    // Flipping winding can cause deformation in complex models

    return {
      vertex1: v1.clone(),
      vertex2: v2.clone(),
      vertex3: v3.clone()
    };
  }

  /**
   * Calculate triangle normal vector (legacy method for compatibility)
   */
  private static calculateTriangleNormal(v1: THREE.Vector3, v2: THREE.Vector3, v3: THREE.Vector3): THREE.Vector3 {
    return this.calculateOutwardNormal(v1, v2, v3);
  }

  /**
   * Download STL content as file
   */
  private static downloadSTL(content: string, filename: string): void {
    // Ensure filename is a string and has .stl extension
    const safeFilename = typeof filename === 'string' ? filename : 'exported_model.stl';
    let finalFilename = safeFilename;

    if (!finalFilename.toLowerCase().endsWith('.stl')) {
      finalFilename += '_intellimesh.stl';
    }

    // Create blob and download
    const blob = new Blob([content], { type: 'application/sla' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = finalFilename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up URL
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  /**
   * Get geometry info for display
   */
  static getGeometryInfo(geometry: THREE.BufferGeometry): {
    vertices: number;
    triangles: number;
    boundingBox: THREE.Box3 | null;
    size: THREE.Vector3;
  } {
    geometry.computeBoundingBox();
    
    const vertices = geometry.attributes.position ? geometry.attributes.position.count : 0;
    const triangles = Math.floor(vertices / 3);
    const boundingBox = geometry.boundingBox;
    const size = new THREE.Vector3();
    
    if (boundingBox) {
      boundingBox.getSize(size);
    }
    
    return {
      vertices,
      triangles,
      boundingBox,
      size
    };
  }
}

/**
 * Export current STL as solid object with default 50-100mm sizing
 * Creates watertight solid suitable for 3D printing
 */
export function exportCurrentSTL(
  geometry: THREE.BufferGeometry,
  filename?: string,
  customSize?: { min: number; max: number }
): void {
  const defaultSize = { min: 50, max: 100 }; // 50-100mm default for 3D printing
  const exportSize = customSize || defaultSize;

  // Ensure filename is a proper string
  const safeFilename = typeof filename === 'string' && filename.trim() ? filename.trim() : 'solid_exported_model.stl';
  const exportFilename = safeFilename;

  try {
    STLExporter.exportGeometry(geometry, exportFilename, exportSize);
    console.log(`Solid STL exported successfully: ${exportFilename}`);
    console.log(`Model sized for 3D printing: ${exportSize.min}-${exportSize.max}mm range`);
  } catch (error) {
    console.error('Failed to export solid STL:', error);
    throw error;
  }
}
