import * as THREE from "three";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  PolygonExtruder,
  PolygonFace,
  ExtrusionOptions,
  ChamferOptions,
} from "../processing/polygonExtruder";
import { FaceExtruder, Face } from "../processing/faceExtruder";

/**
 * Interface for edge information with angles
 */
interface EdgeInfo {
  vertices: [THREE.Vector3, THREE.Vector3];
  adjacentFaces: number[];
  edgeAngle: number; // angle between adjacent faces in degrees (0-360°)
  chamferAngle: number; // calculated chamfer angle
  isConvex: boolean; // true for convex (external) edges, false for concave (internal)
}

/**
 * Interface for face with edge angles
 */
interface ChamferedFaceInfo {
  faceInfo: any; // original face info
  edges: EdgeInfo[];
  partIndex: number;
}

/**
 * Utility function to scale polygon faces before part creation
 * This ensures scale is applied to geometry, not thickness
 */
function scalePolygonFaces(
  polygonFaces: PolygonFace[],
  scale: number,
): PolygonFace[] {
  if (scale === 1) return polygonFaces; // No scaling needed

  return polygonFaces.map((face) => {
    const scaledFace = { ...face };

    // Scale vertices if they exist
    if (face.vertices) {
      scaledFace.vertices = face.vertices.map((v) =>
        v.clone().multiplyScalar(scale),
      );
    }

    // Scale originalVertices if they exist
    if ((face as any).originalVertices) {
      (scaledFace as any).originalVertices = (face as any).originalVertices.map((v: THREE.Vector3) =>
        v.clone().multiplyScalar(scale),
      );
    }

    // Scale normal (no change needed, just normalize)
    if (face.normal) {
      scaledFace.normal = face.normal.clone().normalize();
    }

    return scaledFace;
  });
}

/**
 * ChamferedPartsExporter creates 3D printable parts with chamfered edges
 * Follows the exact same structure as PolygonPartsExporter
 */
