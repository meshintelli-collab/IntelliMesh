import * as THREE from "three";
import { GeometryCleanup, CleanupResults } from "../utilities/geometryCleanup";
import { OBJConverter, OBJConversionResult } from "../processing/objConverter";
import { PolygonFaceReconstructor } from "../processing/polygonFaceReconstructor";
import { STLGeometryValidator } from "../utilities/stlGeometryValidator";
import { computeFlatNormals } from "../visualization/flatNormals";

export interface ProcessedModel {
  geometry: THREE.BufferGeometry;
  originalFormat: "stl" | "obj";
  fileName: string;
  objString: string; // Always maintained for internal processing
  stlBuffer?: ArrayBuffer; // Optional, for STL format support
  cleanupResults: CleanupResults;
  validationResults: any;
  processingTime: number;
}

export class ModelFileHandler {
  /**
   * Main entry point for file processing according to specifications:
   * 1. Accept STL or OBJ
   * 2. Mandatory geometry cleanup
   * 3. Convert STL to OBJ for internal processing
   * 4. Maintain both formats
   */
  static async processFile(file: File): Promise<ProcessedModel> {
    const startTime = Date.now();

    // Validate file format
    const fileName = file.name.toLowerCase();
    const isSTL = fileName.endsWith(".stl");
    const isOBJ = fileName.endsWith(".obj");

    if (!isSTL && !isOBJ) {
      throw new Error(
        "Unsupported file format. Please upload STL or OBJ files only.",
      );
    }

    if (file.size > 50 * 1024 * 1024) {
      throw new Error("File too large. Maximum size: 50MB");
    }

    let geometry: THREE.BufferGeometry;
    let originalFormat: "stl" | "obj";

    if (isSTL) {
      geometry = await this.loadSTLFile(file);
      originalFormat = "stl";
    } else {
      geometry = await this.loadOBJFile(file);
      originalFormat = "obj";
    }

    // MANDATORY: Geometry cleanup routine (as per specifications)
    const cleanupResults = GeometryCleanup.cleanGeometry(geometry);

    // Center and scale the geometry
    this.normalizeGeometry(geometry);

    // Different polygon handling for STL vs OBJ files
    if (originalFormat === "stl") {
      const reconstructedFaces =
        PolygonFaceReconstructor.reconstructPolygonFaces(geometry);
      if (reconstructedFaces.length > 0) {
        PolygonFaceReconstructor.applyReconstructedFaces(
          geometry,
          reconstructedFaces,
        );

      }
    } else {
      // OBJ files should already have polygon structure preserved
      const polygonFaces = (geometry as any).polygonFaces;
      if (polygonFaces && polygonFaces.length > 0) {

      } else {
      }
    }

    // Convert to OBJ format for internal processing (always maintain OBJ)
    const objConversion = OBJConverter.geometryToOBJ(geometry);

    // Validate OBJ conversion was successful
    if (!objConversion.success) {
      throw new Error(
        `Failed to convert geometry to OBJ: ${objConversion.error}`,
      );
    }


    // Validate geometry
    const validationResults = STLGeometryValidator.validateGeometry(geometry);

    const processingTime = Date.now() - startTime;

    const result: ProcessedModel = {
      geometry,
      originalFormat,
      fileName: file.name,
      objString: objConversion.objString,
      cleanupResults,
      validationResults,
      processingTime,
    };

    // Store STL buffer if original was STL (for export purposes)
    if (originalFormat === "stl") {
      result.stlBuffer = await file.arrayBuffer();
    }

    console.log(`🎉 File processing completed in ${processingTime}ms`);
    console.log(GeometryCleanup.generateCleanupSummary(cleanupResults));

    return result;
  }

  /**
   * Load STL file using Three.js STLLoader
   */
  private static async loadSTLFile(file: File): Promise<THREE.BufferGeometry> {

    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader");
    const loader = new STLLoader();

    const arrayBuffer = await file.arrayBuffer();
    const geometry = loader.parse(arrayBuffer);

    if (
      !geometry.attributes.position ||
      geometry.attributes.position.count === 0
    ) {
      throw new Error("STL file contains no valid geometry data");
    }


    return geometry;
  }

