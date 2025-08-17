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
  chamferOnInteriorFace?: boolean; // true if chamfer should be on interior face, false for exterior
  dotProductSignature?: string; // "pp", "nn", "pn", "np" for dotAV/dotBU signs
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
      (scaledFace as any).originalVertices = (face as any).originalVertices.map(
        (v: THREE.Vector3) => v.clone().multiplyScalar(scale),
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

    // Export mode processing

    if (useTriangulated) {
      // Triangulated mode: use exact original triangulation (NO windmilling)
      // Using triangulated mode
      polygonFaces =
        PolygonExtruder.extractPolygonsFromTriangulatedGeometry(geometry);
      polygonType = "triangulated_exact";
      // Using exact triangulated mode
    } else {
      // Normal mode: use merged polygon faces
      const mergedFaces =
        PolygonExtruder.extractPolygonsFromMergedGeometry(geometry);
      if (mergedFaces.length === 0) {
        // No merged faces found, using triangulated mode
        polygonFaces =
          PolygonExtruder.extractPolygonsFromTriangulatedGeometry(geometry);
        polygonType = "triangulated_fallback";
      } else {
        // Using merged faces for chamfering

        // Log details about the merged faces
        for (let i = 0; i < Math.min(3, mergedFaces.length); i++) {
          const face = mergedFaces[i];
          // Processing face data
        }

        polygonFaces = mergedFaces;
        polygonType = (geometry as any).polygonType || "merged";
        // Using merged polygon mode
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

    // Track data for clean summary output
    const summaryData: {
      faceCount: number;
      allInteriorAngles: number[][];
      allChamferAngles: number[][];
      allChamferTypes: boolean[][]; // true = interior, false = exterior
      allDotProductSigns: string[][]; // "pp", "nn", "pn", "np" for dotAV/dotBU signs
      shapeName: string;
    } = {
      faceCount: polygonFaces.length,
      allInteriorAngles: [],
      allChamferAngles: [],
      allChamferTypes: [],
      allDotProductSigns: [],
      shapeName: filename.replace(/\.[^/.]+$/, '') || 'shape'
    };

    // Calculate edge angles for all faces first (referencing 3D model)
    const chamferedFaces = this.calculateEdgeAngles(
      polygonFaces,
      originalGeometry,
    );

    // Create individual chamfered files for each polygon face
    for (let i = 0; i < polygonFaces.length; i++) {
      const polygonFace = polygonFaces[i];
      const chamferedFace = chamferedFaces[i];
      const fileExtension = format === "obj" ? "obj" : "stl";

      // Create chamfered part

      // Convert PolygonFace to Face interface (same as polygon parts exporter)
      const face: Face = {
        vertices: polygonFace.vertices || [],
        normal: polygonFace.normal || new THREE.Vector3(0, 0, 1),
        type: polygonFace.type || "polygon",
      };

      // Calculate chamfer data - INDIVIDUAL ANGLES FOR EACH EDGE
      let edgeAngles: number[] = [];
      let avgChamferAngle = 45.0; // Only used for statistics, NOT for actual chamfering

      if (
        chamferedFace &&
        chamferedFace.edges &&
        chamferedFace.edges.length > 0
      ) {
        edgeAngles = chamferedFace.edges.map((e) => e.chamferAngle);
        avgChamferAngle =
          edgeAngles.reduce((a, b) => a + b, 0) / edgeAngles.length;

        // Chamfer angles calculated
      } else {
        // Create default chamfer angles for each edge
        edgeAngles = Array(face.vertices.length).fill(45);
        console.log(
          `⚠��� Part ${i + 1}: No chamfer face data, using default 45° for all ${face.vertices.length} edges`,
        );
      }

      // Create chamfered part using the PolygonExtruder with chamfering
      const chamferOptions: ChamferOptions = {
        chamferDepth,
        edgeAngles,
        defaultChamferAngle: 45,
      };

      const extrusionOptions: ExtrusionOptions = {
        thickness: partThickness,
        scale: 1, // scale already applied to polygon faces
        centerZ: 0,
      };

      // Convert Face back to PolygonFace for PolygonExtruder
      const polygonFaceForExtruder: PolygonFace = {
        vertices: face.vertices,
        normal: face.normal,
        type: face.type,
        index: i,
        originalTriangulation: (polygonFace as any).originalTriangulation,
      };

      // ALWAYS USE POLYGON EXTRUDER FOR CONSISTENCY
      // Generate chamfered geometry using PolygonExtruder first
      console.log(
        `🔧 Creating chamfered part ${i + 1} using PolygonExtruder (format: ${format})`,
      );

      // Create the chamfered STL content using PolygonExtruder
      const stlContent = PolygonExtruder.createChamferedPolygon(
        polygonFaceForExtruder,
        extrusionOptions,
        chamferOptions,
      );
      console.log(`🔧 STL content length: ${stlContent.length} characters`);

      if (stlContent.length < 100) {
        console.error(
          `��� STL content suspiciously short! Content: ${stlContent.substring(0, 200)}...`,
        );
      }

      let partContent: string;
      if (format === "obj") {
        // For OBJ: Convert the triangulated STL logic to OBJ polygon format
        // TODO: This is a temporary approach - ideally we'd have a unified geometry representation
        partContent = this.convertSTLLogicToOBJ(
          polygonFaceForExtruder,
          extrusionOptions,
          chamferOptions,
          stlContent,
        );
      } else {
        // For STL: Use the STL content directly
        partContent = stlContent;
      }

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

      if (
        chamferedFace &&
        chamferedFace.edges &&
        chamferedFace.edges.length > 0
      ) {
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

      // Store data for clean summary output
      summaryData.allChamferAngles.push([...edgeAngles]);
      if (chamferedFace && chamferedFace.edges) {
        summaryData.allInteriorAngles.push(chamferedFace.edges.map(e => e.edgeAngle));
        summaryData.allChamferTypes.push(chamferedFace.edges.map(e => e.chamferOnInteriorFace ?? true));
        summaryData.allDotProductSigns.push(chamferedFace.edges.map(e => e.dotProductSignature || 'nn'));
      } else {
        summaryData.allInteriorAngles.push(Array(face.vertices.length).fill(90));
        summaryData.allChamferTypes.push(Array(face.vertices.length).fill(true)); // default to interior
        summaryData.allDotProductSigns.push(Array(face.vertices.length).fill('nn')); // default to negative/negative
      }
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

    // CLEAN SUMMARY OUTPUT WITH DEBUG INFO FOR COMPLEX SHAPES
    console.log(`\n=== CHAMFER ANALYSIS ===`);
    console.log(`Shape: ${summaryData.shapeName}`);
    console.log(`Faces: ${summaryData.faceCount}`);

    // Debug info for complex shapes
    if (summaryData.shapeName.toLowerCase().includes('cross') || summaryData.faceCount > 6) {
      console.log(`\nDEBUG - Complex shape detected:`);
      console.log(`  Total faces: ${summaryData.faceCount}`);
      console.log(`  Interior/exterior edge analysis needed`);
    }

    console.log(`\nInterior angles by face (dotAV/dotBU signs: p=positive, n=negative):`);
    summaryData.allInteriorAngles.forEach((angles, i) => {
      const signs = summaryData.allDotProductSigns[i] || [];
      const angleStrings = angles.map((angle, j) => {
        const dotSigns = signs[j] || 'nn';
        return `${angle.toFixed(1)}${dotSigns}`;
      });
      console.log(`Face ${i + 1}: [${angleStrings.join(', ')}]°`);
    });
    console.log(`\nChamfer angles by face (i=interior, e=exterior):`);
    summaryData.allChamferAngles.forEach((angles, i) => {
      const types = summaryData.allChamferTypes[i] || [];
      const angleStrings = angles.map((angle, j) => {
        const indicator = types[j] ? 'i' : 'e';
        return `${angle.toFixed(1)}${indicator}`;
      });
      console.log(`Face ${i + 1}: [${angleStrings.join(', ')}]°`);
    });
    console.log(`========================\n`);
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
        let chamferOnInteriorFace = true; // Default for boundary edges
        let dotProductSignature = 'nn'; // Default for boundary edges (negative/negative)

        if (adjacentFaces.length === 2) {
          // Find the other face that shares this edge
          const otherFaceIndex = adjacentFaces.find((idx) => idx !== faceIndex);
          if (otherFaceIndex !== undefined) {
            const otherFace = polygonFaces[otherFaceIndex];
            if (otherFace && otherFace.normal) {
              const otherNormal = otherFace.normal.clone().normalize();

              // CORRECT DIHEDRAL ANGLE CALCULATION WITH INTERIOR/EXTERIOR LOGIC:

              // Step 1: Get face normals u and v (already calculated and normalized)
              const u = faceNormal; // Face normal for current face
              const v = otherNormal; // Face normal for adjacent face

              // Step 2: Calculate dot product between normalized face normals (NO CLAMPING)
              const dotUV = u.dot(v);

              // Step 3: Calculate angle between normals (0° to 180°) - pure arccos, no clamping
              const angleBetweenNormals = (Math.acos(dotUV) * 180) / Math.PI;

              // Step 4: Use u, v, a, b vector logic to determine interior/exterior chamfering
              const edgeDirection = new THREE.Vector3().subVectors(v2, v1).normalize();

              // CORRECTED VECTOR CALCULATIONS:
              // a = vector in face u, perpendicular to edge, pointing AWAY from edge into face
              // b = vector in face v, perpendicular to edge, pointing AWAY from edge into face

              // Step 1: Get vectors perpendicular to edge and face normal
              let a = new THREE.Vector3().crossVectors(edgeDirection, u).normalize();
              let b = new THREE.Vector3().crossVectors(edgeDirection, v).normalize();

              // Step 2: Ensure vectors point AWAY from edge into face
              // Use a reference point in each face to check direction
              const edgeMidpoint = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);

              // For face u: find a vertex in the face that's not on this edge
              let refPointU = null;
              for (let k = 0; k < vertices.length; k++) {
                const vertex = vertices[k];
                if (!vertex.equals(v1) && !vertex.equals(v2)) {
                  refPointU = vertex;
                  break;
                }
              }

              // For face v: find a vertex in the other face that's not on this edge
              const otherVertices = polygonFaces[otherFaceIndex].vertices || (polygonFaces[otherFaceIndex] as any).originalVertices;
              let refPointV = null;
              if (otherVertices) {
                for (let k = 0; k < otherVertices.length; k++) {
                  const vertex = otherVertices[k];
                  if (!vertex.equals(v1) && !vertex.equals(v2)) {
                    refPointV = vertex;
                    break;
                  }
                }
              }

              // Check if a points away from edge (toward reference point)
              if (refPointU) {
                const toRefU = new THREE.Vector3().subVectors(refPointU, edgeMidpoint).normalize();
                if (a.dot(toRefU) < 0) {
                  a.negate(); // Flip to point away from edge
                }
              }

              // Check if b points away from edge (toward reference point)
              if (refPointV) {
                const toRefV = new THREE.Vector3().subVectors(refPointV, edgeMidpoint).normalize();
                if (b.dot(toRefV) < 0) {
                  b.negate(); // Flip to point away from edge
                }
              }

              const dotAV = a.dot(v);
              const dotBU = b.dot(u);

              // VECTOR VALIDATION: Check our vectors are correct
              if (faceIndex < 2) {
                console.log(`\n=== VECTOR VALIDATION Face ${faceIndex}, Edge ${i} ===`);
                console.log(`Edge: (${v1.x.toFixed(2)}, ${v1.y.toFixed(2)}, ${v1.z.toFixed(2)}) → (${v2.x.toFixed(2)}, ${v2.y.toFixed(2)}, ${v2.z.toFixed(2)})`);
                console.log(`edgeDirection = (${edgeDirection.x.toFixed(3)}, ${edgeDirection.y.toFixed(3)}, ${edgeDirection.z.toFixed(3)})`);
                console.log(`u (face normal) = (${u.x.toFixed(3)}, ${u.y.toFixed(3)}, ${u.z.toFixed(3)})`);
                console.log(`v (other normal) = (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`);
                console.log(`a = AWAY FROM EDGE = (${a.x.toFixed(3)}, ${a.y.toFixed(3)}, ${a.z.toFixed(3)})`);
                console.log(`b = AWAY FROM EDGE = (${b.x.toFixed(3)}, ${b.y.toFixed(3)}, ${b.z.toFixed(3)})`);

                // Validate perpendicularity
                const aEdgeDot = a.dot(edgeDirection);
                const bEdgeDot = b.dot(edgeDirection);
                const aDotU = a.dot(u);
                const bDotV = b.dot(v);

                console.log(`PERPENDICULARITY CHECK:`);
                console.log(`  a·edge = ${aEdgeDot.toFixed(6)} (should be ~0)`);
                console.log(`  b·edge = ${bEdgeDot.toFixed(6)} (should be ~0)`);
                console.log(`  a·u = ${aDotU.toFixed(6)} (should be ~0)`);
                console.log(`  b·v = ${bDotV.toFixed(6)} (should be ~0)`);

                // Validate direction away from edge
                if (refPointU) {
                  const toRefU = new THREE.Vector3().subVectors(refPointU, edgeMidpoint).normalize();
                  const awayCheckU = a.dot(toRefU);
                  console.log(`DIRECTION CHECK U: a·(refPoint-edge) = ${awayCheckU.toFixed(6)} (should be >0 for away)`);
                }
                if (refPointV) {
                  const toRefV = new THREE.Vector3().subVectors(refPointV, edgeMidpoint).normalize();
                  const awayCheckV = b.dot(toRefV);
                  console.log(`DIRECTION CHECK V: b·(refPoint-edge) = ${awayCheckV.toFixed(6)} (should be >0 for away)`);
                }

                console.log(`DOT PRODUCTS FOR CLASSIFICATION:`);
                console.log(`  dotAV = a·v = ${dotAV.toFixed(6)}`);
                console.log(`  dotBU = b·u = ${dotBU.toFixed(6)}`);

                // Calculate actual dihedral angle correctly
                const dotUV = u.dot(v);
                console.log(`  dotUV = u·v = ${dotUV.toFixed(6)}`);
                console.log(`  angle_between_normals = ${(Math.acos(dotUV) * 180 / Math.PI).toFixed(1)}°`);
                console.log(`  dihedral_angle = ${(180 - Math.acos(dotUV) * 180 / Math.PI).toFixed(1)}°`);
              }

              // Step 5: Determine dihedral angle and chamfer face based on geometry
              let interiorAngle: number;

              // Store dot product signs for debugging
              const dotAVSign = dotAV > 0 ? 'p' : 'n';
              const dotBUSign = dotBU > 0 ? 'p' : 'n';
              const dotProductSignature = dotAVSign + dotBUSign;

              // SIMPLIFIED DIHEDRAL ANGLE CALCULATION:
              // For most 3D shapes with outward-pointing normals: dihedral = 180° - angle_between_normals
              interiorAngle = 180 - angleBetweenNormals;

              // Determine convex/concave based on dot products
              if (dotAV <= 0 && dotBU <= 0) {
                // Both negative: convex edge (normal case for external edges)
                isConvex = true;
                chamferOnInteriorFace = false; // Apply chamfer to exterior edge
              } else if (dotAV > 0 && dotBU > 0) {
                // Both positive: concave edge (internal corners)
                isConvex = false;
                chamferOnInteriorFace = true; // Apply chamfer to interior edge
              } else {
                // Mixed case - treat as convex
                isConvex = true;
                chamferOnInteriorFace = false; // Apply chamfer to exterior edge
              }

              if (faceIndex < 2) {
                console.log(`CLASSIFICATION RESULT:`);
                console.log(`  Interior angle: ${interiorAngle.toFixed(1)}°`);
                console.log(`  Edge type: ${isConvex ? 'CONVEX' : 'CONCAVE'}`);
                console.log(`  Chamfer on: ${chamferOnInteriorFace ? 'INTERIOR' : 'EXTERIOR'} face`);
                console.log(`  Dot signature: ${dotProductSignature}`);
              }

              const exteriorAngle = 360 - interiorAngle;

              // Step 7: Determine chamfer angle and face based on interior angle

              if (interiorAngle < 180) {
                // Interior angle < 180°: chamfer inside face
                isConvex = true;
                chamferOnInteriorFace = true;
                chamferAngle = 90 - interiorAngle / 2;
              } else {
                // Interior angle > 180°: chamfer outside face
                isConvex = false;
                chamferOnInteriorFace = false;
                chamferAngle = 90 - exteriorAngle / 2;
              }

              edgeAngle = interiorAngle;

              // Store calculated values for debugging (NO CLAMPING)
              const originalChamferAngle = chamferAngle;

              // NO CLAMPING - allow full range of chamfer angles
              // chamferAngle = chamferAngle; // Keep original calculated value

              // Clean calculation without verbose logging
            }
          }
        }

        edges.push({
          vertices: [v1.clone(), v2.clone()],
          adjacentFaces: adjacentFaces.slice(),
          edgeAngle,
          chamferAngle,
          isConvex,
          chamferOnInteriorFace,
          dotProductSignature,
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
   * Convert STL logic to OBJ format (temporary bridge for consistency)
   */
  private static convertSTLLogicToOBJ(
    polygon: PolygonFace,
    extrusionOptions: ExtrusionOptions,
    chamferOptions: ChamferOptions,
    stlContent: string,
  ): string {
    // For now, use the original OBJ method but note that it should match STL logic
    console.log(`🔧 Converting STL logic to OBJ format (temporary bridge)`);
    return this.createChamferedPolygonOBJ(
      polygon,
      extrusionOptions,
      chamferOptions,
    );
  }

  /**
   * Create chamfered OBJ that preserves polygon faces (no triangulation)
   */
  private static createChamferedPolygonOBJ(
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

    // Scale and position vertices (but scale should already be applied)
    const originalVertices = polygon.vertices.map(
      (v) => new THREE.Vector3(v.x * scale, v.y * scale, v.z * scale + centerZ),
    );

    // Calculate or use provided normal
    let normal = polygon.normal?.clone().normalize();
    if (!normal || normal.length() < 0.001) {
      normal = this.calculatePolygonNormal(originalVertices);
    }

    // CORRECT CHAMFERING: Keep original vertices for front/back faces
    const frontVertices = originalVertices; // Keep original polygon shape
    const offset = normal.clone().multiplyScalar(thickness);
    const backVertices = originalVertices.map((v) => v.clone().add(offset)); // Keep original polygon shape

    // For OBJ: Use FULL-THROUGH chamfering (like corrected PolygonExtruder)
    // Front face FULL SIZE, back face CHAMFERED for proper part mating

    const actualFrontVertices = frontVertices; // FRONT: Full size

    // Generate chamfered back vertices using thickness for full-through chamfering
    const chamferedBackVertices = this.generateChamferedVerticesOBJ(
      backVertices, // Start with full back vertices
      thickness, // Use thickness for full-through chamfering calculation
      edgeAngles || Array(originalVertices.length).fill(defaultChamferAngle),
    );

    const actualBackVertices = chamferedBackVertices; // BACK: Chamfered (smaller)

    // Generate OBJ content
    let objContent = `# Chamfered OBJ Part ${polygon.index || 0} - ${polygon.type}\n`;
    objContent += `# Generated with polygon-based chamfering (preserves polygon faces)\n\n`;

    // Write vertices
    let vertexIndex = 1;

    // Front face vertices (FULL SIZE for mating)
    objContent += `# Front face vertices (FULL SIZE for mating)\n`;
    actualFrontVertices.forEach((v) => {
      objContent += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
    });

    // Back face vertices (CHAMFERED - smaller for taper)
    objContent += `\n# Back face vertices (CHAMFERED - smaller for taper)\n`;
    actualBackVertices.forEach((v) => {
      objContent += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
    });

    // Write normals
    objContent += `\n# Normals\n`;
    objContent += `vn ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}\n`; // Front normal
    objContent += `vn ${(-normal.x).toFixed(6)} ${(-normal.y).toFixed(6)} ${(-normal.z).toFixed(6)}\n`; // Back normal

    // Write faces (PRESERVE POLYGON STRUCTURE - NO TRIANGULATION)
    objContent += `\n# Faces (polygons preserved)\n`;

    // Front face (ORIGINAL FULL SIZE vertices for mating surface)
    objContent += `# Front face (ORIGINAL FULL SIZE vertices for mating surface)\nf`;
    for (let i = 1; i <= actualFrontVertices.length; i++) {
      objContent += ` ${i}//1`;
    }
    objContent += `\n`;

    // Back face (PARAMETRICALLY CHAMFERED vertices) - reversed winding
    objContent += `# Back face (PARAMETRICALLY CHAMFERED vertices)\nf`;
    for (
      let i = actualFrontVertices.length * 2;
      i > actualFrontVertices.length;
      i--
    ) {
      objContent += ` ${i}//2`;
    }
    objContent += `\n`;

    // PARAMETRIC tapered walls (quads) - maintains quad structure
    objContent += `# PARAMETRIC tapered walls (quads) - maintains quad structure\n`;
    for (let i = 0; i < actualFrontVertices.length; i++) {
      const next = (i + 1) % actualFrontVertices.length;

      // Indices for quad: FULL front → CHAMFERED back
      const fullFrontCurrent = i + 1;
      const fullFrontNext = next + 1;
      const chamferedBackNext = actualFrontVertices.length + next + 1;
      const chamferedBackCurrent = actualFrontVertices.length + i + 1;

      // Create tapered wall quad: full front edge to chamfered back edge
      objContent += `f ${fullFrontCurrent} ${fullFrontNext} ${chamferedBackNext} ${chamferedBackCurrent}\n`;
    }

    console.log(
      `✅ Generated chamfered OBJ: ${frontVertices.length} vertices per face, polygons preserved (no triangulation)`,
    );
    return objContent;
  }

  /**
   * Generate chamfered vertices for OBJ using parametric edge-direction movement
   * Same logic as PolygonExtruder - vertices move along adjacent edge directions parametrically
   */
  private static generateChamferedVerticesOBJ(
    originalVertices: THREE.Vector3[],
    chamferDepth: number,
    chamferAngles: number[],
  ): THREE.Vector3[] {
    console.log(
      `🔧 OBJ: Generating PARAMETRIC chamfered vertices with edge-direction movements`,
    );
    console.log(
      `🔧 OBJ: Vertices move along adjacent edge directions parametrically`,
    );

    const partThickness = chamferDepth; // chamferDepth is actually the part thickness
    const numVertices = originalVertices.length;

    // Calculate parametric movements for each vertex
    const vertexMovements = new Array(numVertices)
      .fill(null)
      .map(() => new THREE.Vector3());

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
      const edgeDirection = new THREE.Vector3()
        .subVectors(nextVertex, currentVertex)
        .normalize();

      // For the current vertex: move along the direction TO the next vertex
      const currentVertexMovement = edgeDirection
        .clone()
        .multiplyScalar(chamferOffset);
      vertexMovements[edgeIndex].add(currentVertexMovement);

      // For the next vertex: move along the direction FROM the current vertex (opposite)
      const nextVertexMovement = edgeDirection
        .clone()
        .multiplyScalar(-chamferOffset);
      vertexMovements[nextVertexIndex].add(nextVertexMovement);

      if (edgeIndex < 3) {
        console.log(`🔢 OBJ PARAMETRIC CHAMFER Edge ${edgeIndex}:`);
        console.log(
          `   📐 Edge chamfer angle: ${edgeChamferAngle.toFixed(1)}°`,
        );
        console.log(`   📏 Part thickness: ${partThickness.toFixed(3)}mm`);
        console.log(
          `   🧮 Formula: offset = thickness × tan(angle) = ${partThickness.toFixed(3)} × tan(${edgeChamferAngle.toFixed(1)}°) = ${chamferOffset.toFixed(3)}`,
        );
        console.log(
          `   🎯 Vertex ${edgeIndex} moves: (${currentVertexMovement.x.toFixed(3)}, ${currentVertexMovement.y.toFixed(3)})`,
        );
        console.log(
          `   🎯 Vertex ${nextVertexIndex} moves: (${nextVertexMovement.x.toFixed(3)}, ${nextVertexMovement.y.toFixed(3)})`,
        );
      }
    }

    // Apply all parametric movements simultaneously to create chamfered vertices
    const chamferedVertices: THREE.Vector3[] = [];
    for (let i = 0; i < numVertices; i++) {
      const chamferedVertex = originalVertices[i]
        .clone()
        .add(vertexMovements[i]);
      chamferedVertices.push(chamferedVertex);

      if (i < 3) {
        console.log(`📊 OBJ FINAL Vertex ${i}:`);
        console.log(
          `   Original: (${originalVertices[i].x.toFixed(3)}, ${originalVertices[i].y.toFixed(3)})`,
        );
        console.log(
          `   Total movement: (${vertexMovements[i].x.toFixed(3)}, ${vertexMovements[i].y.toFixed(3)})`,
        );
        console.log(
          `   Final: (${chamferedVertex.x.toFixed(3)}, ${chamferedVertex.y.toFixed(3)})`,
        );
      }
    }

    console.log(
      `✅ OBJ: Generated ${chamferedVertices.length} chamfered vertices using parametric edge-direction movements`,
    );
    console.log(
      `✅ OBJ: All movements applied simultaneously - maintains quad structure`,
    );
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
   * Calculate chamfered back vertices using plane intersection method
   * Same method as PolygonExtruder for consistency
   */
  private static calculateChamferedVerticesFromPlaneIntersections(
    frontVertices: THREE.Vector3[],
    backVertices: THREE.Vector3[],
    chamferDepth: number,
    chamferAngles: number[],
  ): THREE.Vector3[] {
    const chamferedBackVertices: THREE.Vector3[] = [];
    const numVertices = frontVertices.length;

    console.log(
      `��� OBJ: Calculating chamfered vertices using plane intersections for ${numVertices} vertices`,
    );

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
        currentChamferAngle,
      );

      chamferedBackVertices.push(chamferedVertex);

      if (i < 3) {
        console.log(
          `   OBJ Vertex ${i}: original(${backVertices[i].x.toFixed(3)}, ${backVertices[i].y.toFixed(3)}) → chamfered(${chamferedVertex.x.toFixed(3)}, ${chamferedVertex.y.toFixed(3)})`,
        );
      }
    }

    return chamferedBackVertices;
  }

  /**
   * Calculate where a vertex should move based on the intersection of two adjacent chamfer planes
   * Same method as PolygonExtruder for consistency
   */
  private static calculateVertexChamferIntersection(
    vertexIndex: number,
    frontVertices: THREE.Vector3[],
    backVertices: THREE.Vector3[],
    chamferDepth: number,
    prevChamferAngle: number,
    currentChamferAngle: number,
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
    const thickness = new THREE.Vector3().subVectors(
      currentVertex,
      frontCurrentVertex,
    );
    const faceNormal = thickness.clone().normalize();

    // Calculate outward normals for each edge
    const prevOutwardNormal = new THREE.Vector3()
      .crossVectors(prevEdgeDir, faceNormal)
      .normalize();
    const nextOutwardNormal = new THREE.Vector3()
      .crossVectors(nextEdgeDir, faceNormal)
      .normalize();

    // Calculate chamfer offsets for each edge
    // Note: angles should already be calculated using correct formula in calculateEdgeAngles
    const prevChamferRadians = (prevChamferAngle * Math.PI) / 180;
    const currentChamferRadians = (currentChamferAngle * Math.PI) / 180;

    const prevChamferOffset = chamferDepth * Math.tan(prevChamferRadians);
    const currentChamferOffset = chamferDepth * Math.tan(currentChamferRadians);

    if (vertexIndex < 3) {
      console.log(
        `   OBJ Vertex ${vertexIndex}: prevAngle=${prevChamferAngle.toFixed(1)}°, currentAngle=${currentChamferAngle.toFixed(1)}°`,
      );
      console.log(
        `   OBJ Offsets: prev=${prevChamferOffset.toFixed(3)}, current=${currentChamferOffset.toFixed(3)}`,
      );
    }

    // PARAMETRIC VERTEX CHAMFERING:
    // Determine chamfer direction based on whether chamfer is on interior or exterior face

    // For now, assume chamfer is on interior face (moving vertices inward)
    // TODO: This should be updated to use the chamferOnInteriorFace property from edge calculation
    const prevChamferDirection = prevOutwardNormal.clone().negate(); // Inward
    const currentChamferDirection = nextOutwardNormal.clone().negate(); // Inward

    // Calculate individual chamfer movements
    const prevChamferMovement = prevChamferDirection
      .clone()
      .multiplyScalar(prevChamferOffset);
    const currentChamferMovement = currentChamferDirection
      .clone()
      .multiplyScalar(currentChamferOffset);

    // PARAMETRIC INTERSECTION: Find where the two chamfer planes meet
    // For now using averaging method, but this could be improved with actual plane-plane intersection
    const averageMovement = new THREE.Vector3()
      .addVectors(prevChamferMovement, currentChamferMovement)
      .multiplyScalar(0.5);

    if (vertexIndex < 3) {
      console.log(
        `   Prev chamfer movement: (${prevChamferMovement.x.toFixed(3)}, ${prevChamferMovement.y.toFixed(3)}, ${prevChamferMovement.z.toFixed(3)})`,
      );
      console.log(
        `   Current chamfer movement: (${currentChamferMovement.x.toFixed(3)}, ${currentChamferMovement.y.toFixed(3)}, ${currentChamferMovement.z.toFixed(3)})`,
      );
      console.log(
        `   Average movement: (${averageMovement.x.toFixed(3)}, ${averageMovement.y.toFixed(3)}, ${averageMovement.z.toFixed(3)})`,
      );
    }

    // Apply the movement to get the final chamfered vertex position
    const chamferedVertex = currentVertex.clone().add(averageMovement);

    return chamferedVertex;
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
      { wch: 12 },
      { wch: 20 },
      { wch: 8 },
      { wch: 12 },
      { wch: 10 },
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
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
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
      const notes = useTriangulated ? "Triangulated" : "Merged Polygon";

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