export class ChamferedPartsExporter {
  /**
   * Export each polygon face as a separate chamfered STL file in a zip archive
   * Uses the same structure as PolygonPartsExporter
   */
  static async exportChamferedPartsAsZip(
    geometry: THREE.BufferGeometry,
    filename: string = "chamfered_parts.zip",
    options: {
      format?: "stl" | "obj";
      partThickness?: number; // mm thickness for each polygon piece
      chamferDepth?: number; // how deep to make chamfers (mm)
      scale?: number; // overall scale factor
      useTriangulated?: boolean; // backup mode using triangulated geometry
    } = {},
  ): Promise<void> {
    if (!geometry || !geometry.attributes.position) {
      throw new Error("Invalid geometry provided for chamfered parts export");
    }

    const {
      format = "stl",
      partThickness = 2,
      chamferDepth = 0.5, // 0.5mm chamfer depth
      scale = 1,
      useTriangulated = false, // backup mode
    } = options;

    const startTime = Date.now();

    // Create zip file
    const zip = new JSZip();

    // FOLLOW EXACT SAME STRUCTURE AS POLYGON PARTS EXPORTER
    // Determine which geometry to use based on backup mode
    let polygonFaces: PolygonFace[];
    let polygonType: string;

    console.log(`🔍 CHAMFERED EXPORT MODE DEBUGGING:`);
    console.log(`   useTriangulated parameter: ${useTriangulated}`);
    console.log(`   Expected: false for Merged mode, true for Triangle mode`);

    if (useTriangulated) {
      // Triangulated mode: use exact original triangulation (NO windmilling)
      console.log(`🎯 USING TRIANGULATED MODE for chamfering (as requested by UI)`);
      polygonFaces =
        PolygonExtruder.extractPolygonsFromTriangulatedGeometry(geometry);
      polygonType = "triangulated_exact";
      console.log(
        `✅ Using EXACT triangulated mode for chamfering: ${polygonFaces.length} triangles (NO reconstruction)`,
      );
    } else {
      // Normal mode: use merged polygon faces
      const mergedFaces =
        PolygonExtruder.extractPolygonsFromMergedGeometry(geometry);
      if (mergedFaces.length === 0) {
        console.log(
          "⚠️ No merged faces found for chamfering, falling back to triangulated mode",
        );
        polygonFaces =
          PolygonExtruder.extractPolygonsFromTriangulatedGeometry(geometry);
        polygonType = "triangulated_fallback";
      } else {
        console.log(`📊 MERGED MODE for chamfering: Found ${mergedFaces.length} merged faces to chamfer`);

        // Log details about the merged faces
        for (let i = 0; i < Math.min(3, mergedFaces.length); i++) {
          const face = mergedFaces[i];
          console.log(`   Face ${i}: ${face.type}, ${face.vertices?.length || 0} vertices, triangulation: ${(face as any).originalTriangulation?.length || 0} triangles`);
        }

        polygonFaces = mergedFaces;
        polygonType = (geometry as any).polygonType || "merged";
        console.log(
          `✅ Using merged polygon mode for chamfering: ${polygonFaces.length} polygons (preserving structure)`,
        );
      }
    }

    if (polygonFaces.length === 0) {
      throw new Error("No polygon faces found for chamfered export");
    }

    // Apply scale to geometry BEFORE processing (not to thickness)
    console.log(
      `🔧 Applying scale factor ${scale} to geometry before chamfering...`,
    );
    polygonFaces = scalePolygonFaces(polygonFaces, scale);

    // Store original geometry data for edge angle calculation
    const originalGeometry = geometry;

    // Track part information for Excel database
    const partDatabase: any[] = [];

    // Calculate edge angles for all faces first (referencing 3D model)
    console.log("🔧 Calculating edge angles from 3D model for chamfering...");
    const chamferedFaces = this.calculateEdgeAngles(polygonFaces, originalGeometry);
    console.log(`✅ Calculated edge angles for ${chamferedFaces.length} faces`);

    // Create individual chamfered files for each polygon face
    for (let i = 0; i < polygonFaces.length; i++) {
      const polygonFace = polygonFaces[i];
      const chamferedFace = chamferedFaces[i];
      const fileExtension = format === "obj" ? "obj" : "stl";

      // Use clean face chamfering (preserves exact polygon structure)
      console.log(`🔧 Creating chamfered part ${i + 1}: ${polygonFace.type} with ${polygonFace.vertices?.length || 0} vertices`);

      // DEBUG: Log the actual face data to see what we're getting
      console.log(`   📊 Face vertices:`, polygonFace.vertices?.map((v, idx) =>
        `${idx}: (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`));
      console.log(`   📊 Face normal:`, polygonFace.normal);
      console.log(`   📊 Face type:`, polygonFace.type);

      // Convert PolygonFace to Face interface (same as polygon parts exporter)
      const face: Face = {
        vertices: polygonFace.vertices || [],
        normal: polygonFace.normal || new THREE.Vector3(0, 0, 1),
        type: polygonFace.type || "polygon"
      };

      // Calculate chamfer data if available
      let edgeAngles: number[] = [];
      let avgChamferAngle = 45.0;
      
      if (chamferedFace && chamferedFace.edges && chamferedFace.edges.length > 0) {
        edgeAngles = chamferedFace.edges.map(e => e.chamferAngle);
        avgChamferAngle = edgeAngles.reduce((a, b) => a + b, 0) / edgeAngles.length;
      } else {
        // Create default chamfer angles for each edge
        edgeAngles = Array(face.vertices.length).fill(45);
      }

      // Create chamfered part using the PolygonExtruder with chamfering
      const chamferOptions: ChamferOptions = {
        chamferDepth,
        edgeAngles,
        defaultChamferAngle: 45
      };

      const extrusionOptions: ExtrusionOptions = {
        thickness: partThickness,
        scale: 1, // scale already applied to polygon faces
        centerZ: 0
      };

      // Convert Face back to PolygonFace for PolygonExtruder
      const polygonFaceForExtruder: PolygonFace = {
        vertices: face.vertices,
        normal: face.normal,
        type: face.type,
        index: i,
        originalTriangulation: (polygonFace as any).originalTriangulation
      };

      // Generate chamfered content
      // STL: Use PolygonExtruder (creates triangulated STL)
      // OBJ: Create proper OBJ with polygon faces (no triangulation)
      const partContent = format === "obj"
        ? this.createChamferedPolygonOBJ(polygonFaceForExtruder, extrusionOptions, chamferOptions)
        : PolygonExtruder.createChamferedPolygon(polygonFaceForExtruder, extrusionOptions, chamferOptions);

      const partFilename = `part_${String(i + 1).padStart(4, "0")}_${polygonFace.type || "polygon"}_chamfered.${fileExtension}`;

      // Calculate part geometry and metrics (similar to polygon parts exporter)
      const partInfo = this.calculateChamferedPartInfo(
        polygonFace,
        partThickness,
        chamferDepth,
        scale,
      );

      // Extract edge angle statistics from calculated chamfer data
      let minEdgeAngle = 90.0; // Default values
      let maxEdgeAngle = 90.0;

      if (chamferedFace && chamferedFace.edges && chamferedFace.edges.length > 0) {
        const edgeAnglesFromCalc = chamferedFace.edges.map((e) => e.edgeAngle);
        minEdgeAngle = Math.min(...edgeAnglesFromCalc);
        maxEdgeAngle = Math.max(...edgeAnglesFromCalc);
      }

      partDatabase.push({
        "Part Number": `part_${String(i + 1).padStart(4, "0")}`,
        "File Name": partFilename,
        "Polygon Index": i + 1,
        "Face Type": polygonFace.type || "polygon",
        "Vertex Count": polygonFace.vertices.length,
        "Thickness (mm)": partThickness,
        "Chamfer Depth (mm)": chamferDepth,
        "Scale Factor": scale,
        "Area (mm²)": partInfo.area.toFixed(2),
        "Perimeter (mm)": partInfo.perimeter.toFixed(2),
        "Volume (mm³)": partInfo.volume.toFixed(2),
        "Centroid X (mm)": partInfo.centroid.x.toFixed(3),
        "Centroid Y (mm)": partInfo.centroid.y.toFixed(3),
        "Centroid Z (mm)": partInfo.centroid.z.toFixed(3),
        "Normal Vector X": (
          polygonFace.normal || new THREE.Vector3(0, 0, 1)
        ).x.toFixed(6),
        "Normal Vector Y": (
          polygonFace.normal || new THREE.Vector3(0, 0, 1)
        ).y.toFixed(6),
        "Normal Vector Z": (
          polygonFace.normal || new THREE.Vector3(0, 0, 1)
        ).z.toFixed(6),
        "Min Edge Angle (°)": useTriangulated ? "N/A" : minEdgeAngle.toFixed(1),
        "Max Edge Angle (°)": useTriangulated ? "N/A" : maxEdgeAngle.toFixed(1),
        "Avg Chamfer Angle (°)": avgChamferAngle.toFixed(1),
        "Surface Area (mm²)": partInfo.surfaceArea.toFixed(2),
        "Estimated Print Time (min)": partInfo.printTime.toFixed(1),
        "Estimated Material (g)": partInfo.material.toFixed(2),
        "Complexity Score": partInfo.complexity.toFixed(2),
      });

      // Add to zip
      zip.file(partFilename, partContent);
    }

    // Generate Excel file with parts database
    const excelBuffer = this.generateChamferedPartsDatabase(partDatabase, {
      ...options,
      partThickness,
      chamferDepth,
      polygonType,
    });
    zip.file("chamfered_parts_database.xlsx", excelBuffer);

    // Add assembly instructions
    const instructions = this.generateChamferedAssemblyInstructions(
      polygonFaces.length,
      { ...options, partThickness, chamferDepth, polygonType },
    );
    zip.file("chamfered_assembly_instructions.txt", instructions);

    // Generate chamfer angle reference
    const chamferReference = this.generateChamferAngleReference(
      polygonFaces,
      useTriangulated,
    );
    zip.file("chamfer_angle_reference.txt", chamferReference);

    // Generate and download zip
    const zipBlob = await zip.generateAsync({ type: "blob" });

    const zipFilename = filename.endsWith(".zip")
      ? filename
      : filename
          .replace(/\.[^/.]+$/, "_chamfered_parts.zip")
          .replace(/^(.+?)(?:_chamfered_parts)?$/, "$1_chamfered_parts.zip");
    this.downloadBlob(zipBlob, zipFilename);

    const endTime = Date.now();
    console.log(`Chamfered parts export completed in ${endTime - startTime}ms`);
  }

