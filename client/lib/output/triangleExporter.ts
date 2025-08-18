import * as THREE from 'three';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

/**
 * Triangle-by-triangle STL exporter for real-world building
 * Creates individual STL files for each triangle, packaged in a zip
 */
export class TriangleExporter {
  
  /**
   * Export each triangle as a separate STL file in a zip archive
   */
  static async exportTrianglesAsZip(
    geometry: THREE.BufferGeometry,
    filename: string = 'model_triangles_intellimesh.zip',
    options: {
      partThickness?: number; // mm thickness for each triangle piece
      scale?: number; // overall scale factor
    } = {}
  ): Promise<void> {
    if (!geometry || !geometry.attributes.position) {
      throw new Error('Invalid geometry provided for triangle export');
    }

    const {
      partThickness = 2, // 2mm thick triangular pieces
      scale = 1
    } = options;

    console.log('Starting triangle-by-triangle export...');
    const startTime = Date.now();

    // Create zip file
    const zip = new JSZip();

    // Get triangle data
    const positions = geometry.attributes.position;
    const triangleCount = Math.floor(positions.count / 3);

    console.log(`Processing ${triangleCount} triangles...`);

    // Track part information for Excel database
    const partDatabase: any[] = [];

    // Create individual STL files for each triangle
    for (let i = 0; i < triangleCount; i++) {
      const triangleSTL = this.createTriangleSTL(geometry, i, partThickness, scale);
      const triangleFilename = `part_${String(i + 1).padStart(4, '0')}.stl`;

      // Calculate part geometry and metrics
      const partInfo = this.calculatePartInfo(geometry, i, partThickness, scale);
      partDatabase.push({
        'Part Number': `part_${String(i + 1).padStart(4, '0')}`,
        'File Name': triangleFilename,
        'Triangle Index': i + 1,
        'Thickness (mm)': partThickness,
        'Scale Factor': scale,
        'Area (mm²)': partInfo.area.toFixed(2),
        'Perimeter (mm)': partInfo.perimeter.toFixed(2),
        'Volume (mm³)': partInfo.volume.toFixed(2),
        'Centroid X (mm)': partInfo.centroid.x.toFixed(3),
        'Centroid Y (mm)': partInfo.centroid.y.toFixed(3),
        'Centroid Z (mm)': partInfo.centroid.z.toFixed(3),
        'Normal Vector X': partInfo.normal.x.toFixed(6),
        'Normal Vector Y': partInfo.normal.y.toFixed(6),
        'Normal Vector Z': partInfo.normal.z.toFixed(6),
        'Min X (mm)': partInfo.bounds.min.x.toFixed(3),
        'Min Y (mm)': partInfo.bounds.min.y.toFixed(3),
        'Min Z (mm)': partInfo.bounds.min.z.toFixed(3),
        'Max X (mm)': partInfo.bounds.max.x.toFixed(3),
        'Max Y (mm)': partInfo.bounds.max.y.toFixed(3),
        'Max Z (mm)': partInfo.bounds.max.z.toFixed(3),
        'Width (mm)': partInfo.dimensions.width.toFixed(3),
        'Height (mm)': partInfo.dimensions.height.toFixed(3),
        'Depth (mm)': partInfo.dimensions.depth.toFixed(3),
        'Estimated Print Time (min)': partInfo.printTime.toFixed(1),
        'Estimated Material (g)': partInfo.material.toFixed(2),
        'Surface Area (mm²)': partInfo.surfaceArea.toFixed(2),
        'Complexity Score': partInfo.complexity.toFixed(2)
      });

      // Add to zip
      zip.file(triangleFilename, triangleSTL);

      // Progress logging
      if (i % 50 === 0 || i === triangleCount - 1) {
        console.log(`Processed triangle part ${i + 1}/${triangleCount}`);
      }
    }

    // Generate Excel file with part database
    console.log('Generating parts database...');
    const excelBuffer = this.generatePartsDatabase(partDatabase, { ...options, partThickness });
    zip.file('parts_database.xlsx', excelBuffer);

    // Add assembly instructions
    const instructions = this.generateAssemblyInstructions(triangleCount, { ...options, partThickness });
    zip.file('assembly_instructions.txt', instructions);

    // Generate and download zip
    console.log('Generating zip file...');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    // Create clean filename: modelname_triangles_intellimesh.zip
    const baseFilename = filename.replace(/\.[^/.]+$/, "").replace(/_triangles_intellimesh$/, "");
    const zipFilename = filename.endsWith(".zip")
      ? filename
      : `${baseFilename}_triangles_intellimesh.zip`;

    // Download the zip file
    this.downloadBlob(zipBlob, zipFilename);
    
    const endTime = Date.now();
    console.log(`Triangle export completed in ${endTime - startTime}ms`);
    console.log(`Created ${triangleCount} triangle pieces + assembly instructions`);
  }