  /**
   * Load OBJ file using enhanced OBJConverter for proper polygon preservation
   * ENHANCED: Ensures consistent indexing and polygon structure preservation
   */
  private static async loadOBJFile(file: File): Promise<THREE.BufferGeometry> {


    const text = await file.text();

    // Use enhanced OBJConverter instead of Three.js OBJLoader for better control
    try {
      const geometry = OBJConverter.parseOBJ(text);

      // Validate the parsed geometry
      if (
        !geometry ||
        !geometry.attributes.position ||
        geometry.attributes.position.count === 0
      ) {
        throw new Error("OBJ file contains no valid geometry data");
      }

      // CRITICAL: Ensure geometry is properly indexed for decimation
      if (!geometry.index) {
        const indexedGeometry = this.ensureIndexedGeometry(geometry);

        // Preserve any polygon metadata
        if ((geometry as any).polygonFaces) {
          (indexedGeometry as any).polygonFaces = (
            geometry as any
          ).polygonFaces;
        }
        if ((geometry as any).polygonType) {
          (indexedGeometry as any).polygonType = (geometry as any).polygonType;
        }

        return indexedGeometry;
      }

      const vertexCount = geometry.attributes.position.count;
      const faceCount = geometry.index ? geometry.index.count / 3 : 0;
      const polygonFaces = (geometry as any).polygonFaces;


      return geometry;
    } catch (parseError) {
      console.error(
        "❌ Enhanced OBJ parsing failed, falling back to Three.js OBJLoader:",
        parseError,
      );

      // Fallback to Three.js OBJLoader
      const { OBJLoader } = await import(
        "three/examples/jsm/loaders/OBJLoader"
      );
      const loader = new OBJLoader();
      const object = loader.parse(text);

      let geometry: THREE.BufferGeometry | null = null;

      object.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry) {
          if (!geometry) {
            geometry = child.geometry.clone();
          } else {
            console.warn("⚠️ Multiple meshes found - using first mesh only");
          }
        }
      });

      if (
        !geometry ||
        !geometry.attributes.position ||
        geometry.attributes.position.count === 0
      ) {
        throw new Error("OBJ file contains no valid geometry data");
      }

      // Ensure fallback geometry is also indexed
      if (!geometry.index) {
        geometry = this.ensureIndexedGeometry(geometry);
      }

      return geometry;
    }
  }

  /**
   * Ensure geometry has proper indexing for decimation compatibility
   */
  private static ensureIndexedGeometry(
    geometry: THREE.BufferGeometry,
  ): THREE.BufferGeometry {

    const positions = geometry.attributes.position.array as Float32Array;
    const vertexMap = new Map<string, number>();
    const newPositions: number[] = [];
    const indices: number[] = [];

    // Merge duplicate vertices
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;

      let index = vertexMap.get(key);
      if (index === undefined) {
        index = newPositions.length / 3;
        vertexMap.set(key, index);
        newPositions.push(x, y, z);
      }

      indices.push(index);
    }

    const indexedGeometry = new THREE.BufferGeometry();
    indexedGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(newPositions, 3),
    );
    indexedGeometry.setIndex(indices);

    // Copy other attributes if they exist
    if (geometry.attributes.normal) {
      indexedGeometry.setAttribute("normal", geometry.attributes.normal);
    } else {
      computeFlatNormals(indexedGeometry);
    }

    if (geometry.attributes.uv) {
      indexedGeometry.setAttribute("uv", geometry.attributes.uv);
    }


    return indexedGeometry;
  }

  /**
   * Normalize geometry (center and scale)
   */
  private static normalizeGeometry(geometry: THREE.BufferGeometry): void {
    geometry.computeBoundingBox();

    if (!geometry.boundingBox) {
      throw new Error("Unable to compute geometry bounds");
    }

    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);

    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);

    if (maxDimension === 0) {
      throw new Error("Geometry has zero dimensions");
    }

    const scale = 50 / maxDimension; // Scale to fit in a 50-unit cube
    geometry.scale(scale, scale, scale);

    computeFlatNormals(geometry);
  }

  /**
   * Export model in specified format
   */
  static exportModel(
    model: ProcessedModel,
    format: "stl" | "obj",
    filename?: string,
  ): { data: string | ArrayBuffer; filename: string; mimeType: string } {
    const baseName = filename || model.fileName.replace(/\.(stl|obj)$/i, "");

    if (format === "obj") {
      const objData = OBJConverter.geometryToOBJ(model.geometry);
      return {
        data: objData.objString,
        filename: `${baseName}_Processed.obj`,
        mimeType: "text/plain",
      };
    } else {
      // Export as STL
      const exporter = new THREE.STLExporter();
      const stlString = exporter.parse(model.geometry);
      return {
        data: stlString,
        filename: `${baseName}_Processed.stl`,
        mimeType: "application/octet-stream",
      };
    }
  }

  /**
   * Export parts list with proper naming
   */
  static exportParts(
    model: ProcessedModel,
    format: "stl" | "obj",
    parts: any[],
  ): { data: string; filename: string; mimeType: string } {
    const baseName = model.fileName.replace(/\.(stl|obj)$/i, "");

    if (format === "obj") {
      const objData = OBJConverter.geometryToOBJWithParts(
        model.geometry,
        parts,
      );
      return {
        data: objData,
        filename: `${baseName}_PartsList.obj`,
        mimeType: "text/plain",
      };
    } else {
      // For STL parts, we need individual files (would need ZIP)
      // For now, return combined STL
      const exporter = new THREE.STLExporter();
      const stlString = exporter.parse(model.geometry);
      return {
        data: stlString,
        filename: `${baseName}_PartsList.stl`,
        mimeType: "application/octet-stream",
      };
    }
  }
}