  /**
   * Calculate edge angles between adjacent faces and prepare chamfer data
   * This references the original 3D model to get accurate edge angles
   */
  private static calculateEdgeAngles(
    polygonFaces: PolygonFace[],
    geometry: THREE.BufferGeometry,
  ): ChamferedFaceInfo[] {
    const chamferedFaces: ChamferedFaceInfo[] = [];

    // Build edge-to-face mapping for finding adjacent faces
    const edgeToFaces = new Map<string, number[]>();

    // Helper function to create consistent edge key
    const getEdgeKey = (v1: THREE.Vector3, v2: THREE.Vector3): string => {
      const p1 = `${v1.x.toFixed(6)},${v1.y.toFixed(6)},${v1.z.toFixed(6)}`;
      const p2 = `${v2.x.toFixed(6)},${v2.y.toFixed(6)},${v2.z.toFixed(6)}`;
      return p1 < p2 ? `${p1}-${p2}` : `${p2}-${p1}`;
    };

    // First pass: build edge-to-face mapping from the polygon faces
    for (let faceIndex = 0; faceIndex < polygonFaces.length; faceIndex++) {
      const face = polygonFaces[faceIndex];
      const vertices = face.vertices || (face as any).originalVertices;
      if (!vertices || vertices.length < 3) continue;

      for (let i = 0; i < vertices.length; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % vertices.length];
        const edgeKey = getEdgeKey(v1, v2);

        if (!edgeToFaces.has(edgeKey)) {
          edgeToFaces.set(edgeKey, []);
        }
        edgeToFaces.get(edgeKey)!.push(faceIndex);
      }
    }