  /**
   * Create a 3D printable STL for a single triangle with thickness
   */
  private static createTriangleSTL(
    originalGeometry: THREE.BufferGeometry,
    triangleIndex: number,
    thickness: number,
    scale: number
  ): string {
    const positions = originalGeometry.attributes.position;
    const i3 = triangleIndex * 3;

    // Get triangle vertices
    const v1 = new THREE.Vector3(
      positions.getX(i3) * scale,
      positions.getY(i3) * scale,
      positions.getZ(i3) * scale
    );
    const v2 = new THREE.Vector3(
      positions.getX(i3 + 1) * scale,
      positions.getY(i3 + 1) * scale,
      positions.getZ(i3 + 1) * scale
    );
    const v3 = new THREE.Vector3(
      positions.getX(i3 + 2) * scale,
      positions.getY(i3 + 2) * scale,
      positions.getZ(i3 + 2) * scale
    );

    // Calculate triangle normal for extrusion direction
    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v3, v1);
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

    // Ensure valid normal (not zero vector)
    if (normal.length() < 0.001) {
      normal.set(0, 0, 1); // Default upward normal
    }

    // Create extruded triangle (prism) - full thickness in normal direction
    const offset = normal.clone().multiplyScalar(thickness);

    // Front face vertices (original triangle)
    const v1f = v1.clone();
    const v2f = v2.clone();
    const v3f = v3.clone();

    // Back face vertices (extruded by thickness)
    const v1b = v1.clone().add(offset);
    const v2b = v2.clone().add(offset);
    const v3b = v3.clone().add(offset);

    // Generate STL content
    let stlContent = `solid part_${triangleIndex + 1}\n`;

    // Front face (original triangle)
    stlContent += this.addTriangleToSTL(v1f, v2f, v3f, normal);

    // Back face (extruded triangle, flipped normal)
    const backNormal = normal.clone().negate();
    stlContent += this.addTriangleToSTL(v1b, v3b, v2b, backNormal);

    // Side faces (rectangles made of triangles)
    // Side 1-2
    stlContent += this.addQuadToSTL(v1f, v2f, v2b, v1b);

    // Side 2-3
    stlContent += this.addQuadToSTL(v2f, v3f, v3b, v2b);

    // Side 3-1
    stlContent += this.addQuadToSTL(v3f, v1f, v1b, v3b);

    stlContent += 'endsolid part_' + (triangleIndex + 1) + '\n';

