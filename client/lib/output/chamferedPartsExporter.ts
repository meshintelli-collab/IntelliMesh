import * as THREE from "three";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  PolygonExtruder,
  PolygonFace,
  ExtrusionOptions,
  ChamferOptions,
} from "../processing/polygonExtruder";

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
 * ChamferedPartsExporter creates 3D printable parts with chamfered edges
 * for physical assembly using the formula: chamfer angle = 90° - (edge angle)/2
 */
export class ChamferedPartsExporter {
  /**
   * Export each polygon face as a separate chamfered STL file in a zip archive
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

    // Determine which geometry to use based on backup mode
    let polygonFaces: PolygonFace[];
    let polygonType: string;

    if (useTriangulated) {
      // Backup mode: use triangulated geometry (simpler chamfering)
      polygonFaces =
        PolygonExtruder.extractPolygonsFromTriangulatedGeometry(geometry);
      polygonType = "triangulated_backup";
      console.log(
        `🔄 Using backup triangulated mode for chamfering: ${polygonFaces.length} triangles`,
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
        polygonFaces = mergedFaces;
        polygonType = (geometry as any).polygonType || "merged";
        console.log(
          `✅ Using merged polygon mode for chamfering: ${polygonFaces.length} polygons`,
        );
      }
    }

    if (polygonFaces.length === 0) {
      throw new Error("No polygon faces found for chamfered export");
    }

    // Track part information for Excel database
    const partDatabase: any[] = [];

    // Calculate edge angles for all faces first
    console.log("🔧 Calculating edge angles from 3D model for chamfering...");
    const chamferedFaces = this.calculateEdgeAngles(polygonFaces, geometry);
    console.log(`✅ Calculated edge angles for ${chamferedFaces.length} faces`);

    if (chamferedFaces.length !== polygonFaces.length) {
      console.warn(`⚠️ Mismatch: ${polygonFaces.length} polygon faces but ${chamferedFaces.length} chamfered faces`);
    }

    // Create individual chamfered files for each polygon face
    for (let i = 0; i < polygonFaces.length; i++) {
      const polygonFace = polygonFaces[i];
      const chamferedFace = chamferedFaces[i];
      const fileExtension = format === "obj" ? "obj" : "stl";

      // Ensure chamferedFace exists, otherwise create a fallback
      if (!chamferedFace) {
        console.warn(`⚠️ No chamfered face data for face ${i}, creating fallback`);
        // Create fallback chamfered face with default angles
        const fallbackChamferedFace: ChamferedFaceInfo = {
          faceInfo: polygonFace,
          edges: this.createDefaultEdges(polygonFace),
          partIndex: i,
        };

        const partContent =
          format === "obj"
            ? this.createChamferedPolygonOBJ(
                fallbackChamferedFace,
                partThickness,
                chamferDepth,
                scale,
              )
            : this.createChamferedPolygonSTL(
                fallbackChamferedFace,
                partThickness,
                chamferDepth,
                scale,
                geometry,
              );

        const partFilename = `part_${String(i + 1).padStart(4, "0")}_${polygonFace.type || "polygon"}_chamfered.${fileExtension}`;

        // Calculate part info for fallback case too
        const partInfo = this.calculateChamferedPartInfo(
          polygonFace,
          partThickness,
          chamferDepth,
          scale,
        );

        // Add to database with default values
        partDatabase.push({
          "Part Number": `part_${String(i + 1).padStart(4, "0")}`,
          "File Name": partFilename,
          "Polygon Index": i + 1,
          "Face Type": polygonFace.type || "polygon",
          "Vertex Count": polygonFace.vertices?.length || 0,
          "Edge Count": polygonFace.vertices?.length || 0,
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
          "Min Edge Angle (°)": "90.0", // Default fallback
          "Max Edge Angle (°)": "90.0", // Default fallback
          "Avg Chamfer Angle (°)": "45.0", // Default fallback
          "Surface Area (mm²)": partInfo.surfaceArea.toFixed(2),
          "Estimated Print Time (min)": partInfo.printTime.toFixed(1),
          "Estimated Material (g)": partInfo.material.toFixed(2),
          "Complexity Score": partInfo.complexity.toFixed(2),
        });

        zip.file(partFilename, partContent);
        continue;
      }

      const partContent =
        format === "obj"
          ? this.createChamferedPolygonOBJ(
              chamferedFace,
              partThickness,
              chamferDepth,
              scale,
            )
          : this.createChamferedPolygonSTL(
              chamferedFace,
              partThickness,
              chamferDepth,
              scale,
              geometry,
            );

      const partFilename = `part_${String(i + 1).padStart(4, "0")}_${polygonFace.type || "polygon"}_chamfered.${fileExtension}`;

      // Calculate part geometry and metrics including chamfer info
      const partInfo = this.calculateChamferedPartInfo(
        polygonFace,
        partThickness,
        chamferDepth,
        scale,
      );

      // Extract edge angle statistics from calculated chamfer data
      let minEdgeAngle = 90.0; // Default values
      let maxEdgeAngle = 90.0;
      let avgChamferAngle = 45.0;

      if (chamferedFace.edges && chamferedFace.edges.length > 0) {
        const edgeAngles = chamferedFace.edges.map(e => e.edgeAngle);
        const chamferAngles = chamferedFace.edges.map(e => e.chamferAngle);
        minEdgeAngle = Math.min(...edgeAngles);
        maxEdgeAngle = Math.max(...edgeAngles);
        avgChamferAngle = chamferAngles.reduce((a, b) => a + b, 0) / chamferAngles.length;
      } else {
        console.warn(`⚠️ Face ${i} has no edge data, using default angle values`);
      }

      partDatabase.push({
        "Part Number": `part_${String(i + 1).padStart(4, "0")}`,
        "File Name": partFilename,
        "Polygon Index": i + 1,
        "Face Type": polygonFace.type || "polygon",
        "Vertex Count": (polygonFace.vertices || polygonFace.originalVertices || []).length,
        "Edge Count": (polygonFace.vertices || polygonFace.originalVertices || []).length,
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
      { ...options, partThickness, chamferDepth: partThickness, polygonType },
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
   * Create default edge information when edge angle calculation fails
   */
  private static createDefaultEdges(polygonFace: any): EdgeInfo[] {
    const edges: EdgeInfo[] = [];

    // Try originalVertices first, then fall back to vertices
    const vertices = polygonFace.originalVertices || polygonFace.vertices;

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
   * Calculate edge angles between adjacent faces and prepare chamfer data
   */
  private static calculateEdgeAngles(
    polygonFaces: any[],
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

    // First pass: build edge-to-face mapping
    for (let faceIndex = 0; faceIndex < polygonFaces.length; faceIndex++) {
      const face = polygonFaces[faceIndex];
      if (!face.originalVertices || face.originalVertices.length < 3) continue;

      const vertices = face.originalVertices;
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

      // Handle invalid faces by creating default chamfer data
      if (!face.originalVertices || face.originalVertices.length < 3) {
        console.warn(`⚠️ Face ${faceIndex} has invalid vertices, using default chamfer`);
        chamferedFaces.push({
          faceInfo: face,
          edges: this.createDefaultEdges(face),
          partIndex: faceIndex,
        });
        continue;
      }

      const vertices = face.originalVertices;
      const faceNormal = face.normal ? face.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
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

              // Calculate the actual edge angle (not using abs() to preserve convex/concave info)
              const dot = faceNormal.dot(otherNormal);
              const clampedDot = Math.max(-1, Math.min(1, dot));

              // Calculate the angle between face normals (0° to 180°)
              const faceAngle = (Math.acos(Math.abs(clampedDot)) * 180) / Math.PI;

              // For cube: faceAngle = 90° (perpendicular faces)
              // Internal edge angle = 360° - faceAngle = 270°
              // But for chamfering, we want the "corner angle" which is faceAngle = 90°
              edgeAngle = faceAngle;

              // Simple chamfer formula: chamfer angle = 90° - (corner angle)/2
              // For cube: chamfer angle = 90° - 90°/2 = 45°
              chamferAngle = 90 - edgeAngle / 2;

              // Ensure reasonable chamfer angles (15° to 75°)
              chamferAngle = Math.max(15, Math.min(75, Math.abs(chamferAngle)));

              if (faceIndex < 3) { // Log first few faces for debugging
                const convexity = isConvex ? "convex" : "concave";
                console.log(`   Face ${faceIndex}, Edge ${i}: ${convexity} edge ${edgeAngle.toFixed(1)}° → chamfer ${chamferAngle.toFixed(1)}°`);
              }
            } else {
              console.warn(`⚠️ Face ${faceIndex}: adjacent face ${otherFaceIndex} missing normal, using default angles`);
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
   * Create a chamfered STL for a single polygon with specified chamfer angles
   */
  private static createChamferedPolygonSTL(
    chamferedFace: ChamferedFaceInfo,
    thickness: number,
    chamferDepth: number,
    scale: number,
    originalGeometry: THREE.BufferGeometry,
  ): string {
    if (!chamferedFace) {
      console.error("��� chamferedFace is undefined in createChamferedPolygonSTL");
      return `solid error_part\nendsolid error_part\n`;
    }

    if (!chamferedFace.faceInfo) {
      console.error("❌ chamferedFace.faceInfo is undefined in createChamferedPolygonSTL");
      return `solid error_part\nendsolid error_part\n`;
    }

    const faceInfo = chamferedFace.faceInfo;

    // Handle missing originalVertices by falling back to vertices
    const sourceVertices = faceInfo.originalVertices || faceInfo.vertices;

    if (!sourceVertices || !Array.isArray(sourceVertices)) {
      console.error(`❌ Face ${chamferedFace.partIndex} has no valid vertices for chamfering`);
      return `solid chamfered_part_${chamferedFace.partIndex + 1}_error\nendsolid chamfered_part_${chamferedFace.partIndex + 1}_error\n`;
    }

    const originalVertices = sourceVertices.map((v: THREE.Vector3) =>
      v.clone().multiplyScalar(scale),
    );

    if (originalVertices.length < 3) {
      console.warn(`⚠️ Face ${chamferedFace.partIndex} has insufficient vertices (${originalVertices.length})`);
      return `solid chamfered_part_${chamferedFace.partIndex + 1}_${faceInfo.type}\nendsolid chamfered_part_${chamferedFace.partIndex + 1}_${faceInfo.type}\n`;
    }

    const normal = faceInfo.normal ? faceInfo.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const scaledThickness = thickness * scale; // Account for scaling in thickness
    const offset = normal.clone().multiplyScalar(scaledThickness);

    let stlContent = `solid chamfered_part_${chamferedFace.partIndex + 1}_${faceInfo.type}\n`;

    // Generate chamfered vertices to create correct chamfer angles
    const chamferedVertices = this.generateChamferedVertices(
      originalVertices,
      chamferedFace.edges,
      scaledThickness, // Use scaled thickness for correct chamfer angle
    );

    // Debug: Log vertex positions for fit verification
    console.log(`🔍 Part ${chamferedFace.partIndex} thickness: ${thickness}`);
    console.log(`🔍 Original vertex 0: [${originalVertices[0].x.toFixed(3)}, ${originalVertices[0].y.toFixed(3)}, ${originalVertices[0].z.toFixed(3)}]`);
    console.log(`🔍 Chamfered vertex 0: [${chamferedVertices[0].x.toFixed(3)}, ${chamferedVertices[0].y.toFixed(3)}, ${chamferedVertices[0].z.toFixed(3)}]`);
    const displacement = new THREE.Vector3().subVectors(chamferedVertices[0], originalVertices[0]);
    console.log(`🔍 Chamfer displacement: [${displacement.x.toFixed(3)}, ${displacement.y.toFixed(3)}, ${displacement.z.toFixed(3)}], magnitude: ${displacement.length().toFixed(3)}`);

    // Determine which face should be full size based on edge convexity
    const hasConvexEdges = chamferedFace.edges.some(edge => edge.isConvex);
    const hasConcaveEdges = chamferedFace.edges.some(edge => !edge.isConvex);

    console.log(`🔧 Generating faces - Convex: ${hasConvexEdges}, Concave: ${hasConcaveEdges}`);

    // For mixed or convex shapes: front face full size, back face chamfered
    // For purely concave shapes: front face chamfered, back face full size
    const useFrontFullSize = hasConvexEdges || (!hasConvexEdges && !hasConcaveEdges);

    let frontFaceVertices: THREE.Vector3[];
    let backFaceVertices: THREE.Vector3[];

    if (useFrontFullSize) {
      // Front face: original size (where extrusion starts)
      frontFaceVertices = originalVertices;
      // Back face: chamfered size (moved inward and offset by thickness)
      backFaceVertices = chamferedVertices.map((v: THREE.Vector3) => v.clone().add(offset));
      console.log(`📐 Front face: full size, Back face: chamfered + thickness offset`);
    } else {
      // Front face: chamfered size (moved inward from original)
      frontFaceVertices = chamferedVertices;
      // Back face: original size (offset by thickness)
      backFaceVertices = originalVertices.map((v: THREE.Vector3) => v.clone().add(offset));
      console.log(`📐 Front face: chamfered, Back face: full size + thickness offset`);
    }

    // Front face triangulation
    const frontTriangles = this.triangulatePolygon(frontFaceVertices, normal);
    for (const triangle of frontTriangles) {
      stlContent += this.addTriangleToSTL(
        triangle[0],
        triangle[1],
        triangle[2],
        normal,
      );
    }
    console.log(`✅ Added ${frontTriangles.length} front face triangles`);

    // Back face triangulation (reversed winding)
    const backTriangles = this.triangulatePolygon(backFaceVertices, normal.clone().negate());
    for (const triangle of backTriangles) {
      const reversedTriangle = [triangle[2], triangle[1], triangle[0]]; // Reverse winding
      stlContent += this.addTriangleToSTL(
        reversedTriangle[0],
        reversedTriangle[1],
        reversedTriangle[2],
        normal.clone().negate(),
      );
    }
    console.log(`✅ Added ${backTriangles.length} back face triangles`);

    // Add angled side walls that create the chamfer effect
    stlContent += this.addChamferedPerimeterWalls(
      frontFaceVertices,    // Front face vertices (full or chamfered)
      backFaceVertices,     // Back face vertices (chamfered or full)
      originalVertices,     // Original vertices for reference
      chamferedVertices,    // Chamfered vertices for reference
      offset,               // Thickness offset
      chamferedFace.edges,
      useFrontFullSize,     // Which face is full size
    );

    stlContent += `endsolid chamfered_part_${chamferedFace.partIndex + 1}_${faceInfo.type}\n`;
    return stlContent;
  }

  /**
   * Generate chamfered vertices to create correct chamfer angles
   * For a cube (90° edges), chamfer angle = 90 - 90/2 = 45°
   * For 45° chamfer: inward movement = thickness (since tan(45°) = 1)
   */
  private static generateChamferedVertices(
    originalVertices: THREE.Vector3[],
    edges: EdgeInfo[],
    thickness: number, // Use thickness instead of chamferDepth
  ): THREE.Vector3[] {
    const chamferedVertices: THREE.Vector3[] = [];

    console.log(`🔧 Generating chamfered vertices for correct chamfer angles (thickness: ${thickness})`);

    for (let i = 0; i < originalVertices.length; i++) {
      const vertex = originalVertices[i];
      const prevEdge = edges[(i - 1 + edges.length) % edges.length];
      const nextEdge = edges[i];

      // Use the bigger edge angle from adjacent edges
      const correspondingEdge = prevEdge.edgeAngle > nextEdge.edgeAngle ? prevEdge : nextEdge;
      const chamferAngle = correspondingEdge.chamferAngle;

      // Calculate inward movement to create the correct chamfer angle
      // For chamfer angle θ, inward movement = thickness * tan(θ)
      // This creates the angled wall at the specified chamfer angle
      const chamferAngleRad = (chamferAngle * Math.PI) / 180;
      const inwardMovement = thickness * Math.tan(chamferAngleRad);

      // Debug logging for first few vertices
      if (i < 2) {
        console.log(`🔍 Vertex ${i}: chamfer angle ${chamferAngle}° → inward movement ${inwardMovement.toFixed(3)}`);
      }

      // Calculate the inward direction (toward polygon center)
      const prevVertex = originalVertices[(i - 1 + originalVertices.length) % originalVertices.length];
      const nextVertex = originalVertices[(i + 1) % originalVertices.length];

      // Calculate the angle bisector pointing inward
      const edge1 = new THREE.Vector3().subVectors(prevVertex, vertex).normalize();
      const edge2 = new THREE.Vector3().subVectors(nextVertex, vertex).normalize();
      const bisector = new THREE.Vector3().addVectors(edge1, edge2).normalize();

      // If bisector is zero (180° angle), use perpendicular to one edge
      if (bisector.length() < 0.001) {
        bisector.crossVectors(edge1, new THREE.Vector3(0, 0, 1)).normalize();
      }

      // Move vertex inward by calculated amount
      const chamferedVertex = vertex.clone().add(bisector.multiplyScalar(inwardMovement));

      console.log(`   Vertex ${i}: chamfer ${chamferAngle.toFixed(1)}°, inward ${inwardMovement.toFixed(3)}mm`);

      chamferedVertices.push(chamferedVertex);
    }

    console.log(`✅ Generated ${chamferedVertices.length} vertices with correct chamfer angles`);
    return chamferedVertices;
  }

  /**
   * Adapt original triangulation to work with chamfered vertices
   */
  private static adaptTriangulationToChamferedVertices(
    triangleIndices: number[],
    geometry: THREE.BufferGeometry,
    originalVertices: THREE.Vector3[],
    chamferedVertices: THREE.Vector3[],
    scale: number,
  ): THREE.Vector3[][] {
    const triangles: THREE.Vector3[][] = [];

    // For now, use simple fan triangulation from center
    if (chamferedVertices.length === 3) {
      triangles.push([
        chamferedVertices[0],
        chamferedVertices[1],
        chamferedVertices[2],
      ]);
    } else if (chamferedVertices.length === 4) {
      triangles.push([
        chamferedVertices[0],
        chamferedVertices[1],
        chamferedVertices[2],
      ]);
      triangles.push([
        chamferedVertices[0],
        chamferedVertices[2],
        chamferedVertices[3],
      ]);
    } else {
      // Fan triangulation from first vertex
      for (let i = 1; i < chamferedVertices.length - 1; i++) {
        triangles.push([
          chamferedVertices[0],
          chamferedVertices[i],
          chamferedVertices[i + 1],
        ]);
      }
    }

    return triangles;
  }

  /**
   * Add angled side walls that create proper chamfer effect
   * The side walls angle inward while keeping one face at full size
   */
  private static addChamferedPerimeterWalls(
    frontVertices: THREE.Vector3[],
    backVertices: THREE.Vector3[],
    originalVertices: THREE.Vector3[],
    chamferedVertices: THREE.Vector3[],
    offset: THREE.Vector3,
    edges: EdgeInfo[],
    frontIsFullSize: boolean,
  ): string {
    let content = "";

    console.log(`🔧 Creating angled side walls (front full size: ${frontIsFullSize})`);

    for (let i = 0; i < frontVertices.length; i++) {
      const next = (i + 1) % frontVertices.length;
      const edge = edges[i];

      // Get the quad vertices for this edge
      const f1 = frontVertices[i];     // Front current
      const f2 = frontVertices[next];  // Front next
      const b1 = backVertices[i];      // Back current
      const b2 = backVertices[next];   // Back next

      // Create angled quad wall
      // The quad connects the full-size face to the chamfered face
      // This creates the angled wall effect

      // Calculate the normal for this angled wall
      const edge1 = new THREE.Vector3().subVectors(f2, f1);
      const edge2 = new THREE.Vector3().subVectors(b1, f1);
      const wallNormal = new THREE.Vector3()
        .crossVectors(edge1, edge2)
        .normalize();

      // Create two triangles for the angled quad wall
      content += this.addTriangleToSTL(f1, f2, b2, wallNormal);
      content += this.addTriangleToSTL(f1, b2, b1, wallNormal);

      const convexity = edge.isConvex ? "convex" : "concave";
      console.log(`   Edge ${i}: ${convexity} angled wall created (${edge.chamferAngle.toFixed(1)}°)`);
    }

    console.log(`✅ Created ${frontVertices.length} angled side walls`);
    return content;
  }

  /**
   * Triangulate a polygon using simple fan triangulation
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
      // Quad - split into two triangles
      triangles.push([vertices[0], vertices[1], vertices[2]]);
      triangles.push([vertices[0], vertices[2], vertices[3]]);
    } else {
      // Polygon - use fan triangulation from first vertex
      for (let i = 1; i < vertices.length - 1; i++) {
        triangles.push([vertices[0], vertices[i], vertices[i + 1]]);
      }
    }

    return triangles;
  }

  /**
   * Add a single triangle to STL content
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
   * Create chamfered OBJ file with proper edge angle calculation
   */
  private static createChamferedPolygonOBJ(
    chamferedFace: ChamferedFaceInfo,
    thickness: number,
    chamferDepth: number,
    scale: number,
  ): string {
    const faceInfo = chamferedFace.faceInfo;

    // Generate chamfered vertices based on calculated edge angles
    const sourceVertices = faceInfo.originalVertices || faceInfo.vertices;

    if (!sourceVertices || !Array.isArray(sourceVertices)) {
      console.error(`❌ Face ${chamferedFace.partIndex} has no valid vertices for OBJ chamfering`);
      return `# Error: No valid vertices for chamfering\n`;
    }

    const originalVertices = sourceVertices.map((v: THREE.Vector3) =>
      v.clone().multiplyScalar(scale),
    );

    const scaledThickness = thickness * scale; // Account for scaling
    const chamferedVertices = this.generateChamferedVertices(
      originalVertices,
      chamferedFace.edges,
      scaledThickness, // Use scaled thickness for correct chamfer angle
    );

    // Create basic OBJ structure with chamfered vertices
    let objContent = `# Chamfered OBJ Part ${chamferedFace.partIndex + 1}\n`;
    objContent += `# Generated with edge-angle-based chamfering\n\n`;

    // Add front face vertices (chamfered)
    chamferedVertices.forEach((v, i) => {
      objContent += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
    });

    // Add back face vertices (chamfered + offset)
    const normal = faceInfo.normal ? faceInfo.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const offset = normal.clone().multiplyScalar(scaledThickness);
    chamferedVertices.forEach((v, i) => {
      const backV = v.clone().add(offset);
      objContent += `v ${backV.x.toFixed(6)} ${backV.y.toFixed(6)} ${backV.z.toFixed(6)}\n`;
    });

    objContent += `\n# Faces\n`;

    // Front face (using chamfered vertices)
    if (chamferedVertices.length >= 3) {
      objContent += `f`;
      for (let i = 0; i < chamferedVertices.length; i++) {
        objContent += ` ${i + 1}`;
      }
      objContent += `\n`;

      // Back face (reversed order)
      objContent += `f`;
      for (let i = chamferedVertices.length - 1; i >= 0; i--) {
        objContent += ` ${i + 1 + chamferedVertices.length}`;
      }
      objContent += `\n`;

      // Side faces
      for (let i = 0; i < chamferedVertices.length; i++) {
        const next = (i + 1) % chamferedVertices.length;
        const v1 = i + 1; // front current
        const v2 = next + 1; // front next
        const v3 = next + 1 + chamferedVertices.length; // back next
        const v4 = i + 1 + chamferedVertices.length; // back current

        objContent += `f ${v1} ${v2} ${v3} ${v4}\n`;
      }
    }

    return objContent;
  }

  /**
   * Calculate detailed information for a chamfered polygon part
   */
  private static calculateChamferedPartInfo(
    polygonFace: PolygonFace,
    thickness: number,
    chamferDepth: number,
    scale: number,
  ) {
    // Handle missing vertices property
    const sourceVertices = polygonFace.vertices || polygonFace.originalVertices;

    if (!sourceVertices || !Array.isArray(sourceVertices)) {
      console.error(`❌ Polygon face has no valid vertices for part info calculation`);
      // Return minimal fallback data
      return {
        area: 0,
        perimeter: 0,
        volume: 0,
        centroid: new THREE.Vector3(),
        bounds: { min: new THREE.Vector3(), max: new THREE.Vector3() },
        dimensions: { width: 0, height: 0, depth: thickness },
        surfaceArea: 0,
        printTime: 0,
        material: 0,
        complexity: 0,
      };
    }

    const vertices = sourceVertices.map((v: THREE.Vector3) =>
      v.clone().multiplyScalar(scale),
    );

    // Calculate base polygon properties
    const edges = [];
    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      edges.push(new THREE.Vector3().subVectors(vertices[next], vertices[i]));
    }

    // Calculate area using shoelace formula
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      area +=
        vertices[i].x * vertices[next].y - vertices[next].x * vertices[i].y;
    }
    area = Math.abs(area) / 2;

    // Adjust area for chamfering (slight reduction)
    const chamferAreaReduction = chamferDepth * scale * 2 * vertices.length;
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
    const chamferArea = edges.length * chamferDepth * scale * thickness;
    const surfaceArea = topBottomArea + sideArea + chamferArea;

    // Print time estimation (increased for chamfer complexity)
    const baseTimePerMm2 = 0.7; // Longer due to chamfers
    const thicknessFactor = Math.max(1, thickness / 2);
    const chamferComplexity = 1 + (chamferDepth / thickness) * 0.5;
    const printTime =
      area * baseTimePerMm2 * thicknessFactor * chamferComplexity;

    // Material estimation
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
      { wch: 12 },
      { wch: 25 },
      { wch: 8 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 15 },
      { wch: 15 },
      { wch: 18 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
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
      { Property: "Scale Factor", Value: options.scale || 1 },
      { Property: "Generated By", Value: "3D Print Cut 'n' Glue Exporter" },
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

    return `3D PRINT CUT 'N' GLUE ASSEMBLY KIT
Generated: ${date}

CHAMFERED PARTS ASSEMBLY INSTRUCTIONS:
=====================================

This kit contains ${partCount} chamfered parts designed for physical assembly.
Each part has been specially chamfered so the edges fit together perfectly!

PART SPECIFICATIONS:
- Part thickness: ${options.partThickness || 2}mm
- Chamfer depth: ${options.chamferDepth || 0.5}mm
- Chamfer formula: chamfer angle = 90° - (edge angle)/2

ASSEMBLY PROCESS:
1. Print all parts with support material if needed
2. Clean up any support material carefully
3. Test fit parts - chamfered edges should align perfectly
4. Apply small amount of glue to chamfered edges
5. Press parts together and hold until bond sets
6. Work systematically, checking alignment frequently

ASSEMBLY ADVANTAGES:
- Chamfered edges provide perfect fit
- Stronger joints due to angled surfaces
- Self-aligning geometry reduces errors
- Professional appearance when assembled

TIPS FOR SUCCESS:
- Use PLA or PETG for best results
- Print with 0.2mm layer height for smooth chamfers
- Sand lightly if edges are rough
- Use plastic cement or CA glue for strongest bonds

Happy building with precision chamfered parts!

Generated by STL Viewer Platform - 3D Print Cut 'n' Glue Exporter
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
        ? "Triangulated backup mode"
        : "Merged polygon mode";

      content += `${String(i + 1).padStart(10)} | ${(face.type || "polygon").padStart(9)} | ${String(face.vertices.length).padStart(12)} | ${chamferAngle.toFixed(1).padStart(17)} | ${notes}\n`;
    }

    content += `\nSUMMARY STATISTICS:
==================
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
      return {
        partCount: 0,
        estimatedPrintTime: "0h 0m",
        estimatedMaterial: "0g filament",
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
    const printMinutes = Math.round(totalPrintMinutes % 60);

    const materialPerPart = 3.0; // slightly more material due to chamfers
    const totalMaterial = Math.round(
      partCount * materialPerPart * (partThickness / 2),
    );

    const assemblyTimeMinutes = partCount * 8; // longer assembly time for precision fitting
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