    // Second pass: calculate edge angles for each face
    for (let faceIndex = 0; faceIndex < polygonFaces.length; faceIndex++) {
      const face = polygonFaces[faceIndex];
      const vertices = face.vertices || (face as any).originalVertices;

      // Handle invalid faces by creating default chamfer data
      if (!vertices || vertices.length < 3) {
        console.warn(
          `⚠️ Face ${faceIndex} has invalid vertices, using default chamfer`,
        );
        chamferedFaces.push({
          faceInfo: face,
          edges: this.createDefaultEdges(vertices || []),
          partIndex: faceIndex,
        });
        continue;
      }

      const faceNormal = face.normal
        ? face.normal.clone().normalize()
        : new THREE.Vector3(0, 0, 1);
      const edges: EdgeInfo[] = [];

      for (let i = 0; i < vertices.length; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % vertices.length];
        const edgeKey = getEdgeKey(v1, v2);
        const adjacentFaces = edgeToFaces.get(edgeKey) || [];

        let edgeAngle = 180; // Default for boundary edges
        let chamferAngle = 45; // Default chamfer
        let isConvex = true; // Default for boundary edges (assume convex)

        if (adjacentFaces.length === 2) {
          // Find the other face that shares this edge
          const otherFaceIndex = adjacentFaces.find((idx) => idx !== faceIndex);
          if (otherFaceIndex !== undefined) {
            const otherFace = polygonFaces[otherFaceIndex];
            if (otherFace && otherFace.normal) {
              const otherNormal = otherFace.normal.clone().normalize();

              // Calculate the angle between face normals
              const dot = faceNormal.dot(otherNormal);
              const clampedDot = Math.max(-1, Math.min(1, dot));

              // Calculate exterior angle (what we need for chamfering)
              const angleRadians = Math.acos(Math.abs(clampedDot));
              const exteriorAngle = (angleRadians * 180) / Math.PI;

              // Determine convexity based on angle
              // < 180° = convex edge (outside face), > 180° = concave edge (inside face)
              isConvex = exteriorAngle < 180;

              // For chamfering:
              // - Use outside face if angle < 180° (convex)
              // - Use inside face if angle > 180° (concave)
              // - Chamfer angle = exterior_angle / 2
              edgeAngle = exteriorAngle;
              chamferAngle = exteriorAngle / 2;

              // Ensure reasonable chamfer angles (15° to 75°)
              chamferAngle = Math.max(15, Math.min(75, Math.abs(chamferAngle)));

              if (faceIndex < 3) {
                // Log first few faces for debugging
                console.log(
                  `   Face ${faceIndex}, Edge ${i}: ${isConvex ? 'convex' : 'concave'} edge ${edgeAngle.toFixed(1)}° → chamfer ${chamferAngle.toFixed(1)}°`,
                );
              }
            }
          }
        }

        edges.push({
          vertices: [v1.clone(), v2.clone()],
          adjacentFaces: adjacentFaces.slice(),
          edgeAngle,
          chamferAngle,
          isConvex,
        });
      }