    return stlContent;
  }

  /**
   * Add a single triangle to STL content
   */
  private static addTriangleToSTL(v1: THREE.Vector3, v2: THREE.Vector3, v3: THREE.Vector3, normal: THREE.Vector3): string {
    return `  facet normal ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}\n` +
           `    outer loop\n` +
           `      vertex ${v1.x.toFixed(6)} ${v1.y.toFixed(6)} ${v1.z.toFixed(6)}\n` +
           `      vertex ${v2.x.toFixed(6)} ${v2.y.toFixed(6)} ${v2.z.toFixed(6)}\n` +
           `      vertex ${v3.x.toFixed(6)} ${v3.y.toFixed(6)} ${v3.z.toFixed(6)}\n` +
           `    endloop\n` +
           `  endfacet\n`;
  }

  /**
   * Add a quad (as two triangles) to STL content
   */
  private static addQuadToSTL(v1: THREE.Vector3, v2: THREE.Vector3, v3: THREE.Vector3, v4: THREE.Vector3): string {
    // Calculate normal for the quad
    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v4, v1);
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

    // Two triangles to make a quad
    let content = this.addTriangleToSTL(v1, v2, v3, normal);
    content += this.addTriangleToSTL(v1, v3, v4, normal);

    return content;
  }



  /**
   * Generate assembly instructions
   */
  private static generateAssemblyInstructions(triangleCount: number, options: any): string {
    const date = new Date().toLocaleDateString();

    return `STL Triangle Assembly Kit
Generated: ${date}

ASSEMBLY INSTRUCTIONS:
=====================

This kit contains ${triangleCount} individual triangle pieces that can be assembled
to recreate the original 3D model.

INCLUDED FILES:
- ${triangleCount} individual STL files (part_0001.stl through part_${String(triangleCount).padStart(4, '0')}.stl)
- parts_database.xlsx - Comprehensive database with detailed part specifications
- assembly_instructions.txt - This file

PIECE SPECIFICATIONS:
- Part thickness: ${options.partThickness || 2}mm
- Material recommended: PLA or PETG plastic
- Infill: 20-30% for structural strength
- Layer height: 0.2mm recommended

PARTS DATABASE:
The included Excel file (parts_database.xlsx) contains detailed information for each part:
- Part numbers and file names
- Geometric properties (area, volume, dimensions)
- Position data (centroids, bounding boxes)
- Print estimates (time, material usage)
- Complexity scores for planning assembly order

ASSEMBLY TIPS:
1. Review the parts database to understand piece sizes and complexity
2. Sort pieces by complexity score or size before starting
3. Use strong adhesive (CA glue or epoxy) for permanent assembly
4. For temporary assembly, consider small magnets or clips
5. Test fit pieces before applying adhesive
6. Work in small sections and allow adhesive to cure
7. Use the centroid coordinates to help with piece positioning

PIECE NAMING:
- part_0001.stl through part_${String(triangleCount).padStart(4, '0')}.stl
- Numbers correspond to original triangle order in the model
- File names align with "Part Number" column in Excel database

SAFETY:
- Use appropriate ventilation when working with adhesives
- Wear safety glasses when cutting or sanding pieces
- Adult supervision required for young builders

TROUBLESHOOTING:
- If pieces don't fit perfectly, light sanding may be needed
- Check your 3D printer calibration if multiple pieces are oversized
- For gaps, consider using filler material or adjusting print settings
- Refer to the statistics sheet in Excel for part size variations

Happy building!

Generated by STL Viewer Platform
Visit: [Your Platform URL]
`;
  }

  /**
   * Download blob as file
   */
  private static downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up URL
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  /**
   * Calculate detailed information for a single triangle part
   */
  private static calculatePartInfo(
    geometry: THREE.BufferGeometry,
    triangleIndex: number,
    thickness: number,
    scale: number
  ) {
    const positions = geometry.attributes.position;
    const i3 = triangleIndex * 3;

    // Get triangle vertices
    const v1 = new THREE.Vector3(
      positions.getX(i3) * scale,
      positions.getY(i3) * scale,
      positions.getZ(i3) * scale
    );
    const v2 = new THREE.Vector3(
      positions.getX(i3 + 1) * scale,
      positions.getY(i3 + 1) * scale,
      positions.getZ(i3 + 1) * scale
    );
    const v3 = new THREE.Vector3(
      positions.getX(i3 + 2) * scale,
      positions.getY(i3 + 2) * scale,
      positions.getZ(i3 + 2) * scale
    );

    // Calculate triangle properties
    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v3, v1);
    const edge3 = new THREE.Vector3().subVectors(v3, v2);

    // Normal vector
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
    if (normal.length() < 0.001) {
      normal.set(0, 0, 1);
    }

    // Triangle area (2D)
    const area = edge1.clone().cross(edge2).length() / 2;

    // Perimeter
    const perimeter = edge1.length() + edge2.length() + edge3.length();

    // Volume (area * thickness)
    const volume = area * thickness;

    // Centroid
    const centroid = new THREE.Vector3()
      .addVectors(v1, v2)
      .add(v3)
      .divideScalar(3);

    // Bounding box
    const minX = Math.min(v1.x, v2.x, v3.x);
    const maxX = Math.max(v1.x, v2.x, v3.x);
    const minY = Math.min(v1.y, v2.y, v3.y);
    const maxY = Math.max(v1.y, v2.y, v3.y);
    const minZ = Math.min(v1.z, v2.z, v3.z);
    const maxZ = Math.max(v1.z, v2.z, v3.z);

    const bounds = {
      min: new THREE.Vector3(minX, minY, minZ),
      max: new THREE.Vector3(maxX, maxY, maxZ)
    };

    const dimensions = {
      width: maxX - minX,
      height: maxY - minY,
      depth: (maxZ - minZ) + thickness // include extrusion thickness
    };

    // Surface area (including thickness)
    const triangleArea = area;
    const sideArea1 = edge1.length() * thickness;
    const sideArea2 = edge2.length() * thickness;
    const sideArea3 = edge3.length() * thickness;
    const surfaceArea = (triangleArea * 2) + sideArea1 + sideArea2 + sideArea3;

    // Print time estimation based on area and thickness
    const baseTimePerMm2 = 0.5; // minutes per mm²
    const thicknessFactor = Math.max(1, thickness / 2); // scale with thickness
    const printTime = (area * baseTimePerMm2 * thicknessFactor);

    // Material estimation (based on volume and PLA density ~1.24 g/cm³)
    const materialDensity = 0.00124; // g/mm³ for PLA
    const material = volume * materialDensity;

    // Complexity score (based on aspect ratio and edge variation)
    const aspectRatio = Math.max(dimensions.width, dimensions.height) / Math.min(dimensions.width, dimensions.height);
    const edgeLengths = [edge1.length(), edge2.length(), edge3.length()];
    const edgeVariation = (Math.max(...edgeLengths) - Math.min(...edgeLengths)) / Math.max(...edgeLengths);
    const complexity = aspectRatio + (edgeVariation * 5); // weighted score

    return {
      area,
      perimeter,
      volume,
      centroid,
      normal,
      bounds,
      dimensions,
      surfaceArea,
      printTime,
      material,
      complexity
    };
  }

  /**
   * Generate Excel file with parts database
   */
  private static generatePartsDatabase(partData: any[], options: any): ArrayBuffer {
    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Parts data worksheet
    const partsSheet = XLSX.utils.json_to_sheet(partData);

    // Set column widths for better readability
    const colWidths = [
      { wch: 12 }, // Part Number
      { wch: 20 }, // File Name
      { wch: 8 },  // Triangle Index
      { wch: 12 }, // Thickness
      { wch: 10 }, // Scale Factor
      { wch: 12 }, // Area
      { wch: 12 }, // Perimeter
      { wch: 12 }, // Volume
      { wch: 12 }, // Centroid X
      { wch: 12 }, // Centroid Y
      { wch: 12 }, // Centroid Z
      { wch: 12 }, // Normal X
      { wch: 12 }, // Normal Y
      { wch: 12 }, // Normal Z
      { wch: 12 }, // Min X
      { wch: 12 }, // Min Y
      { wch: 12 }, // Min Z
      { wch: 12 }, // Max X
      { wch: 12 }, // Max Y
      { wch: 12 }, // Max Z
      { wch: 12 }, // Width
      { wch: 12 }, // Height
      { wch: 12 }, // Depth
      { wch: 15 }, // Print Time
      { wch: 15 }, // Material
      { wch: 15 }, // Surface Area
      { wch: 12 }  // Complexity
    ];

    partsSheet['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(workbook, partsSheet, 'Parts Database');

    // Summary worksheet
    const summary = this.generateSummaryData(partData, options);
    const summarySheet = XLSX.utils.json_to_sheet(summary);
    summarySheet['!cols'] = [{ wch: 25 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Project Summary');

    // Statistics worksheet
    const stats = this.generateStatistics(partData);
    const statsSheet = XLSX.utils.json_to_sheet(stats);
    statsSheet['!cols'] = [{ wch: 25 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(workbook, statsSheet, 'Statistics');

    // Convert to buffer
    return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  }

  /**
   * Generate summary data for Excel
   */
  private static generateSummaryData(partData: any[], options: any) {
    const date = new Date().toLocaleDateString();
    const totalParts = partData.length;
    const totalVolume = partData.reduce((sum, part) => sum + parseFloat(part['Volume (mm³)']), 0);
    const totalArea = partData.reduce((sum, part) => sum + parseFloat(part['Area (mm²)']), 0);
    const totalPrintTime = partData.reduce((sum, part) => sum + parseFloat(part['Estimated Print Time (min)']), 0);
    const totalMaterial = partData.reduce((sum, part) => sum + parseFloat(part['Estimated Material (g)']), 0);
    const avgComplexity = partData.reduce((sum, part) => sum + parseFloat(part['Complexity Score']), 0) / totalParts;

    return [
      { 'Property': 'Generation Date', 'Value': date },
      { 'Property': 'Total Parts', 'Value': totalParts },
      { 'Property': 'Part Thickness (mm)', 'Value': options.partThickness || 2 },
      { 'Property': 'Scale Factor', 'Value': options.scale || 1 },
      { 'Property': 'Total Volume (mm³)', 'Value': totalVolume.toFixed(2) },
      { 'Property': 'Total Surface Area (mm²)', 'Value': totalArea.toFixed(2) },
      { 'Property': 'Estimated Total Print Time (min)', 'Value': totalPrintTime.toFixed(1) },
      { 'Property': 'Estimated Total Print Time (hours)', 'Value': (totalPrintTime / 60).toFixed(1) },
      { 'Property': 'Estimated Total Material (g)', 'Value': totalMaterial.toFixed(2) },
      { 'Property': 'Estimated Total Material (kg)', 'Value': (totalMaterial / 1000).toFixed(3) },
      { 'Property': 'Average Complexity Score', 'Value': avgComplexity.toFixed(2) },
      { 'Property': 'Assembly Time Estimate (hours)', 'Value': (totalParts * 3 / 60).toFixed(1) },
      { 'Property': 'Generated By', 'Value': 'STL Viewer Platform' }
    ];
  }

  /**
   * Generate statistics for Excel
   */
  private static generateStatistics(partData: any[]) {
    const volumes = partData.map(p => parseFloat(p['Volume (mm³)']));
    const areas = partData.map(p => parseFloat(p['Area (mm²)']));
    const printTimes = partData.map(p => parseFloat(p['Estimated Print Time (min)']));
    const complexities = partData.map(p => parseFloat(p['Complexity Score']));

    const stats = (arr: number[]) => ({
      min: Math.min(...arr),
      max: Math.max(...arr),
      avg: arr.reduce((a, b) => a + b, 0) / arr.length,
      median: arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)]
    });

    const volumeStats = stats(volumes);
    const areaStats = stats(areas);
    const timeStats = stats(printTimes);
    const complexityStats = stats(complexities);

    return [
      { 'Metric': 'Volume - Minimum (mm³)', 'Value': volumeStats.min.toFixed(2) },
      { 'Metric': 'Volume - Maximum (mm³)', 'Value': volumeStats.max.toFixed(2) },
      { 'Metric': 'Volume - Average (mm³)', 'Value': volumeStats.avg.toFixed(2) },
      { 'Metric': 'Volume - Median (mm³)', 'Value': volumeStats.median.toFixed(2) },
      { 'Metric': 'Area - Minimum (mm²)', 'Value': areaStats.min.toFixed(2) },
      { 'Metric': 'Area - Maximum (mm²)', 'Value': areaStats.max.toFixed(2) },
      { 'Metric': 'Area - Average (mm²)', 'Value': areaStats.avg.toFixed(2) },
      { 'Metric': 'Area - Median (mm²)', 'Value': areaStats.median.toFixed(2) },
      { 'Metric': 'Print Time - Minimum (min)', 'Value': timeStats.min.toFixed(1) },
      { 'Metric': 'Print Time - Maximum (min)', 'Value': timeStats.max.toFixed(1) },
      { 'Metric': 'Print Time - Average (min)', 'Value': timeStats.avg.toFixed(1) },
      { 'Metric': 'Print Time - Median (min)', 'Value': timeStats.median.toFixed(1) },
      { 'Metric': 'Complexity - Minimum', 'Value': complexityStats.min.toFixed(2) },
      { 'Metric': 'Complexity - Maximum', 'Value': complexityStats.max.toFixed(2) },
      { 'Metric': 'Complexity - Average', 'Value': complexityStats.avg.toFixed(2) },
      { 'Metric': 'Complexity - Median', 'Value': complexityStats.median.toFixed(2) }
    ];
  }

  /**
   * Get export statistics based on part thickness
   */
  static getExportStats(geometry: THREE.BufferGeometry, partThickness: number = 2): {
    triangleCount: number;
    estimatedPrintTime: string;
    estimatedMaterial: string;
    estimatedAssemblyTime: string;
  } {
    const triangleCount = Math.floor(geometry.attributes.position.count / 3);

    // Calculate estimates based on part thickness
    // Base time is 10 minutes per triangle at 2mm thickness
    const baseTimePerTriangle = 10; // minutes per triangle at 2mm
    const thicknessMultiplier = partThickness / 2; // scale with thickness
    const printTimePerTriangle = baseTimePerTriangle * thicknessMultiplier;
    const totalPrintMinutes = triangleCount * printTimePerTriangle;
    const printHours = Math.floor(totalPrintMinutes / 60);
    const printMinutes = totalPrintMinutes % 60;

    // Base material is 1.5g per triangle at 2mm thickness
    const baseMaterialPerTriangle = 1.5; // grams per triangle at 2mm
    const materialPerTriangle = baseMaterialPerTriangle * thicknessMultiplier;
    const totalMaterial = Math.round(triangleCount * materialPerTriangle);

    // Assembly time doesn't change with thickness
    const assemblyTimeMinutes = triangleCount * 3; // 3 minutes per triangle to assemble
    const assemblyHours = Math.floor(assemblyTimeMinutes / 60);
    const assemblyMins = assemblyTimeMinutes % 60;

    return {
      triangleCount,
      estimatedPrintTime: `${printHours}h ${printMinutes}m`,
      estimatedMaterial: `${totalMaterial}g filament`,
      estimatedAssemblyTime: `${assemblyHours}h ${assemblyMins}m`
    };
  }
}
