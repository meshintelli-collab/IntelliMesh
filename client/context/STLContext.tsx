import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import * as THREE from "three";
import { analytics } from "../lib/utilities/analytics";
import {
  STLManipulator,
  STLToolMode,
  ToolOperationResult,
} from "../lib/processing/stlManipulator";
import { TriangleExporter } from "../lib/output/triangleExporter";
import { PolygonPartsExporter } from "../lib/output/polygonPartsExporter";
import { ChamferedPartsExporter } from "../lib/output/chamferedPartsExporter";
import { STLExporter } from "../lib/output/stlExporter";
import { OBJConverter } from "../lib/processing/objConverter";
import { PolygonGeometryBuilder } from "../lib/processing/polygonGeometryBuilder";
import { PolygonFaceReconstructor } from "../lib/processing/polygonFaceReconstructor";
import {
  STLGeometryValidator,
  ValidationReport,
} from "../lib/utilities/stlGeometryValidator";
import {
  ModelFileHandler,
  ProcessedModel,
} from "../lib/input/modelFileHandler";
import { ModelCache } from "../lib/input/modelCache";
import { getTestFileSizeData } from "../lib/utilities/fileSizeEstimator";
import { computeFlatNormals } from "../lib/visualization/flatNormals";
import { prepareGeometryForViewing } from "../lib/visualization/geometryPreparer";
import {
  validateAndFixGeometry,
  hasNaNValues,
  logGeometryStats,
} from "../lib/utilities/geometryValidator";

interface ViewerSettings {
  randomColors: boolean;
  wireframe: boolean;
  backgroundColor: string;
  autoSpin: boolean;
  highlightColor: string;
  enableHighlighting: boolean;
  meshType: "triangle" | "merged";
}

interface ErrorMessage {
  id: string;
  message: string;
  timestamp: number;
}

interface STLContextType {
  geometry: THREE.BufferGeometry | null;
  fileName: string | null;
  isLoading: boolean;
  loadingProgress: {
    percentage: number;
    stage: string;
    details: string;
  };
  error: string | null;
  errors: ErrorMessage[];
  viewerSettings: ViewerSettings;

  // Model data (dual format support)
  processedModel: any | null;
  originalFormat: "stl" | "obj" | null;
  objString: string | null;
  cleanupResults: any | null;

  // STL Tools
  toolMode: STLToolMode;
  isProcessingTool: boolean;

  // Highlighting
  highlightedTriangle: number | null;
  triangleStats: any;

  // Decimation Painter Mode
  decimationPainterMode: boolean;
  setDecimationPainterMode: (enabled: boolean) => void;
  isDecimating: boolean;
  decimateEdge: (
    vertexIndex1: number,
    vertexIndex2: number,
  ) => Promise<ToolOperationResult>;

  loadModelFromFile: (file: File) => Promise<void>;
  loadDefaultSTL: () => Promise<void>;
  loadSpecificModel: (modelName: string) => Promise<void>;
  availableModels: Array<{ name: string; description: string }>;
  updateViewerSettings: (settings: Partial<ViewerSettings>) => void;
  exportSTL: (customFilename?: string) => void;
  exportOBJ: (customFilename?: string) => void;
  exportParts: (options?: {
    format?: "stl" | "obj";
    partThickness?: number;
    scale?: number;
  }) => Promise<void>;
  exportChamferedParts: (options?: {
    format?: "stl" | "obj";
    partThickness?: number;
    chamferDepth?: number;
    scale?: number;
  }) => Promise<void>;
  clearError: () => void;
  clearErrorById: (id: string) => void;
  addError: (message: string) => void;

  // STL Tool Methods
  setToolMode: (mode: STLToolMode) => void;
  reducePoints: (
    reductionAmount: number,
    method:
      | "quadric_edge_collapse"
      | "vertex_clustering"
      | "adaptive"
      | "random",
  ) => Promise<ToolOperationResult>;
  getGeometryStats: () => any;
  getDetailedGeometryStats: () => any;
  getDualMeshStats: () => any;
  setHighlightedTriangle: (triangleIndex: number | null) => void;

  // Backup and restore functionality
  hasBackup: boolean;
  createBackup: () => void;
  restoreFromBackup: () => void;

  // Merged mesh functionality
  mergedGeometry: THREE.BufferGeometry | null;
  hasMergedMesh: boolean;
  mergeCoplanarFaces: () => Promise<ToolOperationResult>;
  clearMergedMesh: () => void;
}

const defaultViewerSettings: ViewerSettings = {
  randomColors: false,
  wireframe: false,
  backgroundColor: "#0a0a0a",
  autoSpin: false,
  highlightColor: "#ff0000",
  enableHighlighting: true,
  meshType: "merged",
};

const STLContext = createContext<STLContextType | undefined>(undefined);

export const useSTL = () => {
  const context = useContext(STLContext);
  if (!context) {
    console.error(
      "STL Context Error: Component tried to use STL context outside provider",
    );
    console.error(
      "This usually happens during hot reload or component tree changes",
    );
    console.error("Please refresh the page to fix this issue");
    console.error("Current context value:", context);
    console.error("STLContext:", STLContext);
    throw new Error("useSTL must be used within an STLProvider");
  }
  return context;
};

interface STLProviderProps {
  children: React.ReactNode;
}

// Mesh repair and validation helper
const repairGeometry = (
  geometry: THREE.BufferGeometry,
): THREE.BufferGeometry => {
  const positions = geometry.attributes.position.array as Float32Array;
  const validPositions: number[] = [];

  // Remove degenerate triangles and NaN values
  for (let i = 0; i < positions.length; i += 9) {
    const v1 = new THREE.Vector3(
      positions[i],
      positions[i + 1],
      positions[i + 2],
    );
    const v2 = new THREE.Vector3(
      positions[i + 3],
      positions[i + 4],
      positions[i + 5],
    );
    const v3 = new THREE.Vector3(
      positions[i + 6],
      positions[i + 7],
      positions[i + 8],
    );

    // Check for NaN or infinite values
    if (
      isFinite(v1.x) &&
      isFinite(v1.y) &&
      isFinite(v1.z) &&
      isFinite(v2.x) &&
      isFinite(v2.y) &&
      isFinite(v2.z) &&
      isFinite(v3.x) &&
      isFinite(v3.y) &&
      isFinite(v3.z)
    ) {
      // Check triangle area
      const edge1 = new THREE.Vector3().subVectors(v2, v1);
      const edge2 = new THREE.Vector3().subVectors(v3, v1);
      const area = new THREE.Vector3().crossVectors(edge1, edge2).length() / 2;

      if (area > 1e-10) {
        validPositions.push(...positions.slice(i, i + 9));
      }
    }
  }

  const repairedGeometry = new THREE.BufferGeometry();
  repairedGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(validPositions, 3),
  );

  if (geometry.attributes.normal) {
    repairedGeometry.setAttribute("normal", geometry.attributes.normal);
  }

  return repairedGeometry;
};

// Ensure normals are computed properly
const ensureNormals = (geometry: THREE.BufferGeometry): void => {
  if (!geometry.attributes.normal) {
    computeFlatNormals(geometry);
  }
};