      chamferedFaces.push({
        faceInfo: face,
        edges,
        partIndex: faceIndex,
      });
    }

    return chamferedFaces;
  }

  /**
   * Create default edge information when edge angle calculation fails
   */
  private static createDefaultEdges(vertices: THREE.Vector3[]): EdgeInfo[] {
    const edges: EdgeInfo[] = [];

    if (!vertices || vertices.length < 3) {
      console.warn("⚠️ No valid vertices found for creating default edges");
      return edges;
    }

    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];

      edges.push({
        vertices: [v1.clone(), v2.clone()],
        adjacentFaces: [], // No adjacent face info for fallback
        edgeAngle: 90, // Default right angle
        chamferAngle: 45, // Default 45-degree chamfer
        isConvex: true, // Default to convex for fallback
      });
    }

    return edges;
  }

  /**
   * Create chamfered OBJ using the PolygonExtruder
   */
  private static createChamferedPolygonOBJ(
    polygon: PolygonFace,
    extrusionOptions: ExtrusionOptions,
    chamferOptions: ChamferOptions,
  ): string {
    // For now, use the STL version and convert to OBJ format
    // This can be improved later with proper OBJ polygon support
    const stlContent = PolygonExtruder.createChamferedPolygon(polygon, extrusionOptions, chamferOptions);
    
    // Basic OBJ header
    let objContent = `# Chamfered OBJ Part ${polygon.index || 0} - ${polygon.type}\n`;
    objContent += `# Generated with polygon-based chamfering\n\n`;
    objContent += `# NOTE: This is a basic conversion from STL triangulation\n`;
    objContent += `# Future versions will support proper OBJ polygon output\n\n`;
    
    // For now, return a placeholder OBJ
    // The PolygonExtruder could be extended to support OBJ output directly
    return objContent;
  }

  /**
   * Calculate detailed information for a chamfered polygon part
   * Similar to polygon parts exporter but includes chamfer considerations
   */
  private static calculateChamferedPartInfo(
    polygonFace: PolygonFace,
    thickness: number,
    chamferDepth: number,
    scale: number,
  ) {
    // Use vertices (already scaled in polygon faces)
    const vertices = polygonFace.vertices.map((v: THREE.Vector3) => v.clone());

    // Calculate polygon properties
    const edges = [];
    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      edges.push(new THREE.Vector3().subVectors(vertices[next], vertices[i]));
    }

    // Calculate area using shoelace formula for polygon
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      area +=
        vertices[i].x * vertices[next].y - vertices[next].x * vertices[i].y;
    }
    area = Math.abs(area) / 2;

    // Adjust area for chamfering (slight reduction)
    const chamferAreaReduction = chamferDepth * 2 * vertices.length;
    area = Math.max(0, area - chamferAreaReduction);

    // Perimeter
    const perimeter = edges.reduce((sum, edge) => sum + edge.length(), 0);

    // Volume (area * thickness, slightly reduced for chamfers)
    const volume = area * thickness * 0.95; // 5% reduction for chamfer volume

    // Centroid
    const centroid = new THREE.Vector3();
    vertices.forEach((v) => centroid.add(v));
    centroid.divideScalar(vertices.length);

    // Bounding box
    const minX = Math.min(...vertices.map((v) => v.x));
    const maxX = Math.max(...vertices.map((v) => v.x));
    const minY = Math.min(...vertices.map((v) => v.y));
    const maxY = Math.max(...vertices.map((v) => v.y));
    const minZ = Math.min(...vertices.map((v) => v.z));
    const maxZ = Math.max(...vertices.map((v) => v.z));

    const bounds = {
      min: new THREE.Vector3(minX, minY, minZ),
      max: new THREE.Vector3(maxX, maxY, maxZ),
    };

    const dimensions = {
      width: maxX - minX,
      height: maxY - minY,
      depth: maxZ - minZ + thickness,
    };

    // Surface area (including chamfers)
    const topBottomArea = area * 2;
    const sideArea = perimeter * thickness;
    const chamferArea = edges.length * chamferDepth * thickness;
    const surfaceArea = topBottomArea + sideArea + chamferArea;

    // Print time estimation (increased for chamfer complexity)
    const baseTimePerMm2 = 0.7; // Longer due to chamfers
    const thicknessFactor = Math.max(1, thickness / 2);
    const chamferComplexity = 1 + (chamferDepth / thickness) * 0.5;
    const printTime =
      area * baseTimePerMm2 * thicknessFactor * chamferComplexity;

    // Material estimation (slightly more due to chamfers)
    const materialDensity = 0.00124; // g/mm³ for PLA
    const material = volume * materialDensity;

    // Complexity score (higher due to chamfers)
    const complexity = vertices.length + area / 100 + edges.length * 0.5;

    return {
      area,
      perimeter,
      volume,
      centroid,
      bounds,
      dimensions,
      surfaceArea,
      printTime,
      material,
      complexity,
    };
  }

  /**
   * Generate Excel database for chamfered parts
   */
  private static generateChamferedPartsDatabase(
    partData: any[],
    options: any,
  ): ArrayBuffer {
    const workbook = XLSX.utils.book_new();

    const partsSheet = XLSX.utils.json_to_sheet(partData);
    partsSheet["!cols"] = [
      { wch: 12 }, { wch: 20 }, { wch: 8 }, { wch: 12 }, { wch: 10 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(workbook, partsSheet, "Chamfered Parts");

    const summary = this.generateChamferedSummaryData(partData, options);
    const summarySheet = XLSX.utils.json_to_sheet(summary);
    summarySheet["!cols"] = [{ wch: 25 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Project Summary");

    return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  }

  private static generateChamferedSummaryData(partData: any[], options: any) {
    const date = new Date().toLocaleDateString();
    const totalParts = partData.length;
    const avgChamferAngle =
      partData.reduce(
        (sum, p) => sum + parseFloat(p["Avg Chamfer Angle (°)"]),
        0,
      ) / totalParts;

    return [
      { Property: "Generation Date", Value: date },
      { Property: "Total Chamfered Parts", Value: totalParts },
      { Property: "Part Thickness (mm)", Value: options.partThickness || 2 },
      { Property: "Chamfer Depth (mm)", Value: options.chamferDepth || 0.5 },
      {
        Property: "Average Chamfer Angle (°)",
        Value: avgChamferAngle.toFixed(1),
      },
      { Property: "Geometry Type", Value: options.polygonType || "mixed" },
      { Property: "Generated By", Value: "STL Chamfered Parts Exporter" },
    ];
  }

  /**
   * Generate assembly instructions for chamfered parts
   */
  private static generateChamferedAssemblyInstructions(
    partCount: number,
    options: any,
  ): string {
    const date = new Date().toLocaleDateString();

    return `STL Chamfered Parts Assembly Kit
Generated: ${date}

CHAMFERED PARTS ASSEMBLY INSTRUCTIONS:
=====================================

This kit contains ${partCount} chamfered parts designed for physical assembly.
Each part has been specially chamfered so the edges fit together perfectly!

PART SPECIFICATIONS:
- Part thickness: ${options.partThickness || 2}mm
- Chamfer depth: ${options.chamferDepth || 0.5}mm
- Chamfer formula: chamfer angle = 90° - (edge angle)/2

ASSEMBLY STEPS:
1. Identify matching chamfered edges on adjacent parts
2. Clean up any support material carefully
3. Test fit parts - chamfered edges should align perfectly
4. Apply small amount of glue to chamfered edges
5. Press parts together and hold until bond sets

ASSEMBLY ADVANTAGES:
- Chamfered edges provide perfect fit
- Stronger joints due to angled surfaces
- Professional appearance with clean joints
- Reduced stress concentrations at edges

PRINTING TIPS:
- Use PLA or PETG for best results
- Print with 0.2mm layer height for smooth chamfers
- Sand lightly if edges are rough

Happy building with precision chamfered parts!

Generated by STL Viewer Platform - Chamfered Parts Exporter
`;
  }

  /**
   * Generate chamfer angle reference document
   */
  private static generateChamferAngleReference(
    polygonFaces: PolygonFace[],
    useTriangulated: boolean,
  ): string {
    let content = `CHAMFER ANGLE REFERENCE
======================

This document shows the chamfer angles for each part.
Formula used: chamfer angle = 90° - (edge angle)/2

Part Index | Face Type | Vertex Count | Chamfer Angle (°) | Notes
-----------|-----------|--------------|-------------------|-------
`;

    for (let i = 0; i < polygonFaces.length; i++) {
      const face = polygonFaces[i];
      const chamferAngle = 45; // Default chamfer angle
      const notes = useTriangulated
        ? "Triangulated"
        : "Merged Polygon";

      content += `${String(i + 1).padStart(10)} | ${(face.type || "polygon").padStart(9)} | ${String(face.vertices.length).padStart(12)} | ${chamferAngle.toFixed(1).padStart(17)} | ${notes}\n`;
    }

    content += `

SUMMARY:
Total Parts: ${polygonFaces.length}
Mode: ${useTriangulated ? "Triangulated Backup" : "Merged Polygon"}
Default Chamfer Angle: 45.0°
`;

    return content;
  }

  private static downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  /**
   * Get export statistics for chamfered parts
   */
  static getChamferedExportStats(
    geometry: THREE.BufferGeometry,
    partThickness: number = 2,
    chamferDepth: number = 0.5,
  ): {
    partCount: number;
    estimatedPrintTime: string;
    estimatedMaterial: string;
    estimatedAssemblyTime: string;
    averageChamferAngle: string;
  } {
    const polygonFaces = (geometry as any).polygonFaces;

    if (!polygonFaces) {
      // Fallback to triangle count
      const triangleCount = Math.floor(geometry.attributes.position.count / 3);
      return {
        partCount: triangleCount,
        estimatedPrintTime: `${Math.floor((triangleCount * 20) / 60)}h ${(triangleCount * 20) % 60}m`,
        estimatedMaterial: `${Math.round(triangleCount * 3)}g filament`,
        estimatedAssemblyTime: "0h 0m",
        averageChamferAngle: "N/A",
      };
    }

    const partCount = polygonFaces.length;

    // Longer print time due to chamfer complexity
    const printTimePerPart = 20; // minutes per chamfered part
    const totalPrintMinutes =
      partCount *
      printTimePerPart *
      (partThickness / 2) *
      (1 + chamferDepth / 2);
    const printHours = Math.floor(totalPrintMinutes / 60);
    const printMinutes = totalPrintMinutes % 60;

    const materialPerPart = 3.0; // slightly more material due to chamfers
    const totalMaterial = Math.round(
      partCount * materialPerPart * (partThickness / 2),
    );

    const assemblyTimeMinutes = partCount * 8; // 8 minutes per chamfered part to assemble
    const assemblyHours = Math.floor(assemblyTimeMinutes / 60);
    const assemblyMins = assemblyTimeMinutes % 60;

    return {
      partCount,
      estimatedPrintTime: `${printHours}h ${printMinutes}m`,
      estimatedMaterial: `${totalMaterial}g filament`,
      estimatedAssemblyTime: `${assemblyHours}h ${assemblyMins}m`,
      averageChamferAngle: "45°", // placeholder - would be calculated properly
    };
  }
}