export const STLProvider: React.FC<STLProviderProps> = ({ children }) => {
  // Add safeguard for hot reload issues
  useEffect(() => {
    console.log("🔧 STLProvider initialized/re-initialized");
  }, []);
  // Dual mesh system state
  const [originalMesh, setOriginalMesh] = useState<THREE.BufferGeometry | null>(
    null,
  );
  const [workingMeshTri, setWorkingMeshTri] =
    useState<THREE.BufferGeometry | null>(null);
  const [previewMeshMerged, setPreviewMeshMerged] =
    useState<THREE.BufferGeometry | null>(null);

  // Display geometry (for viewer)
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ErrorMessage[]>([]);
  const [viewerSettings, setViewerSettings] = useState<ViewerSettings>(
    defaultViewerSettings,
  );

  const [loadingProgress, setLoadingProgress] = useState({
    percentage: 0,
    stage: "",
    details: "",
  });

  const [processedModel, setProcessedModel] = useState<ProcessedModel | null>(
    null,
  );
  const [originalFormat, setOriginalFormat] = useState<"stl" | "obj" | null>(
    null,
  );
  const [objString, setObjString] = useState<string | null>(null);
  const [cleanupResults, setCleanupResults] = useState<any | null>(null);

  // Backup state
  const [backupOriginalMesh, setBackupOriginalMesh] =
    useState<THREE.BufferGeometry | null>(null);
  const [backupWorkingMeshTri, setBackupWorkingMeshTri] =
    useState<THREE.BufferGeometry | null>(null);
  const [backupPreviewMeshMerged, setBackupPreviewMeshMerged] =
    useState<THREE.BufferGeometry | null>(null);
  const [hasBackup, setHasBackup] = useState(false);

  // STL Tools state
  const [toolMode, setToolMode] = useState<STLToolMode>(STLToolMode.Highlight);
  const [isProcessingTool, setIsProcessingTool] = useState(false);

  // Highlighting state
  const [highlightedTriangle, setHighlightedTriangleState] = useState<
    number | null
  >(null);
  const [triangleStats, setTriangleStats] = useState<any>(null);

  // Decimation state
  const [decimationPainterMode, setDecimationPainterMode] =
    useState<boolean>(false);
  const [isDecimating, setIsDecimating] = useState<boolean>(false);

  // Merged mesh state
  const [mergedGeometry, setMergedGeometry] =
    useState<THREE.BufferGeometry | null>(null);
  const [hasMergedMesh, setHasMergedMesh] = useState<boolean>(false);

  const updateProgress = (
    percentage: number,
    stage: string,
    details: string = "",
  ) => {
    setLoadingProgress({ percentage, stage, details });
    return new Promise((resolve) => setTimeout(resolve, 10));
  };

  const availableModels = [
    { name: "cube", description: "Basic cube with 6 quad faces" },
    { name: "tetrahedron", description: "4 triangular faces" },
    { name: "octahedron", description: "8 triangular faces" },
    { name: "icosahedron", description: "20 triangular faces" },
    { name: "gear", description: "Gear wheel with teeth" },
    { name: "star", description: "5-pointed star shape" },
    { name: "cross", description: "Plus/cross shape" },
  ];

  // Set up dual mesh system
  const setupDualMeshSystem = async (loadedGeometry: THREE.BufferGeometry) => {
    // 1. Store original mesh (keep untouched)
    const original = loadedGeometry.clone();
    setOriginalMesh(original);

    // 2. Create triangulated working mesh for operations
    let triangulated = loadedGeometry.clone();

    // Ensure it's triangulated
    if (!triangulated.index) {
      // Already non-indexed triangulated
    } else {
      triangulated = triangulated.toNonIndexed();
    }

    // Apply repairs
    triangulated = repairGeometry(triangulated);
    ensureNormals(triangulated);

    // CRITICAL: Ensure triangle mesh has NO polygon metadata
    // This should be pure triangulated data only
    delete (triangulated as any).polygonFaces;
    delete (triangulated as any).polygonType;
    delete (triangulated as any).isProcedurallyGenerated;

    console.log("✅ Triangle mesh created - pure triangulated data only", {
      vertices: triangulated.attributes.position.count,
      triangles: Math.floor(triangulated.attributes.position.count / 3),
      hasPolygonFaces: !!(triangulated as any).polygonFaces,
    });

    setWorkingMeshTri(triangulated);

    // 3. Create merged preview mesh with coplanar face merging
    let preview = loadedGeometry.clone(); // Start from original, not triangulated

    // CRITICAL: Manually preserve polygon metadata since clone() doesn't copy custom properties
    if ((loadedGeometry as any).polygonFaces) {
      (preview as any).polygonFaces = (loadedGeometry as any).polygonFaces;
    }
    if ((loadedGeometry as any).polygonType) {
      (preview as any).polygonType = (loadedGeometry as any).polygonType;
    }
    if ((loadedGeometry as any).isProcedurallyGenerated) {
      (preview as any).isProcedurallyGenerated = (
        loadedGeometry as any
      ).isProcedurallyGenerated;
    }

    // Choose strategy: preserve original polygons for procedural models, or apply merging for loaded files
    const hasOriginalPolygons = (loadedGeometry as any).polygonFaces &&
                                (loadedGeometry as any).isProcedurallyGenerated;

    try {
      let mergedFaces: any[];

      if (hasOriginalPolygons) {
        // For procedural models: preserve original polygon structure
        console.log(`🎯 PRESERVING original polygon structure for procedural model`);
        mergedFaces = (loadedGeometry as any).polygonFaces;
      } else {
        // For loaded files: apply coplanar merging
        console.log(`🔧 APPLYING coplanar merging for loaded file`);
        const { EdgeAdjacentMerger } = await import(
          "../lib/processing/edgeAdjacentMerger"
        );
        mergedFaces = EdgeAdjacentMerger.mergeCoplanarTriangles(triangulated);
      }

      if (mergedFaces.length > 0) {
        // Apply the merged faces to the preview geometry
        PolygonFaceReconstructor.applyReconstructedFaces(preview, mergedFaces);
        (preview as any).polygonFaces = mergedFaces;
        (preview as any).polygonType = hasOriginalPolygons ? "preserved_procedural" : "edge_adjacent_merged";

        // Detailed logging for merged faces
        const faceTypeCounts = mergedFaces.reduce((counts: any, face: any) => {
          counts[face.type] = (counts[face.type] || 0) + 1;
          return counts;
        }, {});

        console.log(
          `✅ ${hasOriginalPolygons ? 'Preserved original' : 'Created merged'} preview with ${mergedFaces.length} polygon faces:`,
          faceTypeCounts,
        );
      } else {
        // Fallback: create basic triangle structure
        const positions = preview.attributes.position.array as Float32Array;
        const fallbackFaces: any[] = [];

        for (let i = 0; i < positions.length; i += 9) {
          fallbackFaces.push({
            type: "triangle",
            startVertex: i / 3,
            endVertex: i / 3 + 2,
            triangleCount: 1,
          });
        }

        (preview as any).polygonFaces = fallbackFaces;
        (preview as any).polygonType = "fallback_triangles";
        console.log("⚠️ Fallback to triangulated faces for merged preview");
      }
    } catch (error) {
      console.error("❌ Error during coplanar merging:", error);
      // Fallback: use original polygon structure if available
      if ((loadedGeometry as any).polygonFaces) {
        (preview as any).polygonFaces = (loadedGeometry as any).polygonFaces;
        (preview as any).polygonType = "preserved_original";
      } else {
        // Final fallback: basic triangles
        const positions = preview.attributes.position.array as Float32Array;
        const fallbackFaces: any[] = [];

        for (let i = 0; i < positions.length; i += 9) {
          fallbackFaces.push({
            type: "triangle",
            startVertex: i / 3,
            endVertex: i / 3 + 2,
            triangleCount: 1,
          });
        }

        (preview as any).polygonFaces = fallbackFaces;
        (preview as any).polygonType = "error_fallback_triangles";
      }
    }

    setPreviewMeshMerged(preview);

    // 4. Set initial display geometry based on default meshType
    const defaultMeshType = defaultViewerSettings.meshType;
    let initialGeometry: THREE.BufferGeometry;

    if (defaultMeshType === "merged") {
      initialGeometry = prepareGeometryForViewing(preview, "merged_display");
      console.log(
        `✅ Initial display set to MERGED with ${(preview as any).polygonFaces?.length || 0} polygon faces`,
      );
    } else {
      initialGeometry = prepareGeometryForViewing(
        triangulated,
        "triangle_display",
      );
      console.log(`✅ Initial display set to TRIANGLE`);
    }

    setGeometry(initialGeometry);

    console.log("✅ Normal processing complete - dual mesh system ready", {
      triangleVertices: triangulated.attributes.position.count,
      mergedVertices: preview.attributes.position.count,
      polygonFaces: (preview as any).polygonFaces?.length || 0,
      hasNormals: !!preview.attributes.normal,
      initialMeshType: defaultMeshType,
    });
  };

  // Minimal setup for very large files (>500KB) - NO heavy processing to prevent timeouts
  const setupMinimalMeshSystem = (loadedGeometry: THREE.BufferGeometry) => {
    // Just set the geometry directly with minimal processing
    // NO cloning, NO repairs, NO polygon reconstruction, NO dual mesh system

    // Basic scaling only
    loadedGeometry.computeBoundingBox();
    if (loadedGeometry.boundingBox) {
      const box = loadedGeometry.boundingBox;
      const maxDimension = Math.max(
        box.max.x - box.min.x,
        box.max.y - box.min.y,
        box.max.z - box.min.z,
      );

      if (maxDimension > 0) {
        const scale = 50 / maxDimension;
        loadedGeometry.scale(scale, scale, scale);
      }
    }

    // Always recompute normals for large files to fix any malformed faces from STL
    loadedGeometry.computeVertexNormals();

    // Even for large files, maintain separate triangle and merged meshes
    setOriginalMesh(loadedGeometry);

    // Create clean triangle mesh (no polygon metadata)
    const triangleMesh = loadedGeometry.clone();
    delete (triangleMesh as any).polygonFaces;
    delete (triangleMesh as any).polygonType;
    delete (triangleMesh as any).isProcedurallyGenerated;
    setWorkingMeshTri(triangleMesh);

    // Create merged mesh (with polygon metadata if available)
    setPreviewMeshMerged(loadedGeometry);
    setGeometry(loadedGeometry);

    console.log("✅ Minimal processing complete - geometry set directly", {
      vertices: loadedGeometry.attributes.position.count,
      hasNormals: !!loadedGeometry.attributes.normal,
      hasGeometry: !!loadedGeometry,
    });
  };

  // Progressive setup for large models (50k+ triangles)
  const setupDualMeshSystemProgressive = async (
    loadedGeometry: THREE.BufferGeometry,
    updateProgress: (
      percentage: number,
      stage: string,
      details?: string,
    ) => Promise<void>,
  ) => {
    // 1. Store original mesh (minimal memory)
    updateProgress(75, "Tune", "Storing original...");
    setOriginalMesh(loadedGeometry); // Don't clone for large models

    // 2. Create basic working mesh first for immediate display
    updateProgress(80, "Tune", "Creating display mesh...");
    let basicMesh = loadedGeometry.clone();

    // Minimal processing for immediate display
    if (basicMesh.index) {
      basicMesh = basicMesh.toNonIndexed();
    }
    ensureNormals(basicMesh);

    // Set for immediate display - maintain separate meshes
    const triangleMesh = basicMesh.clone();
    delete (triangleMesh as any).polygonFaces;
    delete (triangleMesh as any).polygonType;
    delete (triangleMesh as any).isProcedurallyGenerated;
    setWorkingMeshTri(triangleMesh);

    setPreviewMeshMerged(basicMesh);

    // 3. Set up basic display geometry immediately
    const displayGeometry = prepareGeometryForViewing(basicMesh, "display");
    setGeometry(displayGeometry);

    updateProgress(90, "Tune", "Finalizing...");

    // 4. Defer heavy operations to background (non-blocking)
    setTimeout(async () => {
      try {
        // Apply repairs and polygon reconstruction in background
        const repairedMesh = repairGeometry(basicMesh.clone());
        delete (repairedMesh as any).polygonFaces;
        delete (repairedMesh as any).polygonType;
        delete (repairedMesh as any).isProcedurallyGenerated;
        setWorkingMeshTri(repairedMesh);

        // Only do polygon reconstruction if needed for parts export
        // This is now deferred and won't block initial loading
      } catch (error) {
        console.warn("Background processing failed:", error);
      }
    }, 100);
  };

  // Helper function to create proper preview mesh after operations
  const createPreviewFromWorkingMesh = (
    workingGeometry: THREE.BufferGeometry,
    operationType: string,
  ) => {
    let preview = workingGeometry.clone();

    // Try to use preserved polygon faces first, then reconstruct if needed
    try {
      const existingPolygonFaces = (workingGeometry as any).polygonFaces;

      if (
        existingPolygonFaces &&
        Array.isArray(existingPolygonFaces) &&
        existingPolygonFaces.length > 0
      ) {
        // Use preserved polygon faces from decimation
        console.log(
          `🔧 Using preserved polygon faces: ${existingPolygonFaces.length} faces`,
        );
        (preview as any).polygonFaces = existingPolygonFaces;
        (preview as any).polygonType = `${operationType}_preserved`;
        (preview as any).isPolygonPreserved = true;
      } else {
        // Reconstruct polygon faces from triangulated geometry
        console.log(
          `🔧 Reconstructing polygon faces for ${operationType} preview`,
        );
        const polygonFaces =
          PolygonFaceReconstructor.reconstructPolygonFaces(workingGeometry);
        if (polygonFaces.length > 0) {
          PolygonFaceReconstructor.applyReconstructedFaces(
            preview,
            polygonFaces,
          );
          (preview as any).polygonType = `${operationType}_merged`;
        } else {
          // Fallback: use triangulated geometry as-is
          (preview as any).polygonType = `${operationType}_triangulated`;
        }
      }
    } catch (error) {
      // Fallback: use triangulated geometry as-is
      console.log(`⚠️ Preview creation error for ${operationType}:`, error);
      (preview as any).polygonType = `${operationType}_triangulated`;
    }

    return preview;
  };

  const loadModelFromFile = useCallback(async (file: File) => {
    console.log("🚀 loadModelFromFile called with:", file.name, file.size);

    setIsLoading(true);
    setError(null);
    setErrors([]);
    updateProgress(0, "Starting", "Initializing upload...");

    try {
      console.log("✅ Beginning file load process...");
      const { loadModelFile } = await import(
        "../lib/input/simplifiedSTLLoader"
      );

      setOriginalFormat(
        file.name.toLowerCase().endsWith(".stl") ? "stl" : "obj",
      );

      updateProgress(25, "Loading", "Reading file...");
      let loadedGeometry = await loadModelFile(file, updateProgress);

      // Detect file size and triangle count for loading strategy
      const fileSizeKB = file.size / 1024;
      const triangleCount = Math.floor(
        loadedGeometry.attributes.position.count / 3,
      );
      const isVeryLargeFile = fileSizeKB > 500; // Files >500KB get minimal processing
      const isLargeModel = triangleCount > 50000; // 50k+ triangles = large model

      updateProgress(50, "Build", "Preparing display...");

      console.log(
        `File: ${file.name}, Size: ${fileSizeKB.toFixed(1)}KB, Triangles: ${triangleCount}, Using: ${isVeryLargeFile ? "MINIMAL" : "NORMAL"} processing`,
      );

      if (isVeryLargeFile) {
        // MINIMAL PROCESSING for large files to prevent timeouts
        setupMinimalMeshSystem(loadedGeometry);
      } else {
        // Normal processing for smaller files
        // Scale to reasonable size
        loadedGeometry.computeBoundingBox();
        if (!loadedGeometry.boundingBox) {
          throw new Error("Invalid geometry: no bounding box");
        }

        const box = loadedGeometry.boundingBox;
        const maxDimension = Math.max(
          box.max.x - box.min.x,
          box.max.y - box.min.y,
          box.max.z - box.min.z,
        );

        if (maxDimension > 0) {
          const scale = 50 / maxDimension;
          loadedGeometry.scale(scale, scale, scale);
        }

        // Set up dual mesh system with progressive loading for large models
        if (isLargeModel) {
          await setupDualMeshSystemProgressive(loadedGeometry, updateProgress);
        } else {
          await setupDualMeshSystem(loadedGeometry);
        }
      }

      setFileName(file.name);

      updateProgress(100, "Done", "Model loaded successfully!");

      analytics.trackSTLUpload({
        file_name: file.name,
        file_size: file.size,
        vertices: loadedGeometry.attributes.position.count,
        triangles: Math.floor(loadedGeometry.attributes.position.count / 3),
        upload_time: Date.now(),
      });
    } catch (error) {
      console.error("❌ Error in loadModelFromFile:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("❌ Error details:", errorMessage);
      setError(`Failed to load ${file.name}: ${errorMessage}`);
      addError(errorMessage);
    } finally {
      console.log(
        "🏁 loadModelFromFile finally block - setting isLoading to false",
      );
      setIsLoading(false);
    }
  }, []);

  const loadSpecificModel = useCallback(async (modelName: string) => {
    setIsLoading(true);
    setError(null);

    try {
      updateProgress(0, "Loading", `Generating ${modelName}...`);

      // Generate preset models using PolygonGeometryBuilder
      let polygonGeometry: any;

      switch (modelName) {
        case "cube":
          polygonGeometry = PolygonGeometryBuilder.createBoxWithQuads(
            10,
            10,
            10,
          );
          break;
        case "tetrahedron":
          polygonGeometry = PolygonGeometryBuilder.createTetrahedron(10);
          break;
        case "octahedron":
          polygonGeometry = PolygonGeometryBuilder.createOctahedron(10);
          break;
        case "icosahedron":
          polygonGeometry = PolygonGeometryBuilder.createIcosahedron(10);
          break;
        case "gear":
          polygonGeometry = PolygonGeometryBuilder.createGearWheel(5, 8, 2, 8);
          break;
        case "star":
          polygonGeometry = PolygonGeometryBuilder.createStarShape(8, 4, 2, 5);
          break;
        case "cross":
          polygonGeometry = PolygonGeometryBuilder.createCrossShape(8, 8, 2, 2);
          break;
        default:
          throw new Error(`Unknown model: ${modelName}`);
      }

      updateProgress(50, "Converting", "Converting to BufferGeometry...");

      // Convert to BufferGeometry
      const isGearStarCross = ["gear", "star", "cross"].includes(modelName);
      let bufferGeometry: THREE.BufferGeometry;

      if (isGearStarCross) {
        bufferGeometry =
          PolygonGeometryBuilder.toBufferGeometryWithCenterTriangulation(
            polygonGeometry,
          );
      } else {
        bufferGeometry =
          PolygonGeometryBuilder.toBufferGeometry(polygonGeometry);
      }

      updateProgress(80, "Processing", "Setting up mesh system...");

      // Set up dual mesh system
      await setupDualMeshSystem(bufferGeometry);

      setFileName(`${modelName}.stl`);
      setOriginalFormat("stl");

      updateProgress(100, "Complete", "Model generated successfully!");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setError(`Failed to generate ${modelName}: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadDefaultSTL = useCallback(async () => {
    try {
      const randomModel =
        availableModels[Math.floor(Math.random() * availableModels.length)];
      await loadSpecificModel(randomModel.name);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setError(`Failed to load random model: ${errorMessage}`);
    }
  }, [loadSpecificModel]);

  const updateViewerSettings = useCallback(
    (settings: Partial<ViewerSettings>) => {
      setViewerSettings((prev) => ({ ...prev, ...settings }));
    },
    [],
  );

  const exportSTL = useCallback(
    (customFilename?: string) => {
      if (!previewMeshMerged) return;

      const filename = customFilename || fileName || "model.stl";
      STLExporter.exportGeometry(previewMeshMerged, filename);
    },
    [previewMeshMerged, fileName],
  );

  const exportOBJ = useCallback(
    (customFilename?: string) => {
      if (!previewMeshMerged) return;

      const filename = customFilename || fileName || "model.obj";
      const result = OBJConverter.geometryToOBJ(previewMeshMerged, filename);

      if (result.success !== false && result.objString) {
        // Create and download the OBJ file
        const blob = new Blob([result.objString], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename.endsWith(".obj")
          ? filename
          : `${filename}.obj`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log("✅ OBJ export complete:", {
          filename: link.download,
          vertices: result.vertexCount,
          faces: result.faceCount,
          hasQuads: result.hasQuads,
          hasPolygons: result.hasPolygons,
        });
      } else {
        console.error("❌ OBJ export failed:", result.error);
      }
    },
    [previewMeshMerged, fileName],
  );

  const addError = useCallback((message: string) => {
    const error: ErrorMessage = {
      id: Date.now().toString(),
      message,
      timestamp: Date.now(),
    };
    setErrors((prev) => [...prev, error]);
  }, []);

  const exportParts = useCallback(
    async (options?: {
      format?: "stl" | "obj";
      partThickness?: number;
      scale?: number;
      useTriangulated?: boolean;
    }) => {
      if (!previewMeshMerged) {
        console.error("No 3D model loaded for parts export");
        return;
      }

      try {
        await PolygonPartsExporter.exportPartsAsZip(
          previewMeshMerged,
          fileName || "model",
          options,
        );
      } catch (error) {
        console.error("Parts export failed:", error);
      }
    },
    [previewMeshMerged, fileName],
  );

  const exportChamferedParts = useCallback(
    async (options?: {
      format?: "stl" | "obj";
      partThickness?: number;
      chamferDepth?: number;
      scale?: number;
      useTriangulated?: boolean;
    }) => {
      if (!previewMeshMerged) {
        console.error("No 3D model loaded for chamfered parts export");
        addError("No 3D model loaded for chamfered parts export");
        return;
      }

      // Check if geometry has polygon faces (required for chamfering)
      const polygonFaces = (previewMeshMerged as any).polygonFaces;
      if (
        !polygonFaces ||
        !Array.isArray(polygonFaces) ||
        polygonFaces.length === 0
      ) {
        console.error(
          "Chamfered export requires polygon faces. Please ensure model is properly processed.",
        );
        addError(
          "Chamfered export requires polygon faces. Please ensure model is properly processed with merging enabled.",
        );
        return;
      }

      try {
        await ChamferedPartsExporter.exportChamferedPartsAsZip(
          previewMeshMerged,
          fileName || "model",
          options,
        );
      } catch (error) {
        console.error("Chamfered parts export failed:", error);
        addError(
          `Chamfered parts export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    },
    [previewMeshMerged, fileName, addError],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearErrorById = useCallback((id: string) => {
    setErrors((prev) => prev.filter((err) => err.id !== id));
  }, []);

  const reducePoints = useCallback(
    async (
      reductionAmount: number,
      method:
        | "quadric_edge_collapse"
        | "vertex_clustering"
        | "adaptive"
        | "random",
    ): Promise<ToolOperationResult> => {
      if (!workingMeshTri) {
        throw new Error("No triangulated mesh available for reduction");
      }

      setIsProcessingTool(true);

      try {
        console.log("🔧 Starting decimation...", {
          reductionAmount,
          method,
          inputVertices: workingMeshTri.attributes.position.count,
        });

        // Colors will be reapplied after decimation based on polygon face structure

        // Call static method directly
        const result = await STLManipulator.reducePoints(
          workingMeshTri,
          reductionAmount,
          method,
        );

        console.log("�� Decimation result:", {
          hasGeometry: !!result.geometry,
          originalVertices: result.originalStats.vertices,
          newVertices: result.newStats.vertices,
          reductionAchieved: result.reductionAchieved,
          processingTime: result.processingTime,
        });

        if (result.geometry) {
          console.log("✅ Updating meshes after decimation...");

          // Update working mesh - ensure it stays pure triangulated with flat normals
          const cleanTriangleMesh = result.geometry;
          delete (cleanTriangleMesh as any).isProcedurallyGenerated;

          // Keep polygon metadata if it exists for proper coloring
          if ((cleanTriangleMesh as any).polygonFaces) {
            console.log(
              `✅ Preserved ${(cleanTriangleMesh as any).polygonFaces.length} polygon faces after decimation`,
            );
          }

          // CRITICAL: Remove any existing normals and force flat normals for solid face coloring
          if (cleanTriangleMesh.attributes.normal) {
            cleanTriangleMesh.deleteAttribute("normal");
          }
          // Force recalculation of flat normals using right-hand rule
          cleanTriangleMesh.computeVertexNormals();
          console.log(
            "✅ Applied flat normals to decimated triangle mesh for solid face coloring",
          );

          setWorkingMeshTri(cleanTriangleMesh);

          // Create proper preview mesh with reconstructed faces
          const newPreview = createPreviewFromWorkingMesh(
            result.geometry,
            "decimated",
          );
          setPreviewMeshMerged(newPreview);

          // Update display
          const displayGeometry = prepareGeometryForViewing(
            newPreview,
            "decimated",
          );
          setGeometry(displayGeometry);

          console.log("✅ All meshes updated successfully!", {
            displayVertices: displayGeometry.attributes.position.count,
          });

          return {
            success: true,
            message: `Decimation complete: ${result.originalStats.vertices} → ${result.newStats.vertices} vertices (${(result.reductionAchieved * 100).toFixed(1)}% reduction)`,
            geometry: result.geometry,
          };
        } else {
          console.error("❌ Decimation failed: No geometry returned");
          return {
            success: false,
            message: "Decimation failed: No geometry returned",
            geometry: null,
          };
        }
      } finally {
        setIsProcessingTool(false);
      }
    },
    [workingMeshTri],
  );

  const getGeometryStats = useCallback(() => {
    if (!workingMeshTri) return null;

    const positions = workingMeshTri.attributes.position;
    const vertices = positions.count;
    const triangles = Math.floor(vertices / 3);

    return {
      vertices,
      triangles,
      edges: (triangles * 3) / 2, // Approximate for manifold mesh
    };
  }, [workingMeshTri]);

  const getDetailedGeometryStats = useCallback(() => {
    if (!workingMeshTri) return null;

    const positions = workingMeshTri.attributes.position;
    const vertices = positions.count;
    const triangles = Math.floor(vertices / 3);
    const edges = (triangles * 3) / 2; // Approximate for manifold mesh

    // Triangle mesh should ONLY show triangle data, never polygon faces
    // This ensures pure triangulated statistics for triangle mode
    const polygonBreakdown: Array<{ type: string; count: number }> = [
      { type: "triangle", count: triangles },
    ];

    console.log("📊 Triangle mesh stats - pure triangulated data:", {
      vertices,
      edges,
      triangles,
      hasPolygonFaces: !!(workingMeshTri as any).polygonFaces,
    });

    return {
      vertices,
      edges,
      triangles,
      polygonBreakdown,
    };
  }, [workingMeshTri]);

  const getDualMeshStats = useCallback(() => {
    if (!workingMeshTri || !previewMeshMerged) return null;

    // Stats for triangulated model
    const triPositions = workingMeshTri.attributes.position;
    const triVertices = triPositions.count;
    const triTriangles = Math.floor(triVertices / 3);
    const triEdges = (triTriangles * 3) / 2;

    // Stats for merged model
    const mergedPositions = previewMeshMerged.attributes.position;
    const mergedVertices = mergedPositions.count;

    // Polygon breakdown from merged model
    const polygonFaces = (previewMeshMerged as any).polygonFaces;
    let polygonBreakdown: Array<{ type: string; count: number }> = [];
    let actualTriangles = 0;
    let totalEdges = 0;

    if (polygonFaces && Array.isArray(polygonFaces)) {
      const typeCount: Record<string, number> = {};
      polygonFaces.forEach((face: any) => {
        const type = face.type || "triangle";
        typeCount[type] = (typeCount[type] || 0) + 1;

        // Count actual triangles only
        if (type === "triangle") {
          actualTriangles++;
          totalEdges += 3;
        } else if (type === "quad") {
          totalEdges += 4;
        } else {
          // For polygons, use originalVertices count if available
          const vertexCount = face.originalVertices?.length || 4;
          totalEdges += vertexCount;
        }
      });

      polygonBreakdown = Object.entries(typeCount)
        .filter(([type]) => type !== "triangle") // Don't show triangles in polygon breakdown
        .map(([type, count]) => ({ type, count }));

      // Only add triangles to breakdown if there are any
      if (actualTriangles > 0) {
        polygonBreakdown.unshift({ type: "triangle", count: actualTriangles });
      }
    } else {
      // Fallback to triangle calculation if no polygon faces
      actualTriangles = Math.floor(mergedVertices / 3);
      totalEdges = actualTriangles * 3;
      polygonBreakdown = [{ type: "triangle", count: actualTriangles }];
    }

    return {
      triangulated: {
        vertices: triVertices,
        edges: triEdges,
        triangles: triTriangles,
      },
      merged: {
        vertices: mergedVertices,
        edges: Math.floor(totalEdges / 2), // Each edge is shared by 2 faces
        actualTriangles, // Only actual triangle faces, not render triangles
        polygonBreakdown,
      },
    };
  }, [workingMeshTri, previewMeshMerged]);

  const setHighlightedTriangle = useCallback(
    (triangleIndex: number | null) => {
      setHighlightedTriangleState(triangleIndex);

      if (triangleIndex !== null) {
        // Check if we're in triangle mode or merged mode
        const isTriangleMode = viewerSettings.meshType === "triangle";

        if (isTriangleMode && workingMeshTri) {
          // Calculate actual triangle information from the triangle mesh
          const positionAttribute = workingMeshTri.attributes.position;
          if (!positionAttribute) {
            setTriangleStats(null);
            return;
          }

          // Get the three vertices of this triangle
          const vertices: THREE.Vector3[] = [];
          for (let i = 0; i < 3; i++) {
            const vertexIndex = triangleIndex * 3 + i;
            if (vertexIndex < positionAttribute.count) {
              vertices.push(
                new THREE.Vector3(
                  positionAttribute.getX(vertexIndex),
                  positionAttribute.getY(vertexIndex),
                  positionAttribute.getZ(vertexIndex),
                ),
              );
            }
          }

          if (vertices.length !== 3) {
            setTriangleStats(null);
            return;
          }

          // Calculate triangle area
          const edge1 = new THREE.Vector3().subVectors(
            vertices[1],
            vertices[0],
          );
          const edge2 = new THREE.Vector3().subVectors(
            vertices[2],
            vertices[0],
          );
          const cross = new THREE.Vector3().crossVectors(edge1, edge2);
          const triangleArea = cross.length() / 2;

          // Calculate triangle perimeter
          const trianglePerimeter =
            vertices[0].distanceTo(vertices[1]) +
            vertices[1].distanceTo(vertices[2]) +
            vertices[2].distanceTo(vertices[0]);

          // Calculate triangle normal
          const triangleNormal = cross.normalize();

          setTriangleStats({
            index: triangleIndex,
            vertices: vertices,
            area: triangleArea,
            perimeter: trianglePerimeter,
            normal: triangleNormal,
            faceType: "triangle",
            vertexCount: 3,
            parentFaceIndex: null, // No parent face in triangle mode
          });
        } else if (!isTriangleMode && previewMeshMerged) {
          // Merged mode - show polygon face information
          const polygonFaces = (previewMeshMerged as any).polygonFaces;

          if (!polygonFaces || !Array.isArray(polygonFaces)) {
            setTriangleStats(null);
            return;
          }

          // Find the face that contains this triangle
          let targetFace = null;
          let targetFaceIndex = -1;

          for (
            let faceIndex = 0;
            faceIndex < polygonFaces.length;
            faceIndex++
          ) {
            const face = polygonFaces[faceIndex];
            if (
              face.triangleIndices &&
              face.triangleIndices.includes(triangleIndex)
            ) {
              targetFace = face;
              targetFaceIndex = faceIndex;
              break;
            }
          }

          if (!targetFace) {
            setTriangleStats(null);
            return;
          }

          // Get the face vertices
          let faceVertices: THREE.Vector3[] = [];
          if (
            targetFace.originalVertices &&
            Array.isArray(targetFace.originalVertices)
          ) {
            faceVertices = targetFace.originalVertices.map(
              (v: any) => new THREE.Vector3(v.x, v.y, v.z),
            );
          } else {
            setTriangleStats(null);
            return;
          }

          // Calculate perimeter
          let facePerimeter = 0;
          for (let i = 0; i < faceVertices.length; i++) {
            const current = faceVertices[i];
            const next = faceVertices[(i + 1) % faceVertices.length];
            facePerimeter += current.distanceTo(next);
          }

          // Calculate area using shoelace formula for planar polygons
          let faceArea = 0;
          if (faceVertices.length === 3) {
            // Triangle area
            const edge1 = new THREE.Vector3().subVectors(
              faceVertices[1],
              faceVertices[0],
            );
            const edge2 = new THREE.Vector3().subVectors(
              faceVertices[2],
              faceVertices[0],
            );
            const cross = new THREE.Vector3().crossVectors(edge1, edge2);
            faceArea = cross.length() / 2;
          } else if (faceVertices.length === 4) {
            // Quad area using two triangles
            const edge1 = new THREE.Vector3().subVectors(
              faceVertices[1],
              faceVertices[0],
            );
            const edge2 = new THREE.Vector3().subVectors(
              faceVertices[2],
              faceVertices[0],
            );
            const cross1 = new THREE.Vector3().crossVectors(edge1, edge2);

            const edge3 = new THREE.Vector3().subVectors(
              faceVertices[2],
              faceVertices[0],
            );
            const edge4 = new THREE.Vector3().subVectors(
              faceVertices[3],
              faceVertices[0],
            );
            const cross2 = new THREE.Vector3().crossVectors(edge3, edge4);

            faceArea = (cross1.length() + cross2.length()) / 2;
          } else {
            // Polygon area using fan triangulation from first vertex
            for (let i = 1; i < faceVertices.length - 1; i++) {
              const edge1 = new THREE.Vector3().subVectors(
                faceVertices[i],
                faceVertices[0],
              );
              const edge2 = new THREE.Vector3().subVectors(
                faceVertices[i + 1],
                faceVertices[0],
              );
              const cross = new THREE.Vector3().crossVectors(edge1, edge2);
              faceArea += cross.length() / 2;
            }
          }

          // Calculate normal
          let faceNormal = new THREE.Vector3();
          if (targetFace.normal) {
            faceNormal = new THREE.Vector3(
              targetFace.normal.x,
              targetFace.normal.y,
              targetFace.normal.z,
            );
          } else {
            const edge1 = new THREE.Vector3().subVectors(
              faceVertices[1],
              faceVertices[0],
            );
            const edge2 = new THREE.Vector3().subVectors(
              faceVertices[2],
              faceVertices[0],
            );
            faceNormal = new THREE.Vector3()
              .crossVectors(edge1, edge2)
              .normalize();
          }

          setTriangleStats({
            index: triangleIndex,
            vertices: faceVertices,
            area: faceArea,
            perimeter: facePerimeter,
            normal: faceNormal,
            faceType: targetFace.type,
            vertexCount: faceVertices.length,
            parentFaceIndex: targetFaceIndex,
          });
        } else {
          setTriangleStats(null);
        }
      } else {
        setTriangleStats(null);
      }
    },
    [viewerSettings.meshType, workingMeshTri, previewMeshMerged],
  );

  const decimateEdge = useCallback(
    async (
      vertexIndex1: number,
      vertexIndex2: number,
    ): Promise<ToolOperationResult> => {
      if (!workingMeshTri) {
        throw new Error("No triangulated mesh available for edge decimation");
      }

      setIsDecimating(true);

      try {
        // Use static STLManipulator.decimateEdge method
        const result = await STLManipulator.decimateEdge(
          workingMeshTri,
          vertexIndex1,
          vertexIndex2,
        );

        if (result.success && result.geometry) {
          // Update working mesh - ensure it stays pure triangulated
          const cleanTriangleMesh = result.geometry;
          delete (cleanTriangleMesh as any).polygonFaces;
          delete (cleanTriangleMesh as any).polygonType;
          delete (cleanTriangleMesh as any).isProcedurallyGenerated;

          setWorkingMeshTri(cleanTriangleMesh);

          // Clear merged mesh since triangle mesh changed
          clearMergedMesh();

          // Update display with triangle mesh
          const displayGeometry = prepareGeometryForViewing(
            result.geometry,
            "edge_decimated",
          );
          setGeometry(displayGeometry);
        } else if (
          !result.success &&
          result.message.includes("Edge not found")
        ) {
          // Return specific error for edge not found
          return {
            success: false,
            message:
              "Edge not found in triangulated mesh. Please ensure you are working with a valid triangle model.",
            geometry: null,
          };
        }

        return result;
      } catch (error) {
        console.error("Edge decimation error:", error);
        return {
          success: false,
          message: `Edge decimation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          geometry: null,
        };
      } finally {
        setIsDecimating(false);
      }
    },
    [workingMeshTri],
  );

  const createBackup = useCallback(() => {
    if (originalMesh && workingMeshTri && previewMeshMerged) {
      setBackupOriginalMesh(originalMesh.clone());
      setBackupWorkingMeshTri(workingMeshTri.clone());
      setBackupPreviewMeshMerged(previewMeshMerged.clone());
      setHasBackup(true);
    }
  }, [originalMesh, workingMeshTri, previewMeshMerged]);

  const restoreFromBackup = useCallback(() => {
    if (
      hasBackup &&
      backupOriginalMesh &&
      backupWorkingMeshTri &&
      backupPreviewMeshMerged
    ) {
      setOriginalMesh(backupOriginalMesh.clone());
      setWorkingMeshTri(backupWorkingMeshTri.clone());
      setPreviewMeshMerged(backupPreviewMeshMerged.clone());

      const displayGeometry = prepareGeometryForViewing(
        backupPreviewMeshMerged,
        "restored",
      );
      setGeometry(displayGeometry);
    }
  }, [
    hasBackup,
    backupOriginalMesh,
    backupWorkingMeshTri,
    backupPreviewMeshMerged,
  ]);

  // Merged mesh management functions
  const clearMergedMesh = useCallback(() => {
    setMergedGeometry(null);
    setHasMergedMesh(false);
    // Switch viewer back to triangle mesh when merged mesh is cleared
    setViewerSettings((prev) => ({ ...prev, meshType: "triangle" }));
  }, []);

  // Helper function to convert THREE.js geometry to STL format
  const geometryToSTL = (geometry: THREE.BufferGeometry): string => {
    const positions = geometry.attributes.position;
    let stlContent = "solid merged_mesh\n";

    for (let i = 0; i < positions.count; i += 3) {
      const v1 = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
      const v2 = new THREE.Vector3(positions.getX(i + 1), positions.getY(i + 1), positions.getZ(i + 1));
      const v3 = new THREE.Vector3(positions.getX(i + 2), positions.getY(i + 2), positions.getZ(i + 2));

      // Calculate normal
      const edge1 = new THREE.Vector3().subVectors(v2, v1);
      const edge2 = new THREE.Vector3().subVectors(v3, v1);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      stlContent += `  facet normal ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}\n`;
      stlContent += `    outer loop\n`;
      stlContent += `      vertex ${v1.x.toFixed(6)} ${v1.y.toFixed(6)} ${v1.z.toFixed(6)}\n`;
      stlContent += `      vertex ${v2.x.toFixed(6)} ${v2.y.toFixed(6)} ${v2.z.toFixed(6)}\n`;
      stlContent += `      vertex ${v3.x.toFixed(6)} ${v3.y.toFixed(6)} ${v3.z.toFixed(6)}\n`;
      stlContent += `    endloop\n`;
      stlContent += `  endfacet\n`;
    }

    stlContent += "endsolid merged_mesh\n";
    return stlContent;
  };

  const mergeCoplanarFaces =
    useCallback(async (): Promise<ToolOperationResult> => {
      if (!workingMeshTri) {
        return {
          success: false,
          message: "No triangle mesh loaded. Please load a model first.",
          stats: null,
        };
      }

      try {
        setIsProcessingTool(true);

        const startTime = performance.now();
        const originalStats = getGeometryStats();

        // Try Python service first, fallback to JavaScript if unavailable
        let mergedMesh: THREE.BufferGeometry;
        let polygonFaces: any[];
        let newStats: any;
        let reductionFromPython = 0;

        try {
          // Check if Python service is available with manual timeout
          console.log(`🐍 TRYING PYTHON COPLANAR MERGER: Starting with ${originalStats?.triangles || 0} triangles`);

          // Create manual timeout for health check
          const healthController = new AbortController();
          const healthTimeout = setTimeout(() => healthController.abort(), 2000);

          const healthResponse = await fetch('http://localhost:8001/health', {
            method: 'GET',
            signal: healthController.signal
          });
          clearTimeout(healthTimeout);

          if (!healthResponse.ok) {
            throw new Error('Python service not available');
          }

          console.log(`✅ Python service is available, proceeding with coplanar merge`);

          // Convert THREE.js geometry to STL for Python service
          const stlContent = geometryToSTL(workingMeshTri);

          // Create form data for Python service
          const formData = new FormData();
          const stlBlob = new Blob([stlContent], { type: 'application/octet-stream' });
          formData.append('file', stlBlob, 'mesh.stl');
          formData.append('normal_threshold', '0.05'); // 0.05 radians ≈ 3 degrees - very strict
          formData.append('distance_threshold', '0.001'); // Very strict distance tolerance

          // Call Python service with manual timeout
          const mergeController = new AbortController();
          const mergeTimeout = setTimeout(() => mergeController.abort(), 15000); // 15 second timeout for processing

          const response = await fetch('http://localhost:8001/merge_coplanar_faces', {
            method: 'POST',
            body: formData,
            signal: mergeController.signal
          });
          clearTimeout(mergeTimeout);

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Python merger failed: ${response.status} ${errorText}`);
          }

          // Get statistics from response headers
          const originalTriangles = parseInt(response.headers.get('X-Original-Triangles') || '0');
          const finalTriangles = parseInt(response.headers.get('X-Final-Triangles') || '0');
          const finalFaces = parseInt(response.headers.get('X-Final-Faces') || '0');
          const mergedGroups = parseInt(response.headers.get('X-Merged-Groups') || '0');
          reductionFromPython = parseFloat(response.headers.get('X-Reduction-Achieved') || '0');

          console.log(`✅ PYTHON MERGER SUCCESS:`);
          console.log(`   Original triangles: ${originalTriangles}`);
          console.log(`   Final triangles: ${finalTriangles}`);
          console.log(`   Final faces: ${finalFaces}`);
          console.log(`   Merged groups: ${mergedGroups}`);
          console.log(`   Reduction: ${(reductionFromPython * 100).toFixed(1)}%`);

          // Load the merged mesh back into THREE.js
          const mergedSTLContent = await response.arrayBuffer();
          const { loadSTLFromArrayBuffer } = await import("../lib/input/simplifiedSTLLoader");
          mergedMesh = loadSTLFromArrayBuffer(mergedSTLContent);

          // Create polygon faces metadata based on the Python merger results
          const { EdgeAdjacentMerger } = await import("../lib/processing/edgeAdjacentMerger");
          polygonFaces = EdgeAdjacentMerger.mergeCoplanarTriangles(mergedMesh);

          // Add metadata to merged mesh
          (mergedMesh as any).polygonFaces = polygonFaces;
          (mergedMesh as any).polygonType = "python_open3d_merged";

          newStats = {
            vertices: mergedMesh.attributes.position.count / 3,
            faces: finalFaces, // Use Python's face count
            polygons: finalFaces,
            triangles: finalTriangles,
            mergedGroups: mergedGroups,
          };

        } catch (pythonError) {
          console.warn(`⚠️ Python service unavailable (${pythonError}), falling back to JavaScript merger`);

          // Fallback to JavaScript EdgeAdjacentMerger
          console.log(`🔧 FALLBACK: Using JavaScript EdgeAdjacentMerger with ${originalStats?.triangles || 0} triangles`);

          const { EdgeAdjacentMerger } = await import("../lib/processing/edgeAdjacentMerger");

          // Create merged mesh from current triangle mesh
          mergedMesh = workingMeshTri.clone();

          // Apply coplanar face merging using JavaScript
          polygonFaces = EdgeAdjacentMerger.mergeCoplanarTriangles(mergedMesh);

          // Add polygon face metadata to geometry
          (mergedMesh as any).polygonFaces = polygonFaces;
          (mergedMesh as any).polygonType = "javascript_fallback_merged";

          // Calculate stats based on polygon faces
          const polygonCount = polygonFaces.length;
          const triangleCount = polygonFaces.filter(f => f.type === "triangle").length;
          const quadCount = polygonFaces.filter(f => f.type === "quad").length;
          const polygonCountHigher = polygonFaces.filter(f => !["triangle", "quad"].includes(f.type)).length;

          newStats = {
            vertices: mergedMesh.attributes.position.count / 3,
            faces: polygonCount,
            polygons: polygonCount,
            triangles: triangleCount,
            quads: quadCount,
            higherPolygons: polygonCountHigher,
          };

          reductionFromPython = originalStats
            ? (originalStats.triangles - polygonCount) / originalStats.triangles
            : 0;

          console.log(`📊 JAVASCRIPT FALLBACK STATS:`);
          console.log(`   Original triangles: ${originalStats?.triangles || 0}`);
          console.log(`   Final polygons: ${polygonCount}`);
          console.log(`   Breakdown: ${triangleCount} triangles, ${quadCount} quads, ${polygonCountHigher} higher polygons`);
          console.log(`   Reduction: ${(reductionFromPython * 100).toFixed(1)}%`);

          // Apply polygon faces to the merged mesh geometry
          const { PolygonFaceReconstructor } = await import("../lib/processing/polygonFaceReconstructor");
          PolygonFaceReconstructor.applyReconstructedFaces(mergedMesh, polygonFaces);
        }

        const processingTime = Math.round(performance.now() - startTime);

        // Store the merged mesh and update preview
        setMergedGeometry(mergedMesh);
        setPreviewMeshMerged(mergedMesh); // This is what the viewer actually uses!
        setHasMergedMesh(true);

        // Force viewer update if currently in merged mode
        if (viewerSettings.meshType === "merged") {
          console.log("🔄 Forcing viewer update with new merged mesh");
          const displayGeometry = prepareGeometryForViewing(mergedMesh, "merged_display");
          setGeometry(displayGeometry);
        }

        const reductionAchieved = reductionFromPython;

        return {
          success: true,
          message: `Coplanar face merging completed successfully in ${processingTime}ms`,
          stats: {
            originalStats,
            newStats,
            reductionAchieved,
            processingTime,
          },
        };
      } catch (error) {
        console.error("Error during coplanar face merging:", error);
        return {
          success: false,
          message: `Coplanar face merging failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          stats: null,
        };
      } finally {
        setIsProcessingTool(false);
      }
    }, [workingMeshTri, getGeometryStats]);

  // Function to update viewer geometry based on mesh type setting
  const updateViewerGeometry = useCallback(() => {
    const meshType = viewerSettings.meshType;
    console.log(`🔄 Switching to ${meshType} mesh view`);

    if (meshType === "merged") {
      if (previewMeshMerged) {
        console.log(
          `✅ Using previewMeshMerged with ${(previewMeshMerged as any).polygonFaces?.length || 0} polygon faces`,
        );
        const displayGeometry = prepareGeometryForViewing(
          previewMeshMerged,
          "merged_display",
        );
        setGeometry(displayGeometry);
      } else if (mergedGeometry) {
        console.log(`✅ Using mergedGeometry fallback`);
        const displayGeometry = prepareGeometryForViewing(
          mergedGeometry,
          "merged_display",
        );
        setGeometry(displayGeometry);
      } else {
        // No merged mesh available, show error and revert to triangle
        console.log(`❌ No merged mesh available, reverting to triangle view`);
        addError(
          "⚠️ Merged mesh not available. Please run 'Merge Coplanar Faces' first to create the merged version.",
        );
        setViewerSettings((prev) => ({ ...prev, meshType: "triangle" }));
        if (workingMeshTri) {
          const displayGeometry = prepareGeometryForViewing(
            workingMeshTri,
            "triangle_display",
          );
          setGeometry(displayGeometry);
        }
      }
    } else {
      // Show triangle mesh
      console.log(`✅ Using workingMeshTri (triangle mesh)`);
      if (workingMeshTri) {
        const displayGeometry = prepareGeometryForViewing(
          workingMeshTri,
          "triangle_display",
        );
        setGeometry(displayGeometry);
      }
    }
  }, [
    viewerSettings.meshType,
    mergedGeometry,
    workingMeshTri,
    previewMeshMerged,
    addError,
  ]);

  // Update viewer when mesh type setting changes or when meshes are ready
  useEffect(() => {
    updateViewerGeometry();
  }, [updateViewerGeometry]);

  // Clear merged mesh when triangle mesh is updated (but not during initial setup)
  useEffect(() => {
    // Only clear merged mesh if we have a preview mesh (meaning we're not in initial setup)
    if (workingMeshTri && previewMeshMerged && !isLoading) {
      // Check if this is a real update (not initial setup) by seeing if the geometries are different
      const isInitialSetup = workingMeshTri === previewMeshMerged;
      if (!isInitialSetup) {
        console.log("🧹 Clearing merged mesh due to triangle mesh update");
        clearMergedMesh();
      }
    }
  }, [workingMeshTri, clearMergedMesh, previewMeshMerged, isLoading]);

  const contextValue: STLContextType = {
    geometry,
    fileName,
    isLoading,
    loadingProgress,
    error,
    errors,
    viewerSettings,
    processedModel,
    originalFormat,
    objString,
    cleanupResults,
    toolMode,
    isProcessingTool,
    highlightedTriangle,
    triangleStats,
    decimationPainterMode,
    setDecimationPainterMode,
    isDecimating,
    decimateEdge,
    loadModelFromFile,
    loadDefaultSTL,
    loadSpecificModel,
    availableModels,
    updateViewerSettings,
    exportSTL,
    exportOBJ,
    exportParts,
    exportChamferedParts,
    clearError,
    clearErrorById,
    addError,
    setToolMode,
    reducePoints,
    getGeometryStats,
    getDetailedGeometryStats,
    getDualMeshStats,
    setHighlightedTriangle,
    hasBackup,
    createBackup,
    restoreFromBackup,
    mergedGeometry,
    hasMergedMesh,
    mergeCoplanarFaces,
    clearMergedMesh,
  };

  // Ensure contextValue is properly defined before rendering
  if (!contextValue) {
    console.error("❌ STLContext contextValue is undefined during render");
    return null;
  }

  return (
    <STLContext.Provider value={contextValue}>{children}</STLContext.Provider>
  );
};
