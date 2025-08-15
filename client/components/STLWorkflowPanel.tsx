import React, { useState, useEffect } from "react";
import * as THREE from "three";
import {
  Upload,
  RefreshCw,
  Info,
  Download,
  Settings,
  Palette,
  Eye,
  X,
  ChevronDown,
  ChevronRight,
  Package,
  Wrench,
  Hammer,
  Menu,
  ArrowLeft,
  AlertTriangle,
  RotateCw,
} from "lucide-react";
import { useIsMobile } from "../hooks/use-mobile";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { STLToolMode } from "../lib/processing/stlManipulator";
import { useSTL } from "../context/STLContext";
import {
  estimateModelFileSize,
  estimatePartsFileSize,
  getTestFileSizeData,
} from "../lib/utilities/fileSizeEstimator";
import { HexColorPicker } from "react-colorful";
import { useToast } from "../hooks/use-toast";
import { PythonMeshProcessor } from "../lib/processing/pythonMeshProcessor";

interface STLWorkflowPanelProps {
  activeToolMode: STLToolMode;
  onToolModeChange: (mode: STLToolMode) => void;
  onReducePoints: (
    reduction: number,
    method:
      | "random"
      | "best"
      | "random_vertex"
      | "python_vertex"
      | "quadric_edge_collapse"
      | "vertex_clustering",
  ) => void;
  isProcessing: boolean;
  geometryStats: {
    vertices: number;
    triangles: number;
  } | null;
  randomColors: boolean;
  wireframe: boolean;
  autoSpin: boolean;
  onRandomColorsChange: (checked: boolean) => void;
  onWireframeChange: (checked: boolean) => void;
  onAutoSpinChange: (checked: boolean) => void;
}

export default function STLWorkflowPanel({
  activeToolMode,
  onToolModeChange,
  onReducePoints,
  isProcessing,
  geometryStats,
  randomColors,
  wireframe,
  autoSpin,
  onRandomColorsChange,
  onWireframeChange,
  onAutoSpinChange,
}: STLWorkflowPanelProps) {
  const isMobile = useIsMobile();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { toast } = useToast();

  // Epilepsy warning state
  const [showEpilepsyWarning, setShowEpilepsyWarning] = useState(false);
  const [hasShownEpilepsyWarning, setHasShownEpilepsyWarning] = useState(false);

  // Check if epilepsy warning has been shown this session
  useEffect(() => {
    const warningShown = sessionStorage.getItem("epilepsy_warning_shown");
    if (warningShown === "true") {
      setHasShownEpilepsyWarning(true);
    }
  }, []);

  // Handle colors change with epilepsy warning
  const handleColorsChange = (checked: boolean) => {
    if (checked && !hasShownEpilepsyWarning) {
      setShowEpilepsyWarning(true);
    } else {
      onRandomColorsChange(checked);
    }
  };

  // Handle epilepsy warning acceptance
  const handleEpilepsyWarningAccept = () => {
    setShowEpilepsyWarning(false);
    setHasShownEpilepsyWarning(true);
    sessionStorage.setItem("epilepsy_warning_shown", "true");
    onRandomColorsChange(true);
  };

  // Handle epilepsy warning cancel
  const handleEpilepsyWarningCancel = () => {
    setShowEpilepsyWarning(false);
    // Don't enable colors
  };

  const {
    fileName,
    isLoading,
    loadingProgress,
    geometry,
    loadModelFromFile,
    loadDefaultSTL,
    loadSpecificModel,
    availableModels,
    exportSTL,
    exportOBJ,
    exportParts,
    exportChamferedParts,
    viewerSettings,
    updateViewerSettings,
    getDetailedGeometryStats,
    getDualMeshStats,
    hasBackup,
    restoreFromBackup,
    decimationPainterMode,
    setDecimationPainterMode,
    setHighlightedTriangle,
    hasMergedMesh,
    mergeCoplanarFaces,
    clearMergedMesh,
  } = useSTL();

  // Clear face highlight when interacting with menu
  const clearHighlightOnMenuInteraction = () => {
    setHighlightedTriangle(null);
  };

  const [showBackgroundSettings, setShowBackgroundSettings] = useState(false);
  const [reductionAmount, setReductionAmount] = useState(0.5);
  const [reductionMethod, setReductionMethod] = useState<
    "random_vertex_removal" | "python_vertex_removal" | null
  >(null);
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightColorPicker, setShowHighlightColorPicker] =
    useState(false);
  const [expandedSections, setExpandedSections] = useState({
    upload: true,
    visualization: true,
    tools: true,
    export: true,
  });

  // Triangle export settings
  const [showTriangleSettings, setShowTriangleSettings] = useState(false);
  const [triangleOptions, setTriangleOptions] = useState({
    partThickness: 2,
    scale: 1,
    modelType: "merged" as "triangle" | "merged",
  });
  const [showChamferedSettings, setShowChamferedSettings] = useState(false);
  const [chamferedOptions, setChamferedOptions] = useState({
    partThickness: 2,
    scale: 1,
    modelType: "merged" as "triangle" | "merged",
  });

  // Export format selection

  const [exportType, setExportType] = useState<"complete" | "parts">(
    "complete",
  );

  // Professional simplification settings
  const [simplificationStats, setSimplificationStats] = useState<{
    originalStats?: any;
    newStats?: any;
    reductionAchieved?: number;
    processingTime?: number;
  }>({});

  // New simplification state variables
  const [vertexClusteringTolerance, setVertexClusteringTolerance] =
    useState(0.001);
  const [quadricReduction, setQuadricReduction] = useState(0.5);

  // Vertex clustering implementation
  const handleVertexClustering = async () => {
    if (!geometry) {
      toast({
        title: "❌ No Model Loaded",
        description: "Please load a model before applying vertex clustering.",
        duration: 3000,
      });
      return;
    }

    toast({
      title: "🔵 Vertex Clustering Started",
      description: `Clustering vertices with tolerance ${vertexClusteringTolerance}...`,
      duration: 1500,
    });

    // Use the existing onReducePoints interface but pass tolerance as the reduction parameter
    onReducePoints(vertexClusteringTolerance, "vertex_clustering");
  };

  // Open3D Quadric Decimation with fallback to JavaScript implementation
  const handleQuadricDecimation = async () => {
    if (!geometry) {
      toast({
        title: "❌ No Model Loaded",
        description: "Please load a model before applying quadric decimation.",
        duration: 3000,
      });
      return;
    }

    // Switch to triangle mesh view immediately
    updateViewerSettings({ meshType: "triangle" });

    try {
      // First, check if Python service is available
      const serviceAvailable = await PythonMeshProcessor.checkServiceHealth();

      if (serviceAvailable) {
        // Use Python service (Open3D simple_quadric_decimation)
        toast({
          title: "🟢 Open3D Decimation Started",
          description: `Reducing triangles by ${Math.round(quadricReduction * 100)}% using simple_quadric_decimation()...`,
          duration: 1500,
        });

        const result = await PythonMeshProcessor.decimateMesh(geometry, quadricReduction);

        if (result && result.geometry) {
          // Update triangle mesh with Python service result
          const decimationResult = await onReducePoints(quadricReduction, "quadric_edge_collapse");

          toast({
            title: "✅ Open3D Decimation Complete",
            description: `Reduced triangles by ${Math.round(result.reductionAchieved * 100)}% in ${result.processingTime}ms`,
            duration: 3000,
          });

          setSimplificationStats({
            originalVertices: result.originalVertices,
            finalVertices: result.finalVertices,
            originalTriangles: result.originalTriangles,
            finalTriangles: result.finalTriangles,
            reductionAchieved: result.reductionAchieved,
            processingTime: result.processingTime,
          });

          console.log("🟢 Open3D decimation complete - triangle mesh updated, view switched to triangle");
        }
      } else {
        // Fallback to JavaScript quadric edge collapse implementation
        toast({
          title: "🟡 Using JavaScript Decimation",
          description: `Python service unavailable. Reducing triangles by ${Math.round(quadricReduction * 100)}% using JavaScript fallback...`,
          duration: 1500,
        });

        const result = await onReducePoints(quadricReduction, "quadric_edge_collapse");

        if (result?.success) {
          toast({
            title: "✅ Decimation Complete (Fallback)",
            description: `Reduced triangles by ${result.stats?.reductionAchieved ? Math.round(result.stats.reductionAchieved * 100) : 0}% in ${result.stats?.processingTime || 0}ms`,
            duration: 3000,
          });
          setSimplificationStats(result.stats || {});
          console.log("🟡 JavaScript decimation fallback complete - triangle mesh updated");
        } else {
          throw new Error(result?.message || "Decimation failed");
        }
      }
    } catch (error) {
      toast({
        title: "❌ Decimation Error",
        description: error instanceof Error ? error.message : "Decimation operation failed",
        duration: 3000,
      });
      console.error("❌ Decimation failed:", error);
    }
  };

  // Merge coplanar faces implementation with popups
  const handleMergeCoplanarFaces = async () => {
    if (!geometry) {
      toast({
        title: "❌ No Model Loaded",
        description: "Please load a model before merging coplanar faces.",
        duration: 3000,
      });
      return;
    }

    toast({
      title: "🔄 Merging Coplanar Faces",
      description: "Processing coplanar face merging...",
      duration: 1500,
    });

    try {
      const result = await mergeCoplanarFaces();

      if (result.success) {
        toast({
          title: "✅ Coplanar Face Merging Complete",
          description: result.message,
          duration: 3000,
        });
      } else {
        toast({
          title: "❌ Coplanar Face Merging Failed",
          description: result.message,
          duration: 3000,
        });
      }
    } catch (error) {
      toast({
        title: "❌ Coplanar Face Merging Error",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        duration: 3000,
      });
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    console.log("🔄 File upload triggered:", file?.name, file?.size);
    if (file) {
      console.log("📁 Calling loadModelFromFile...");
      loadModelFromFile(file).catch((err) => {
        console.error("❌ Upload failed:", err);
        // Make sure the error is visible to the user
        alert(`Upload failed: ${err.message}`);
      });
    } else {
      console.log("❌ No file selected");
    }
    event.target.value = "";
  };

  const handleExportClick = (type: "complete" | "parts") => {
    // Directly export STL format
    if (type === "complete") {
      exportSTL();
    } else {
      exportParts({
        ...triangleOptions,
        format: "stl",
        useTriangulated: triangleOptions.modelType === "triangle",
      });
    }
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    try {
      setExpandedSections((prev) => ({
        ...prev,
        [section]: !prev[section],
      }));
    } catch (error) {
      console.error("Error toggling section:", section, error);
    }
  };

  const SectionHeader = ({
    title,
    isExpanded,
    onToggle,
    badge,
  }: {
    title: string;
    isExpanded: boolean;
    onToggle: () => void;
    badge?: string;
  }) => (
    <button
      onClick={onToggle}
      className="flex items-center justify-between w-full text-white text-sm font-semibold py-2 hover:text-white/80 transition-colors"
    >
      <div className="flex items-center gap-2">
        {isExpanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <span>{title}</span>
      </div>
      {badge && (
        <Badge
          variant="secondary"
          className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs"
        >
          {badge}
        </Badge>
      )}
    </button>
  );

  // Close drawer when clicking outside on mobile
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && isMobile) {
      setIsDrawerOpen(false);
    }
  };

  if (isMobile) {
    return (
      <>
        {/* Mobile Toggle Button */}
        <button
          onClick={() => setIsMenuCollapsed(!isMenuCollapsed)}
          className={`fixed top-1/2 -translate-y-1/2 z-50 transition-all duration-300 ease-in-out
            ${isMenuCollapsed ? "left-2" : "left-[17rem]"}
            bg-slate-900/90 backdrop-blur-lg border border-blue-400/30
            hover:border-blue-400/50 hover:bg-slate-800/90
            text-white p-2 rounded-full shadow-lg hover:shadow-blue-500/20
            w-8 h-8 flex items-center justify-center text-xs font-bold
          `}
          title={isMenuCollapsed ? "Show Menu" : "Hide Menu"}
        >
          {isMenuCollapsed ? ">" : "<"}
        </button>

        <div
          className={`fixed top-2 z-40 w-64 max-w-[80vw] transition-all duration-300 ease-in-out
          ${isMenuCollapsed ? "-left-64 opacity-0" : "left-2 opacity-100"}
        `}
        >
          <div className="bg-slate-900/95 backdrop-blur-lg rounded-lg border border-blue-400/30 overflow-hidden shadow-2xl shadow-blue-500/20">
            {/* Compact Mobile Header */}
            <div className="bg-gradient-to-r from-blue-900/95 to-purple-900/95 backdrop-blur-lg border-b border-blue-400/30 p-2">
              <h2 className="text-white font-semibold text-sm text-center">
                Intellimesh
              </h2>
            </div>

            {/* Mobile Content with compact sections */}
            <div className="p-2">
              <MobileWorkflowContent
                activeToolMode={activeToolMode}
                onToolModeChange={onToolModeChange}
                onReducePoints={onReducePoints}
                isProcessing={isProcessing}
                geometryStats={geometryStats}
                randomColors={randomColors}
                wireframe={wireframe}
                autoSpin={autoSpin}
                onRandomColorsChange={onRandomColorsChange}
                onWireframeChange={onWireframeChange}
                onAutoSpinChange={onAutoSpinChange}
              />
            </div>
          </div>
        </div>
      </>
    );
  }

  // Desktop Layout
  return (
    <>
      {/* Toggle Button - Always visible and vertically centered */}
      <button
        onClick={() => setIsMenuCollapsed(!isMenuCollapsed)}
        className={`fixed top-1/2 -translate-y-1/2 z-50 transition-all duration-300 ease-in-out
          ${isMenuCollapsed ? "left-2" : "left-[22rem]"}
          bg-slate-900/90 backdrop-blur-lg border border-blue-400/30
          hover:border-blue-400/50 hover:bg-slate-800/90
          text-white p-2 rounded-full shadow-lg hover:shadow-blue-500/20
          w-8 h-8 flex items-center justify-center text-xs font-bold
        `}
        title={isMenuCollapsed ? "Show Menu" : "Hide Menu"}
      >
        {isMenuCollapsed ? ">" : "<"}
      </button>

      {/* Main Menu Panel */}
      <div
        className={`fixed top-4 bottom-4 z-40 w-80 max-h-[calc(100vh-2rem)] transition-all duration-300 ease-in-out
        ${isMenuCollapsed ? "-left-80 opacity-0" : "left-4 opacity-100"}
      `}
      >
        <div className="bg-slate-900/90 backdrop-blur-lg rounded-2xl border border-blue-400/30 p-5 h-full overflow-y-auto shadow-2xl shadow-blue-500/20">
          {/* Header */}
          <div className="text-center mb-6 mesh-pattern-dense p-4 rounded-xl border border-blue-400/20">
            <h2 className="intellimesh-title text-white text-2xl mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Intellimesh
            </h2>
            <p className="text-blue-200/80 text-sm intellimesh-mono">
              Smarter tools for 3D modeling, slicing, and fabrication
            </p>

            {/* Enhanced Loading Progress Bar */}
            {isLoading && (
              <div className="mt-3 p-4 bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 rounded-xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-blue-200">
                      {loadingProgress.stage || "Processing"}
                    </div>
                    <div className="text-xs text-blue-300/80">
                      {loadingProgress.details || "Please wait..."}
                    </div>
                  </div>
                  <div className="text-xs font-mono text-blue-300 bg-blue-500/20 px-2 py-1 rounded">
                    {loadingProgress.percentage}%
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-white/10 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${loadingProgress.percentage}%` }}
                  >
                    <div className="h-full bg-white/20 animate-pulse"></div>
                  </div>
                </div>

                {/* Stage Indicators */}
                <div className="flex justify-between mt-2 text-xs">
                  <div
                    className={`px-1 ${loadingProgress.percentage >= 5 ? "text-green-400" : "text-white/50"}`}
                  >
                    Load
                  </div>
                  <div
                    className={`px-1 ${loadingProgress.percentage >= 25 ? "text-green-400" : "text-white/50"}`}
                  >
                    Parse
                  </div>
                  <div
                    className={`px-1 ${loadingProgress.percentage >= 50 ? "text-green-400" : "text-white/50"}`}
                  >
                    Build
                  </div>
                  <div
                    className={`px-1 ${loadingProgress.percentage >= 100 ? "text-green-400" : "text-white/50"}`}
                  >
                    Done
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 1. UPLOAD SECTION */}
          <div className="mb-6">
            <SectionHeader
              title="1. MESH IMPORT"
              isExpanded={expandedSections.upload}
              onToggle={() => toggleSection("upload")}
              badge={fileName ? "Ready" : "Upload File"}
            />

            {expandedSections.upload && (
              <div className="mt-4 space-y-4">
                {/* File Upload */}
                <div className="relative">
                  <input
                    type="file"
                    accept=".stl,.obj"
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    disabled={isLoading}
                    title="Upload STL or OBJ file (max 50MB)"
                  />
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 relative z-0 h-12"
                    disabled={isLoading}
                    title="Upload STL or OBJ file from your computer"
                    type="button"
                  >
                    <Upload className="w-5 h-5 mr-3" />
                    {isLoading ? "Loading..." : "Upload STL/OBJ File"}
                  </Button>
                </div>

                {/* Random Model */}
                <Button
                  onClick={() => {
                    clearHighlightOnMenuInteraction();
                    loadDefaultSTL();
                  }}
                  disabled={isLoading}
                  className="w-full border-gray-300 bg-white/10 hover:bg-white/20 text-white font-medium h-10"
                  variant="outline"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Load Random Model
                </Button>

                {/* File Info */}
                {fileName && (
                  <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                      <Info className="w-4 h-4 text-blue-400" />
                      <div className="flex items-center gap-2 flex-1">
                        <span className="font-medium text-white text-sm">
                          {fileName}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-white/60 hover:text-white hover:bg-white/10"
                              disabled={isLoading}
                            >
                              <ChevronDown className="w-3 h-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            className="bg-slate-800 border-slate-700 max-h-60 overflow-y-auto"
                            align="start"
                          >
                            {availableModels.map((model) => (
                              <DropdownMenuItem
                                key={model.name}
                                onClick={() => {
                                  clearHighlightOnMenuInteraction();
                                  loadSpecificModel(model.name);
                                }}
                                className="text-white hover:bg-slate-700 cursor-pointer"
                              >
                                <div>
                                  <div className="font-medium text-sm">
                                    {model.name}
                                  </div>
                                  <div className="text-xs text-white/60">
                                    {model.description}
                                  </div>
                                </div>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    {(() => {
                      const dualStats = getDualMeshStats();
                      if (!dualStats) return null;

                      return (
                        <div className="grid grid-cols-2 gap-4">
                          {/* Triangulated Model (Left) */}
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-blue-300 mb-2">
                              Triangulated
                            </div>
                            <div className="text-xs text-white/70 space-y-1">
                              <div>
                                V:{" "}
                                {dualStats.triangulated.vertices?.toLocaleString() ||
                                  0}
                              </div>
                              <div>
                                E:{" "}
                                {dualStats.triangulated.edges?.toLocaleString() ||
                                  0}
                              </div>
                              <div>
                                T:{" "}
                                {dualStats.triangulated.triangles?.toLocaleString() ||
                                  0}
                              </div>
                            </div>
                          </div>

                          {/* Merged Model (Right) */}
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-purple-300 mb-2">
                              Merged
                            </div>
                            <div className="text-xs text-white/70 space-y-1">
                              <div>
                                V:{" "}
                                {dualStats.merged.vertices?.toLocaleString() ||
                                  0}
                              </div>
                              <div>
                                E:{" "}
                                {dualStats.merged.edges?.toLocaleString() || 0}
                              </div>
                              {dualStats.merged.polygonBreakdown?.map(
                                ({ type, count }) => (
                                  <div key={type} className="text-xs">
                                    {type.charAt(0).toUpperCase() +
                                      type.slice(1)}
                                    s: {count?.toLocaleString() || 0}
                                  </div>
                                ),
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator className="bg-white/20 my-6" />

          {/* 2. VISUALIZATION SECTION */}
          <div className="mb-6">
            <SectionHeader
              title="2. MESH PREVIEW"
              isExpanded={expandedSections.visualization}
              onToggle={() => toggleSection("visualization")}
            />

            {expandedSections.visualization && (
              <div className="mt-4 space-y-4">
                {/* Mesh Type Toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-white/70" />
                    <Label htmlFor="meshType" className="text-sm text-white/80">
                      Mesh Type
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-white/60">Triangle</Label>
                    <Switch
                      id="meshType"
                      checked={viewerSettings.meshType === "merged"}
                      onCheckedChange={(checked) => {
                        const newMeshType = checked ? "merged" : "triangle";
                        updateViewerSettings({ meshType: newMeshType });
                      }}
                    />
                    <Label className="text-xs text-white/60">Merged</Label>
                  </div>
                </div>

                {/* Colors */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-white/70" />
                    <Label htmlFor="colors" className="text-sm text-white/80">
                      Colors
                    </Label>
                  </div>
                  <Switch
                    id="colors"
                    checked={randomColors}
                    onCheckedChange={handleColorsChange}
                  />
                </div>

                {/* Highlight Settings - Show when colors are enabled */}
                {randomColors && (
                  <div className="ml-4 pl-4 border-l-2 border-blue-500/20 space-y-3">
                    {/* Highlighting Enable/Disable */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full border border-white/30"
                          style={{
                            backgroundColor: viewerSettings.highlightColor,
                          }}
                        />
                        <Label
                          htmlFor="highlighting"
                          className="text-sm text-white/80"
                        >
                          Highlighting
                        </Label>
                      </div>
                      <Switch
                        id="highlighting"
                        checked={viewerSettings.enableHighlighting}
                        onCheckedChange={(checked) => {
                          clearHighlightOnMenuInteraction();
                          updateViewerSettings({ enableHighlighting: checked });
                        }}
                      />
                    </div>

                    {/* Highlight Color Picker - Show when highlighting is enabled */}
                    {viewerSettings.enableHighlighting && (
                      <div>
                        <div className="relative">
                          {/* Current Color Display & Toggle */}
                          <button
                            onClick={() =>
                              setShowHighlightColorPicker(
                                !showHighlightColorPicker,
                              )
                            }
                            className="flex items-center gap-3 w-full p-2 bg-slate-800/50 rounded-lg border border-slate-600/50 hover:border-slate-500/50 transition-colors"
                          >
                            <div
                              className="w-5 h-5 rounded-full border-2 border-white/30 shadow-sm"
                              style={{
                                backgroundColor: viewerSettings.highlightColor,
                              }}
                            />
                            <span className="text-sm text-white/80 flex-1 text-left">
                              {viewerSettings.highlightColor}
                            </span>
                            <Palette className="w-4 h-4 text-white/60" />
                          </button>

                          {/* Highlight Color Picker Popover */}
                          {showHighlightColorPicker && (
                            <>
                              {/* Backdrop */}
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() =>
                                  setShowHighlightColorPicker(false)
                                }
                              />
                              <div className="absolute top-full right-0 mt-2 z-50 bg-slate-900 border border-slate-600 rounded-lg p-3 shadow-xl">
                                <HexColorPicker
                                  color={viewerSettings.highlightColor}
                                  onChange={(color) => {
                                    clearHighlightOnMenuInteraction();
                                    updateViewerSettings({
                                      highlightColor: color,
                                    });
                                  }}
                                  style={{ width: "180px", height: "180px" }}
                                />
                                <div className="mt-3 flex justify-between items-center">
                                  <input
                                    type="text"
                                    value={viewerSettings.highlightColor}
                                    onChange={(e) => {
                                      const color = e.target.value;
                                      if (/^#[0-9A-Fa-f]{6}$/i.test(color)) {
                                        clearHighlightOnMenuInteraction();
                                        updateViewerSettings({
                                          highlightColor: color,
                                        });
                                      }
                                    }}
                                    className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white w-20"
                                    placeholder="#ff0000"
                                  />
                                  <button
                                    onClick={() =>
                                      setShowHighlightColorPicker(false)
                                    }
                                    className="text-white/60 hover:text-white/80 transition-colors"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Wireframe */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-white/70" />
                    <Label
                      htmlFor="wireframe"
                      className="text-sm text-white/80"
                    >
                      Wireframe Mode
                    </Label>
                  </div>
                  <Switch
                    id="wireframe"
                    checked={wireframe}
                    onCheckedChange={onWireframeChange}
                  />
                </div>

                {/* Auto Spin */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RotateCw className="w-4 h-4 text-white/70" />
                    <Label
                      htmlFor="auto-spin"
                      className="text-sm text-white/80"
                    >
                      Auto Spin
                    </Label>
                  </div>
                  <Switch
                    id="auto-spin"
                    checked={autoSpin}
                    onCheckedChange={onAutoSpinChange}
                  />
                </div>

                {/* Background Settings - Color Picker */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4 text-white/70" />
                    <Label className="text-sm text-white/80">Background</Label>
                  </div>
                  <div className="relative">
                    {/* Current Color Display & Toggle */}
                    <button
                      onClick={() => setShowColorPicker(!showColorPicker)}
                      className="flex items-center gap-2 p-2 bg-slate-800/50 rounded-lg border border-slate-600/50 hover:border-slate-500/50 transition-colors"
                    >
                      <div
                        className="w-5 h-5 rounded-full border-2 border-white/30 shadow-sm"
                        style={{
                          backgroundColor: viewerSettings.backgroundColor,
                        }}
                      />
                      <span className="text-xs text-white/70">
                        {viewerSettings.backgroundColor}
                      </span>
                    </button>

                    {/* Color Picker Popover */}
                    {showColorPicker && (
                      <>
                        {/* Backdrop */}
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setShowColorPicker(false)}
                        />
                        <div className="absolute top-full right-0 mt-2 z-50 bg-slate-900 border border-slate-600 rounded-lg p-3 shadow-xl">
                          <HexColorPicker
                            color={viewerSettings.backgroundColor}
                            onChange={(color) => {
                              clearHighlightOnMenuInteraction();
                              updateViewerSettings({ backgroundColor: color });
                            }}
                            style={{ width: "200px", height: "200px" }}
                          />
                          <div className="mt-3 flex justify-between items-center">
                            <input
                              type="text"
                              value={viewerSettings.backgroundColor}
                              onChange={(e) => {
                                const color = e.target.value;
                                if (/^#[0-9A-Fa-f]{6}$/i.test(color)) {
                                  clearHighlightOnMenuInteraction();
                                  updateViewerSettings({
                                    backgroundColor: color,
                                  });
                                }
                              }}
                              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white w-20"
                              placeholder="#000000"
                            />
                            <button
                              onClick={() => setShowColorPicker(false)}
                              className="text-white/60 hover:text-white/80 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <Separator className="bg-white/20 my-6" />

          {/* 3. TOOLS SECTION */}
          <div className="mb-6">
            <SectionHeader
              title="3. SIMPLIFICATION (in beta)"
              isExpanded={expandedSections.tools}
              onToggle={() => toggleSection("tools")}
            />

            {expandedSections.tools && (
              <div className="mt-4 space-y-4">
                {/* Backup/Restore Button */}
                <Button
                  onClick={() => {
                    restoreFromBackup();
                  }}
                  className={`w-full text-white text-xs py-2 h-8 ${
                    hasBackup
                      ? "bg-yellow-600 hover:bg-yellow-700"
                      : "bg-gray-600 cursor-not-allowed opacity-50"
                  }`}
                  disabled={!hasBackup}
                  title={
                    hasBackup
                      ? "Restore model to state before last simplification"
                      : "No backup available - perform a simplification first"
                  }
                >
                  <RefreshCw className="w-3 h-3 mr-2" />
                  {hasBackup
                    ? "🔄 Undo Last Simplification"
                    : "⚪ No Backup Available"}
                </Button>

                {/* 3.1 Vertex Clustering */}
                <div className="p-4 bg-white/10 rounded-lg border border-white/20">
                  <div className="text-white text-sm font-medium mb-3 flex items-center gap-2">
                    <span className="text-orange-400">3.1</span>
                    Vertex Clustering
                  </div>

                  <div className="mb-3">
                    <div className="text-white text-xs mb-2">
                      Tolerance Distance
                    </div>
                    <div className="space-y-2">
                      <input
                        type="range"
                        min="0.001"
                        max="0.1"
                        step="0.001"
                        value={vertexClusteringTolerance}
                        onChange={(e) =>
                          setVertexClusteringTolerance(
                            parseFloat(e.target.value),
                          )
                        }
                        className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                      />
                      <div className="flex justify-between text-xs text-white/70">
                        <span>0.001</span>
                        <span className="font-medium text-white">
                          {vertexClusteringTolerance.toFixed(3)}
                        </span>
                        <span>0.1</span>
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={handleVertexClustering}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white text-xs py-2 h-9"
                    disabled={isProcessing}
                  >
                    🔵 Apply Vertex Clustering
                  </Button>
                </div>

                {/* 3.2 Open3D Quadric Decimation */}
                <div className="p-4 bg-white/10 rounded-lg border border-white/20">
                  <div className="text-white text-sm font-medium mb-3 flex items-center gap-2">
                    <span className="text-green-400">3.2</span>
                    Open3D Quadric Decimation
                  </div>

                  <div className="mb-3">
                    <div className="text-white text-xs mb-2">
                      Target Reduction Percentage
                    </div>
                    <div className="space-y-2">
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.1"
                        value={quadricReduction}
                        onChange={(e) =>
                          setQuadricReduction(parseFloat(e.target.value))
                        }
                        className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                      />
                      <div className="flex justify-between text-xs text-white/70">
                        <span>10%</span>
                        <span className="font-medium text-white">
                          {Math.round(quadricReduction * 100)}%
                        </span>
                        <span>90%</span>
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={handleQuadricDecimation}
                    className="w-full bg-green-500 hover:bg-green-600 text-white text-xs py-2 h-9"
                    disabled={isProcessing}
                  >
                    🟢 Apply Open3D Decimation
                  </Button>
                </div>

                {/* 3.3 Decimation Painter */}
                <div className="p-4 bg-white/10 rounded-lg border border-white/20">
                  <div className="text-white text-sm font-medium mb-3 flex items-center gap-2">
                    <span className="text-purple-400">3.3</span>
                    Decimation Painter
                  </div>

                  <div
                    className={`p-3 rounded-lg border transition-all ${
                      decimationPainterMode
                        ? "bg-purple-500/20 border-purple-500/50"
                        : "bg-white/5 border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Palette
                          className={`w-4 h-4 ${
                            decimationPainterMode
                              ? "text-purple-300"
                              : "text-purple-400"
                          }`}
                        />
                        <div>
                          <div
                            className={`text-xs font-medium ${
                              decimationPainterMode
                                ? "text-purple-200"
                                : "text-white"
                            }`}
                          >
                            Interactive Edge Decimation{" "}
                            {decimationPainterMode ? "🎯" : ""}
                          </div>
                          <div className="text-white/60 text-xs">
                            {decimationPainterMode
                              ? "Click on edges to decimate them"
                              : "Click edges to decimate individual vertex pairs"}
                          </div>
                        </div>
                      </div>
                      <Switch
                        id="decimation-painter"
                        checked={decimationPainterMode}
                        onCheckedChange={(checked) => {
                          setDecimationPainterMode(checked);
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* 3.4 Merge Coplanar Faces */}
                <div className="p-4 bg-white/10 rounded-lg border border-white/20">
                  <div className="text-white text-sm font-medium mb-3 flex items-center gap-2">
                    <span className="text-blue-400">3.4</span>
                    Merge Coplanar Faces
                  </div>

                  <div className="mb-3">
                    <div className="text-white text-xs mb-2">
                      Convert triangle mesh to merged polygon mesh
                    </div>
                    <div className="text-white/60 text-xs">
                      Creates merged mesh with polygons instead of triangles. Required for merged mesh viewing and polygon exports.
                    </div>
                  </div>

                  <Button
                    onClick={handleMergeCoplanarFaces}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white text-xs py-2 h-9"
                    disabled={isProcessing}
                  >
                    🔄 Generate Merged Mesh
                  </Button>

                  {hasMergedMesh && (
                    <div className="mt-2 text-xs text-green-400">
                      ✅ Merged mesh available
                    </div>
                  )}
                </div>

                {/* Reduction Results */}
                {simplificationStats.originalStats &&
                  simplificationStats.newStats && (
                    <div className="p-3 bg-green-500/10 border border-green-500/20 rounded">
                      <div className="text-green-200 text-xs font-medium mb-2 flex items-center gap-1">
                        ✅ Simplification Complete
                      </div>
                      <div className="text-xs text-white/70 space-y-1">
                        <div className="flex justify-between">
                          <span>Vertices:</span>
                          <span>
                            {simplificationStats.originalStats?.vertices?.toLocaleString() ||
                              0}{" "}
                            →{" "}
                            {simplificationStats.newStats?.vertices?.toLocaleString() ||
                              0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Triangles:</span>
                          <span>
                            {simplificationStats.originalStats?.faces?.toLocaleString() ||
                              0}{" "}
                            →{" "}
                            {simplificationStats.newStats?.faces?.toLocaleString() ||
                              0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Reduction:</span>
                          <span className="text-green-400 font-medium">
                            {(
                              simplificationStats.reductionAchieved! * 100
                            ).toFixed(1)}
                            %
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Processing:</span>
                          <span>{simplificationStats.processingTime}ms</span>
                        </div>
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>

          <Separator className="bg-white/20 my-6" />

          {/* 4. EXPORT SECTION */}
          <div>
            <SectionHeader
              title="4. FABRICATION EXPORT"
              isExpanded={expandedSections.export}
              onToggle={() => toggleSection("export")}
              badge={geometry ? "Ready" : "No Model"}
            />

            {expandedSections.export && (
              <div className="mt-4 space-y-4">
                {/* Standard STL Export */}
                <div>
                  <div className="text-white text-sm font-medium mb-3 flex items-center gap-2">
                    <Download className="w-3 h-3" />
                    Standard Export
                  </div>
                  <Button
                    onClick={() => handleExportClick("complete")}
                    disabled={!geometry}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold h-10"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export Complete Model
                  </Button>
                  <p className="text-xs text-white/60 mt-1">
                    Download the complete model in STL format
                  </p>
                </div>

                {/* Crafting Exports Section */}
                <div className="text-white text-sm font-medium mb-3 flex items-center gap-2">
                  <Hammer className="w-4 h-4" />
                  Crafting Exports
                </div>

                {/* Polygon Parts Export */}
                <div>
                  <div className="text-white text-xs font-medium mb-2 flex items-center gap-2">
                    <Package className="w-3 h-3" />
                    Polygon Parts Export
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleExportClick("parts")}
                      disabled={!geometry}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold h-10"
                    >
                      <Package className="w-4 h-4 mr-2" />
                      Export Polygon Parts
                    </Button>
                    <Button
                      onClick={() =>
                        setShowTriangleSettings(!showTriangleSettings)
                      }
                      disabled={!geometry}
                      className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white h-10 px-3"
                      title="Configure parts settings"
                    >
                      <Wrench className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-white/60 mt-1">
                    Download individual polygon parts in STL format
                  </p>

                  {/* Triangle Export Settings */}
                  {showTriangleSettings && (
                    <div className="mt-3 p-4 bg-white/10 rounded-lg border border-white/20">
                      <div className="text-white text-sm font-medium mb-3">
                        Polygon Parts Settings
                      </div>

                      {/* Thickness Setting */}
                      <div className="mb-3">
                        <div className="text-white text-xs mb-2">
                          Part Thickness: {triangleOptions.partThickness}mm
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="0.5"
                          value={triangleOptions.partThickness}
                          onChange={(e) =>
                            setTriangleOptions((prev) => ({
                              ...prev,
                              partThickness: parseFloat(e.target.value),
                            }))
                          }
                          className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                        />
                        <div className="flex justify-between text-xs text-white/70 mt-1">
                          <span>1mm</span>
                          <span>10mm</span>
                        </div>
                      </div>

                      {/* Scale Setting */}
                      <div className="mb-3">
                        <div className="text-white text-xs mb-2">
                          Scale Factor: {triangleOptions.scale}x
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="10"
                          step="0.1"
                          value={triangleOptions.scale}
                          onChange={(e) =>
                            setTriangleOptions((prev) => ({
                              ...prev,
                              scale: parseFloat(e.target.value),
                            }))
                          }
                          className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                        />
                        <div className="flex justify-between text-xs text-white/70 mt-1">
                          <span>0.5x</span>
                          <span>10x</span>
                        </div>
                      </div>

                      {/* Model Selection */}
                      <div className="mb-3">
                        <div className="text-white text-xs font-medium mb-2">
                          Select Model
                        </div>
                        <select
                          value={triangleOptions.modelType}
                          onChange={(e) =>
                            setTriangleOptions((prev) => ({
                              ...prev,
                              modelType: e.target.value as
                                | "triangle"
                                | "merged",
                            }))
                          }
                          className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option
                            value="merged"
                            className="bg-gray-800 text-white"
                          >
                            Merged
                          </option>
                          <option
                            value="triangle"
                            className="bg-gray-800 text-white"
                          >
                            Triangle
                          </option>
                        </select>
                        <div className="text-white/60 text-xs mt-1">
                          {triangleOptions.modelType === "merged"
                            ? "Use merged polygon faces (default)"
                            : "Use triangulated geometry (more robust)"}
                        </div>
                      </div>

                      {/* Export Stats Preview */}
                      {geometry && (
                        <div className="mb-4 p-2 bg-white/5 rounded border border-white/10">
                          <div className="text-white text-xs font-medium mb-1">
                            Parts Export Preview:
                          </div>
                          <div className="text-xs text-white/70 space-y-1">
                            {(() => {
                              const polygonFaces = (geometry as any)
                                .polygonFaces;
                              const polygonType = (geometry as any).polygonType;

                              if (polygonFaces) {
                                const faceTypes = [
                                  ...new Set(
                                    polygonFaces.map((f: any) => f.type),
                                  ),
                                ];
                                return (
                                  <>
                                    <div>
                                      �� {polygonFaces.length} polygon parts (
                                      {polygonType})
                                    </div>
                                    <div>
                                      • Face types: {faceTypes.join(", ")}
                                    </div>
                                    <div>
                                      • Thickness:{" "}
                                      {triangleOptions.partThickness}
                                      mm, Scale: {triangleOptions.scale}x
                                    </div>
                                    <div>
                                      • Est. material: ~
                                      {(() => {
                                        // Calculate total surface area from triangles
                                        const positions =
                                          geometry.attributes.position.array;
                                        let totalArea = 0;

                                        for (
                                          let i = 0;
                                          i < positions.length;
                                          i += 9
                                        ) {
                                          // Get triangle vertices
                                          const v1 = {
                                            x: positions[i],
                                            y: positions[i + 1],
                                            z: positions[i + 2],
                                          };
                                          const v2 = {
                                            x: positions[i + 3],
                                            y: positions[i + 4],
                                            z: positions[i + 5],
                                          };
                                          const v3 = {
                                            x: positions[i + 6],
                                            y: positions[i + 7],
                                            z: positions[i + 8],
                                          };

                                          // Calculate triangle area using cross product
                                          const edge1 = {
                                            x: v2.x - v1.x,
                                            y: v2.y - v1.y,
                                            z: v2.z - v1.z,
                                          };
                                          const edge2 = {
                                            x: v3.x - v1.x,
                                            y: v3.y - v1.y,
                                            z: v3.z - v1.z,
                                          };
                                          const cross = {
                                            x:
                                              edge1.y * edge2.z -
                                              edge1.z * edge2.y,
                                            y:
                                              edge1.z * edge2.x -
                                              edge1.x * edge2.z,
                                            z:
                                              edge1.x * edge2.y -
                                              edge1.y * edge2.x,
                                          };
                                          const area =
                                            0.5 *
                                            Math.sqrt(
                                              cross.x * cross.x +
                                                cross.y * cross.y +
                                                cross.z * cross.z,
                                            );
                                          totalArea += area;
                                        }

                                        // Material = surface area * thickness * scale * calibration factor
                                        const calibrationFactor = 0.012; // Adjust this to calibrate estimates
                                        const material =
                                          totalArea *
                                          triangleOptions.partThickness *
                                          triangleOptions.scale *
                                          calibrationFactor;
                                        return Math.round(material);
                                      })()}
                                      g filament
                                    </div>
                                    <div>
                                      • Est. print time: ~
                                      {(() => {
                                        // Calculate material first (same as above)
                                        const positions =
                                          geometry.attributes.position.array;
                                        let totalArea = 0;

                                        for (
                                          let i = 0;
                                          i < positions.length;
                                          i += 9
                                        ) {
                                          const v1 = {
                                            x: positions[i],
                                            y: positions[i + 1],
                                            z: positions[i + 2],
                                          };
                                          const v2 = {
                                            x: positions[i + 3],
                                            y: positions[i + 4],
                                            z: positions[i + 5],
                                          };
                                          const v3 = {
                                            x: positions[i + 6],
                                            y: positions[i + 7],
                                            z: positions[i + 8],
                                          };

                                          const edge1 = {
                                            x: v2.x - v1.x,
                                            y: v2.y - v1.y,
                                            z: v2.z - v1.z,
                                          };
                                          const edge2 = {
                                            x: v3.x - v1.x,
                                            y: v3.y - v1.y,
                                            z: v3.z - v1.z,
                                          };
                                          const cross = {
                                            x:
                                              edge1.y * edge2.z -
                                              edge1.z * edge2.y,
                                            y:
                                              edge1.z * edge2.x -
                                              edge1.x * edge2.z,
                                            z:
                                              edge1.x * edge2.y -
                                              edge1.y * edge2.x,
                                          };
                                          const area =
                                            0.5 *
                                            Math.sqrt(
                                              cross.x * cross.x +
                                                cross.y * cross.y +
                                                cross.z * cross.z,
                                            );
                                          totalArea += area;
                                        }

                                        const calibrationFactor = 0.012;
                                        const material =
                                          totalArea *
                                          triangleOptions.partThickness *
                                          triangleOptions.scale *
                                          calibrationFactor;

                                        // Time = adjustment factor * material * (1 + log(triangle count))
                                        const triangleCount = Math.floor(
                                          positions.length / 9,
                                        );
                                        const timeAdjustmentFactor = 0.01; // Adjust this to calibrate time estimates
                                        const time =
                                          timeAdjustmentFactor *
                                          material *
                                          (1 + Math.log(triangleCount));
                                        return Math.floor(time);
                                      })()}
                                      h
                                    </div>
                                  </>
                                );
                              } else {
                                const triangleCount = Math.floor(
                                  geometry.attributes.position.count / 3,
                                );
                                return (
                                  <>
                                    <div>
                                      • {triangleCount} triangle parts
                                      (fallback)
                                    </div>
                                    <div>
                                      • Thickness:{" "}
                                      {triangleOptions.partThickness}
                                      mm, Scale: {triangleOptions.scale}x
                                    </div>
                                    <div>
                                      �� Est. material: ~
                                      {(() => {
                                        // Calculate total surface area from triangles
                                        const positions =
                                          geometry.attributes.position.array;
                                        let totalArea = 0;

                                        for (
                                          let i = 0;
                                          i < positions.length;
                                          i += 9
                                        ) {
                                          // Get triangle vertices
                                          const v1 = {
                                            x: positions[i],
                                            y: positions[i + 1],
                                            z: positions[i + 2],
                                          };
                                          const v2 = {
                                            x: positions[i + 3],
                                            y: positions[i + 4],
                                            z: positions[i + 5],
                                          };
                                          const v3 = {
                                            x: positions[i + 6],
                                            y: positions[i + 7],
                                            z: positions[i + 8],
                                          };

                                          // Calculate triangle area using cross product
                                          const edge1 = {
                                            x: v2.x - v1.x,
                                            y: v2.y - v1.y,
                                            z: v2.z - v1.z,
                                          };
                                          const edge2 = {
                                            x: v3.x - v1.x,
                                            y: v3.y - v1.y,
                                            z: v3.z - v1.z,
                                          };
                                          const cross = {
                                            x:
                                              edge1.y * edge2.z -
                                              edge1.z * edge2.y,
                                            y:
                                              edge1.z * edge2.x -
                                              edge1.x * edge2.z,
                                            z:
                                              edge1.x * edge2.y -
                                              edge1.y * edge2.x,
                                          };
                                          const area =
                                            0.5 *
                                            Math.sqrt(
                                              cross.x * cross.x +
                                                cross.y * cross.y +
                                                cross.z * cross.z,
                                            );
                                          totalArea += area;
                                        }

                                        // Material = surface area * thickness * scale * calibration factor
                                        const calibrationFactor = 0.012; // Adjust this to calibrate estimates
                                        const material =
                                          totalArea *
                                          triangleOptions.partThickness *
                                          triangleOptions.scale *
                                          calibrationFactor;
                                        return Math.round(material);
                                      })()}
                                      g filament
                                    </div>
                                    <div>
                                      • Est. print time: ~
                                      {(() => {
                                        // Calculate material first (same as above)
                                        const positions =
                                          geometry.attributes.position.array;
                                        let totalArea = 0;

                                        for (
                                          let i = 0;
                                          i < positions.length;
                                          i += 9
                                        ) {
                                          const v1 = {
                                            x: positions[i],
                                            y: positions[i + 1],
                                            z: positions[i + 2],
                                          };
                                          const v2 = {
                                            x: positions[i + 3],
                                            y: positions[i + 4],
                                            z: positions[i + 5],
                                          };
                                          const v3 = {
                                            x: positions[i + 6],
                                            y: positions[i + 7],
                                            z: positions[i + 8],
                                          };

                                          const edge1 = {
                                            x: v2.x - v1.x,
                                            y: v2.y - v1.y,
                                            z: v2.z - v1.z,
                                          };
                                          const edge2 = {
                                            x: v3.x - v1.x,
                                            y: v3.y - v1.y,
                                            z: v3.z - v1.z,
                                          };
                                          const cross = {
                                            x:
                                              edge1.y * edge2.z -
                                              edge1.z * edge2.y,
                                            y:
                                              edge1.z * edge2.x -
                                              edge1.x * edge2.z,
                                            z:
                                              edge1.x * edge2.y -
                                              edge1.y * edge2.x,
                                          };
                                          const area =
                                            0.5 *
                                            Math.sqrt(
                                              cross.x * cross.x +
                                                cross.y * cross.y +
                                                cross.z * cross.z,
                                            );
                                          totalArea += area;
                                        }

                                        const calibrationFactor = 0.012;
                                        const material =
                                          totalArea *
                                          triangleOptions.partThickness *
                                          triangleOptions.scale *
                                          calibrationFactor;

                                        // Time = adjustment factor * material * (1 + log(triangle count))
                                        const timeAdjustmentFactor = 0.01; // Adjust this to calibrate time estimates
                                        const time =
                                          timeAdjustmentFactor *
                                          material *
                                          (1 + Math.log(triangleCount));
                                        return Math.floor(time);
                                      })()}
                                      h
                                    </div>
                                  </>
                                );
                              }
                            })()}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button
                          onClick={() => {
                            exportParts({
                              ...triangleOptions,
                              useTriangulated:
                                triangleOptions.modelType === "triangle",
                            });
                            setShowTriangleSettings(false);
                          }}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 h-8"
                          disabled={isProcessing || !geometry}
                        >
                          Generate Polygon Parts
                        </Button>
                        <Button
                          onClick={() => setShowTriangleSettings(false)}
                          className="bg-white/20 hover:bg-white/30 text-white text-xs py-2 px-3 h-8"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3D Print 'n' Glue Export */}
                <div>
                  <div className="text-white text-xs font-medium mb-2 flex items-center gap-2">
                    <Hammer className="w-3 h-3" />
                    3D Print 'n' Glue Export
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        exportChamferedParts({
                          ...chamferedOptions,
                          useTriangulated:
                            chamferedOptions.modelType === "triangle",
                        });
                        setShowChamferedSettings(false);
                      }}
                      disabled={!geometry}
                      className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold h-10"
                    >
                      <Hammer className="w-4 h-4 mr-2" />
                      Export Chamfered Parts
                    </Button>
                    <Button
                      onClick={() =>
                        setShowChamferedSettings(!showChamferedSettings)
                      }
                      disabled={!geometry}
                      className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white h-10 px-3"
                      title="Configure chamfer settings"
                    >
                      <Wrench className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-white/60 mt-1">
                    Generate chamfered parts with angled sides that fit together
                    perfectly for easy assembly
                  </p>

                  {/* Chamfered Export Settings */}
                  {showChamferedSettings && (
                    <div className="mt-3 p-4 bg-white/10 rounded-lg border border-white/20">
                      <div className="text-white text-sm font-medium mb-3">
                        Chamfered Parts Settings
                      </div>

                      {/* Thickness Setting */}
                      <div className="mb-3">
                        <div className="text-white text-xs mb-2">
                          Part Thickness: {chamferedOptions.partThickness}mm
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="0.5"
                          value={chamferedOptions.partThickness}
                          onChange={(e) =>
                            setChamferedOptions((prev) => ({
                              ...prev,
                              partThickness: parseFloat(e.target.value),
                            }))
                          }
                          className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                        />
                      </div>

                      {/* Scale Setting */}
                      <div className="mb-3">
                        <div className="text-white text-xs mb-2">
                          Scale Factor: {chamferedOptions.scale}x
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="10"
                          step="0.1"
                          value={chamferedOptions.scale}
                          onChange={(e) =>
                            setChamferedOptions((prev) => ({
                              ...prev,
                              scale: parseFloat(e.target.value),
                            }))
                          }
                          className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                        />
                        <div className="flex justify-between text-xs text-white/70 mt-1">
                          <span>0.1x</span>
                          <span>10x</span>
                        </div>
                      </div>

                      {/* Model Selection */}
                      <div className="mb-3">
                        <div className="text-white text-xs font-medium mb-2">
                          Select Model
                        </div>
                        <select
                          value={chamferedOptions.modelType}
                          onChange={(e) =>
                            setChamferedOptions((prev) => ({
                              ...prev,
                              modelType: e.target.value as
                                | "triangle"
                                | "merged",
                            }))
                          }
                          className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option
                            value="merged"
                            className="bg-gray-800 text-white"
                          >
                            Merged
                          </option>
                          <option
                            value="triangle"
                            className="bg-gray-800 text-white"
                          >
                            Triangle
                          </option>
                        </select>
                        <div className="text-white/60 text-xs mt-1">
                          {chamferedOptions.modelType === "merged"
                            ? "Use merged polygon faces (default)"
                            : "Use triangulated geometry (more robust)"}
                        </div>
                      </div>

                      {/* Export Stats Preview */}
                      {geometry && (
                        <div className="mb-4 p-2 bg-white/5 rounded border border-white/10">
                          <div className="text-white text-xs font-medium mb-1">
                            Chamfered Parts Export Preview:
                          </div>
                          <div className="text-xs text-white/70 space-y-1">
                            {(() => {
                              const polygonFaces = (geometry as any)
                                .polygonFaces;
                              const polygonType = (geometry as any).polygonType;

                              if (polygonFaces) {
                                const faceTypes = [
                                  ...new Set(
                                    polygonFaces.map((f: any) => f.type),
                                  ),
                                ];
                                return (
                                  <>
                                    <div>
                                      • {polygonFaces.length} chamfered parts (
                                      {polygonType})
                                    </div>
                                    <div>
                                      • Face types: {faceTypes.join(", ")}
                                    </div>
                                    <div>
                                      • Thickness:{" "}
                                      {chamferedOptions.partThickness}
                                      mm, Scale: {chamferedOptions.scale}x
                                    </div>
                                    <div>
                                      • Est. material: ~
                                      {(() => {
                                        // Calculate total surface area from triangles
                                        const positions =
                                          geometry.attributes.position.array;
                                        let totalArea = 0;

                                        for (
                                          let i = 0;
                                          i < positions.length;
                                          i += 9
                                        ) {
                                          // Get triangle vertices
                                          const v1 = {
                                            x: positions[i],
                                            y: positions[i + 1],
                                            z: positions[i + 2],
                                          };
                                          const v2 = {
                                            x: positions[i + 3],
                                            y: positions[i + 4],
                                            z: positions[i + 5],
                                          };
                                          const v3 = {
                                            x: positions[i + 6],
                                            y: positions[i + 7],
                                            z: positions[i + 8],
                                          };

                                          // Calculate triangle area using cross product
                                          const edge1 = {
                                            x: v2.x - v1.x,
                                            y: v2.y - v1.y,
                                            z: v2.z - v1.z,
                                          };
                                          const edge2 = {
                                            x: v3.x - v1.x,
                                            y: v3.y - v1.y,
                                            z: v3.z - v1.z,
                                          };
                                          const cross = {
                                            x:
                                              edge1.y * edge2.z -
                                              edge1.z * edge2.y,
                                            y:
                                              edge1.z * edge2.x -
                                              edge1.x * edge2.z,
                                            z:
                                              edge1.x * edge2.y -
                                              edge1.y * edge2.x,
                                          };
                                          const area =
                                            0.5 *
                                            Math.sqrt(
                                              cross.x * cross.x +
                                                cross.y * cross.y +
                                                cross.z * cross.z,
                                            );
                                          totalArea += area;
                                        }

                                        // Material = surface area * thickness * scale * calibration factor (adjusted by 0.75)
                                        const calibrationFactor = 0.0108; // 0.004 * 0.75 * 1.2 * 3
                                        const material =
                                          totalArea *
                                          chamferedOptions.partThickness *
                                          chamferedOptions.scale *
                                          calibrationFactor;
                                        return Math.round(material);
                                      })()}
                                      g filament
                                    </div>
                                    <div>
                                      • Est. print time: ~
                                      {(() => {
                                        // Calculate material first (same as above)
                                        const positions =
                                          geometry.attributes.position.array;
                                        let totalArea = 0;

                                        for (
                                          let i = 0;
                                          i < positions.length;
                                          i += 9
                                        ) {
                                          const v1 = {
                                            x: positions[i],
                                            y: positions[i + 1],
                                            z: positions[i + 2],
                                          };
                                          const v2 = {
                                            x: positions[i + 3],
                                            y: positions[i + 4],
                                            z: positions[i + 5],
                                          };
                                          const v3 = {
                                            x: positions[i + 6],
                                            y: positions[i + 7],
                                            z: positions[i + 8],
                                          };

                                          const edge1 = {
                                            x: v2.x - v1.x,
                                            y: v2.y - v1.y,
                                            z: v2.z - v1.z,
                                          };
                                          const edge2 = {
                                            x: v3.x - v1.x,
                                            y: v3.y - v1.y,
                                            z: v3.z - v1.z,
                                          };
                                          const cross = {
                                            x:
                                              edge1.y * edge2.z -
                                              edge1.z * edge2.y,
                                            y:
                                              edge1.z * edge2.x -
                                              edge1.x * edge2.z,
                                            z:
                                              edge1.x * edge2.y -
                                              edge1.y * edge2.x,
                                          };
                                          const area =
                                            0.5 *
                                            Math.sqrt(
                                              cross.x * cross.x +
                                                cross.y * cross.y +
                                                cross.z * cross.z,
                                            );
                                          totalArea += area;
                                        }

                                        const calibrationFactor = 0.0108; // 0.004 * 0.75 * 1.2 * 3
                                        const material =
                                          totalArea *
                                          chamferedOptions.partThickness *
                                          chamferedOptions.scale *
                                          calibrationFactor;

                                        // Time = adjustment factor * material * (1 + log(polygon count))
                                        const timeAdjustmentFactor = 0.01; // Adjust this to calibrate time estimates
                                        const time =
                                          timeAdjustmentFactor *
                                          material *
                                          (1 + Math.log(polygonFaces.length));
                                        return Math.floor(time);
                                      })()}
                                      h
                                    </div>
                                  </>
                                );
                              } else {
                                const triangleCount = Math.floor(
                                  geometry.attributes.position.count / 3,
                                );
                                return (
                                  <>
                                    <div>
                                      • {triangleCount} chamfered parts
                                      (fallback)
                                    </div>
                                    <div>
                                      ��� Thickness:{" "}
                                      {chamferedOptions.partThickness}
                                      mm, Scale: {chamferedOptions.scale}x
                                    </div>
                                    <div>
                                      • Est. material: ~
                                      {(() => {
                                        // Calculate total surface area from triangles
                                        const positions =
                                          geometry.attributes.position.array;
                                        let totalArea = 0;

                                        for (
                                          let i = 0;
                                          i < positions.length;
                                          i += 9
                                        ) {
                                          // Get triangle vertices
                                          const v1 = {
                                            x: positions[i],
                                            y: positions[i + 1],
                                            z: positions[i + 2],
                                          };
                                          const v2 = {
                                            x: positions[i + 3],
                                            y: positions[i + 4],
                                            z: positions[i + 5],
                                          };
                                          const v3 = {
                                            x: positions[i + 6],
                                            y: positions[i + 7],
                                            z: positions[i + 8],
                                          };

                                          // Calculate triangle area using cross product
                                          const edge1 = {
                                            x: v2.x - v1.x,
                                            y: v2.y - v1.y,
                                            z: v2.z - v1.z,
                                          };
                                          const edge2 = {
                                            x: v3.x - v1.x,
                                            y: v3.y - v1.y,
                                            z: v3.z - v1.z,
                                          };
                                          const cross = {
                                            x:
                                              edge1.y * edge2.z -
                                              edge1.z * edge2.y,
                                            y:
                                              edge1.z * edge2.x -
                                              edge1.x * edge2.z,
                                            z:
                                              edge1.x * edge2.y -
                                              edge1.y * edge2.x,
                                          };
                                          const area =
                                            0.5 *
                                            Math.sqrt(
                                              cross.x * cross.x +
                                                cross.y * cross.y +
                                                cross.z * cross.z,
                                            );
                                          totalArea += area;
                                        }

                                        // Material = surface area * thickness * scale * calibration factor (adjusted by 0.75)
                                        const calibrationFactor = 0.0108; // 0.004 * 0.75 * 1.2 * 3
                                        const material =
                                          totalArea *
                                          chamferedOptions.partThickness *
                                          chamferedOptions.scale *
                                          calibrationFactor;
                                        return Math.round(material);
                                      })()}
                                      g filament
                                    </div>
                                    <div>
                                      • Est. print time: ~
                                      {(() => {
                                        // Calculate material first (same as above)
                                        const positions =
                                          geometry.attributes.position.array;
                                        let totalArea = 0;

                                        for (
                                          let i = 0;
                                          i < positions.length;
                                          i += 9
                                        ) {
                                          const v1 = {
                                            x: positions[i],
                                            y: positions[i + 1],
                                            z: positions[i + 2],
                                          };
                                          const v2 = {
                                            x: positions[i + 3],
                                            y: positions[i + 4],
                                            z: positions[i + 5],
                                          };
                                          const v3 = {
                                            x: positions[i + 6],
                                            y: positions[i + 7],
                                            z: positions[i + 8],
                                          };

                                          const edge1 = {
                                            x: v2.x - v1.x,
                                            y: v2.y - v1.y,
                                            z: v2.z - v1.z,
                                          };
                                          const edge2 = {
                                            x: v3.x - v1.x,
                                            y: v3.y - v1.y,
                                            z: v3.z - v1.z,
                                          };
                                          const cross = {
                                            x:
                                              edge1.y * edge2.z -
                                              edge1.z * edge2.y,
                                            y:
                                              edge1.z * edge2.x -
                                              edge1.x * edge2.z,
                                            z:
                                              edge1.x * edge2.y -
                                              edge1.y * edge2.x,
                                          };
                                          const area =
                                            0.5 *
                                            Math.sqrt(
                                              cross.x * cross.x +
                                                cross.y * cross.y +
                                                cross.z * cross.z,
                                            );
                                          totalArea += area;
                                        }

                                        const calibrationFactor = 0.0108; // 0.004 * 0.75 * 1.2 * 3
                                        const material =
                                          totalArea *
                                          chamferedOptions.partThickness *
                                          chamferedOptions.scale *
                                          calibrationFactor;

                                        // Time = adjustment factor * material * (1 + log(triangle count))
                                        const timeAdjustmentFactor = 0.01; // Adjust this to calibrate time estimates
                                        const time =
                                          timeAdjustmentFactor *
                                          material *
                                          (1 + Math.log(triangleCount));
                                        return Math.floor(time);
                                      })()}
                                      h
                                    </div>
                                  </>
                                );
                              }
                            })()}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button
                          onClick={() => {
                            exportChamferedParts({
                              ...chamferedOptions,
                              useTriangulated:
                                chamferedOptions.modelType === "triangle",
                            });
                            setShowChamferedSettings(false);
                          }}
                          className="flex-1 bg-orange-600 hover:bg-orange-700 text-white text-xs py-2 h-8"
                          disabled={isProcessing || !geometry}
                        >
                          Generate Chamfered Parts
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Papercraft Export (Coming Soon) */}
                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-slate-600/50 opacity-60">
                  <div className="flex items-center gap-3">
                    <div className="text-white text-xs">
                      Papercraft export (as pdf)
                    </div>
                    <div className="relative group">
                      <div className="w-4 h-4 bg-blue-500/20 border border-blue-400/30 rounded-full flex items-center justify-center text-blue-300 text-xs font-bold cursor-help">
                        i
                      </div>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 bg-slate-900 border border-blue-400/30 rounded-md text-xs text-white opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-200 z-50">
                        Print out nets of your model with appropriate glue tabs
                        so you can cut, fold, and glue your models into life!
                      </div>
                    </div>
                  </div>
                  <span className="text-blue-300/60 text-xs font-medium bg-blue-500/10 px-2 py-1 rounded">
                    COMING SOON
                  </span>
                </div>

                {!geometry && (
                  <p className="text-xs text-white/50 text-center mt-4">
                    Upload or load a model first to enable exports
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Processing Indicator */}
          {isProcessing && (
            <div className="mt-6 p-3 bg-yellow-500/20 rounded-lg border border-yellow-500/30">
              <div className="text-yellow-300 text-sm font-medium flex items-center">
                <div className="w-4 h-4 border-2 border-yellow-300 border-t-transparent rounded-full animate-spin mr-3"></div>
                Processing model...
              </div>
            </div>
          )}
        </div>

        {/* Export Format Selection Dialog */}
        {false && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-black/90 backdrop-blur-md border border-white/20 rounded-xl p-6 max-w-md w-full mx-4">
              <h3 className="text-white text-lg font-semibold mb-4 text-center">
                Choose Export Format
              </h3>
              <p className="text-white/70 text-sm mb-6 text-center">
                {exportType === "complete"
                  ? "Select format for complete model export:"
                  : "Select format for polygon parts export:"}
              </p>

              <div className="space-y-3">
                {(() => {
                  // Get size estimates based on export type
                  const sizeEstimate =
                    exportType === "complete"
                      ? estimateModelFileSize(geometry)
                      : null;
                  const partsEstimate =
                    exportType === "parts"
                      ? estimatePartsFileSize(
                          geometry,
                          triangleOptions.partThickness,
                          triangleOptions.scale,
                        )
                      : null;

                  return (
                    <>
                      <button
                        onClick={() => exportSTL()}
                        className="w-full p-4 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <Download className="w-5 h-5" />
                          <div className="text-left flex-1">
                            <div className="font-semibold">STL Format</div>
                            <div className="text-sm text-green-100">
                              Best for 3D printing and viewing
                            </div>
                          </div>
                        </div>

                        {/* STL File Size Info */}
                        {geometry && (
                          <div className="mt-2 pt-2 border-t border-green-400/30">
                            <div className="text-xs text-green-100 space-y-1">
                              {exportType === "complete" && sizeEstimate && (
                                <>
                                  <div className="flex justify-between">
                                    <span>���� File size:</span>
                                    <span className="font-mono">
                                      {sizeEstimate.stl.formatted}
                                    </span>
                                  </div>
                                </>
                              )}
                              {exportType === "parts" && partsEstimate && (
                                <>
                                  <div className="flex justify-between">
                                    <span>📦 Total download:</span>
                                    <span className="font-mono">
                                      {partsEstimate.totalFormatted}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>📄 Per part average:</span>
                                    <span className="font-mono">
                                      {partsEstimate.averageFormatted}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>���� Number of files:</span>
                                    <span className="font-mono">
                                      {partsEstimate.partCount}
                                    </span>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </button>
                    </>
                  );
                })()}
              </div>

              <button
                onClick={() => {}}
                className="w-full mt-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Epilepsy Warning Dialog */}
        <AlertDialog
          open={showEpilepsyWarning}
          onOpenChange={setShowEpilepsyWarning}
        >
          <AlertDialogContent className="bg-slate-800 border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                Just a heads up!
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-300">
                The colors feature uses colors that might flash or change
                rapidly based on mouse movement. If you're sensitive to flashing
                lights or have photosensitive epilepsy, you might want to skip
                this one.
                <br />
                <br />
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={handleEpilepsyWarningCancel}
                className="bg-slate-700 text-white hover:bg-slate-600 border-slate-600"
              >
                No thanks, I'll skip it
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleEpilepsyWarningAccept}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                I'm good, let's see those colors!
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}

// Mobile Content Component
function MobileWorkflowContent(props: any) {
  // Get STL context functions directly
  const {
    fileName,
    isLoading,
    loadingProgress,
    geometry,
    loadModelFromFile,
    loadDefaultSTL,
    exportSTL,
    exportOBJ,
    exportParts,
    exportChamferedParts,
    viewerSettings,
    updateViewerSettings,
    getDetailedGeometryStats,
    getDualMeshStats,
    hasBackup,
    restoreFromBackup,
    decimationPainterMode,
    setDecimationPainterMode,
    setHighlightedTriangle,
    hasMergedMesh,
    mergeCoplanarFaces,
    clearMergedMesh,
  } = useSTL();

  // Get other props
  const {
    activeToolMode,
    onToolModeChange,
    onReducePoints,
    isProcessing,
    geometryStats,
    randomColors,
    wireframe,
    autoSpin,
    onRandomColorsChange,
    onWireframeChange,
    onAutoSpinChange,
  } = props;

  const [showBackgroundSettings, setShowBackgroundSettings] = useState(false);
  const [reductionAmount, setReductionAmount] = useState(0.5);
  const [reductionMethod, setReductionMethod] = useState<
    "random_vertex_removal" | "python_vertex_removal" | null
  >(null);
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    upload: false,
    visualization: false,
    tools: false,
    export: false,
  });

  const [showTriangleSettings, setShowTriangleSettings] = useState(false);
  const [triangleOptions, setTriangleOptions] = useState({
    partThickness: 2,
    scale: 1,
    modelType: "merged" as "triangle" | "merged",
  });
  const [showChamferedSettings, setShowChamferedSettings] = useState(false);
  const [chamferedOptions, setChamferedOptions] = useState({
    partThickness: 2,
    scale: 1,
    modelType: "merged" as "triangle" | "merged",
  });

  const [exportType, setExportType] = useState<"complete" | "parts">(
    "complete",
  );

  const [simplificationStats, setSimplificationStats] = useState<{
    originalStats?: any;
    newStats?: any;
    reductionAchieved?: number;
    processingTime?: number;
  }>({});

  // Mobile-specific epilepsy warning state
  const [showEpilepsyWarning, setShowEpilepsyWarning] = useState(false);
  const [hasShownEpilepsyWarning, setHasShownEpilepsyWarning] = useState(false);

  // Check if epilepsy warning has been shown this session (mobile)
  useEffect(() => {
    const warningShown = sessionStorage.getItem("epilepsy_warning_shown");
    if (warningShown === "true") {
      setHasShownEpilepsyWarning(true);
    }
  }, []);

  // Handle colors change with epilepsy warning (mobile)
  const handleColorsChange = (checked: boolean) => {
    try {
      if (checked && !hasShownEpilepsyWarning) {
        setShowEpilepsyWarning(true);
      } else {
        onRandomColorsChange(checked);
      }
    } catch (error) {
      console.error("Error handling colors change:", error);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      loadModelFromFile(file).catch((err) => {
        console.error("����� Upload failed:", err);
        alert(`Upload failed: ${err.message}`);
      });
    }
    event.target.value = "";
  };

  const handleExportClick = (type: "complete" | "parts") => {
    // Directly export STL format
    if (type === "complete") {
      exportSTL();
    } else {
      exportParts({
        ...triangleOptions,
        format: "stl",
        useTriangulated: triangleOptions.modelType === "triangle",
      });
    }
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    try {
      setExpandedSections((prev) => ({
        ...prev,
        [section]: !prev[section],
      }));
    } catch (error) {
      console.error("Error toggling section:", section, error);
    }
  };

  const SectionHeader = ({
    title,
    isExpanded,
    onToggle,
    badge,
  }: {
    title: string;
    isExpanded: boolean;
    onToggle: () => void;
    badge?: string;
  }) => (
    <button
      onClick={onToggle}
      className="flex items-center justify-between w-full text-white text-xs font-medium py-1.5 px-1.5 hover:bg-white/10 rounded-md transition-colors"
    >
      <div className="flex items-center gap-1.5">
        {isExpanded ? (
          <ChevronDown className="w-2.5 h-2.5" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5" />
        )}
        <span className="text-xs">{title}</span>
      </div>
      {badge && (
        <Badge
          variant="secondary"
          className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs px-1 py-0 text-xs"
        >
          {badge}
        </Badge>
      )}
    </button>
  );

  return (
    <div className="space-y-1">
      {/* Compact mobile content with collapsible sections */}

      {/* Enhanced Loading Progress Bar - Compact */}
      {isLoading && (
        <div className="p-1.5 bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 rounded-md">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
            <div className="flex-1">
              <div className="text-xs font-medium text-blue-200">
                {loadingProgress.stage || "Processing"}
              </div>
            </div>
            <div className="text-xs font-mono text-blue-300 bg-blue-500/20 px-1 py-0.5 rounded text-xs">
              {loadingProgress.percentage}%
            </div>
          </div>
          <div className="w-full bg-white/10 rounded-full h-1 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${loadingProgress.percentage}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* 1. UPLOAD SECTION */}
      <div>
        <SectionHeader
          title="1. MESH IMPORT"
          isExpanded={expandedSections.upload}
          onToggle={() => toggleSection("upload")}
          badge={fileName ? "Ready" : "Upload File"}
        />

        {expandedSections.upload && (
          <div className="mt-1 space-y-1.5">
            {/* File Upload - compact for mobile */}
            <div className="relative">
              <input
                type="file"
                accept=".stl,.obj"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                disabled={isLoading}
                title="Upload STL or OBJ file (max 50MB)"
              />
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 relative z-0 h-8 text-xs"
                disabled={isLoading}
                title="Upload STL or OBJ file from your computer"
                type="button"
              >
                <Upload className="w-3 h-3 mr-1" />
                {isLoading ? "Loading..." : "Upload File"}
              </Button>
            </div>

            {/* Random Model - compact for mobile */}
            <Button
              onClick={loadDefaultSTL}
              disabled={isLoading}
              className="w-full border-gray-300 bg-white/10 hover:bg-white/20 text-white font-medium h-7 text-xs"
              variant="outline"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Random Model
            </Button>

            {/* File Info - compact */}
            {fileName && (
              <div className="bg-white/5 rounded-md p-1.5 border border-white/10">
                <div className="flex items-center gap-1 mb-1">
                  <Info className="w-2.5 h-2.5 text-blue-400" />
                  <span className="font-medium text-white text-xs">
                    {fileName}
                  </span>
                </div>
                {(() => {
                  const dualStats = getDualMeshStats();
                  if (!dualStats) return null;

                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {/* Triangulated Model */}
                      <div>
                        <div className="text-xs font-medium text-blue-300 mb-1">
                          Tri
                        </div>
                        <div className="text-xs text-white/70 space-y-0.5">
                          <div>
                            V:{" "}
                            {dualStats.triangulated.vertices?.toLocaleString() ||
                              0}
                          </div>
                          <div>
                            T:{" "}
                            {dualStats.triangulated.triangles?.toLocaleString() ||
                              0}
                          </div>
                        </div>
                      </div>

                      {/* Merged Model */}
                      <div>
                        <div className="text-xs font-medium text-purple-300 mb-1">
                          Merged
                        </div>
                        <div className="text-xs text-white/70 space-y-0.5">
                          <div>
                            V:{" "}
                            {dualStats.merged.vertices?.toLocaleString() || 0}
                          </div>
                          {dualStats.merged.polygonBreakdown
                            ?.slice(0, 2)
                            ?.map(({ type, count }) => (
                              <div key={type}>
                                {type.charAt(0).toUpperCase()}:{" "}
                                {count?.toLocaleString() || 0}
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      <Separator className="bg-white/20 my-0.5" />

      {/* 2. VISUALIZATION SECTION */}
      <div>
        <SectionHeader
          title="2. MESH PREVIEW"
          isExpanded={expandedSections.visualization}
          onToggle={() => toggleSection("visualization")}
        />

        {expandedSections.visualization && (
          <div className="mt-1 space-y-1.5">
            {/* Random Colors - compact for mobile */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-1.5">
                <Palette className="w-3 h-3 text-white/70" />
                <Label
                  htmlFor="colors-mobile"
                  className="text-xs text-white/80"
                >
                  Colors
                </Label>
              </div>
              <Switch
                id="colors-mobile"
                checked={randomColors}
                onCheckedChange={handleColorsChange}
              />
            </div>

            {/* Wireframe - compact for mobile */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-1.5">
                <Eye className="w-3 h-3 text-white/70" />
                <Label
                  htmlFor="wireframe-mobile"
                  className="text-xs text-white/80"
                >
                  Wireframe
                </Label>
              </div>
              <Switch
                id="wireframe-mobile"
                checked={wireframe}
                onCheckedChange={onWireframeChange}
              />
            </div>

            {/* Auto Spin - compact for mobile */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-1.5">
                <RotateCw className="w-3 h-3 text-white/70" />
                <Label
                  htmlFor="auto-spin-mobile"
                  className="text-xs text-white/80"
                >
                  Auto Spin
                </Label>
              </div>
              <Switch
                id="auto-spin-mobile"
                checked={autoSpin}
                onCheckedChange={onAutoSpinChange}
              />
            </div>

            {/* Background Settings - Color Picker Mobile */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Settings className="w-3 h-3 text-white/70" />
                <Label className="text-xs text-white/80">Background</Label>
              </div>
              <div className="relative">
                {/* Current Color Display & Toggle */}
                <button
                  onClick={() => setShowColorPicker(!showColorPicker)}
                  className="flex items-center gap-2 w-full p-2 bg-slate-800/50 rounded-lg border border-slate-600/50 hover:border-slate-500/50 transition-colors"
                >
                  <div
                    className="w-5 h-5 rounded-full border-2 border-white/30 shadow-sm"
                    style={{ backgroundColor: viewerSettings.backgroundColor }}
                  />
                  <span className="text-xs text-white/80 flex-1 text-left">
                    {viewerSettings.backgroundColor}
                  </span>
                  <Palette className="w-3 h-3 text-white/60" />
                </button>

                {/* Color Picker Popover */}
                {showColorPicker && (
                  <>
                    {/* Backdrop */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowColorPicker(false)}
                    />
                    <div className="absolute top-full left-0 mt-2 z-50 bg-slate-900 border border-slate-600 rounded-lg p-3 shadow-xl">
                      <HexColorPicker
                        color={viewerSettings.backgroundColor}
                        onChange={(color) => {
                          updateViewerSettings({ backgroundColor: color });
                        }}
                        style={{ width: "180px", height: "180px" }}
                      />
                      <div className="mt-3 flex justify-between items-center">
                        <input
                          type="text"
                          value={viewerSettings.backgroundColor}
                          onChange={(e) => {
                            const color = e.target.value;
                            if (/^#[0-9A-Fa-f]{6}$/i.test(color)) {
                              updateViewerSettings({ backgroundColor: color });
                            }
                          }}
                          className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white w-20"
                          placeholder="#000000"
                        />
                        <button
                          onClick={() => setShowColorPicker(false)}
                          className="text-white/60 hover:text-white/80 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <Separator className="bg-white/20" />

      {/* 3. TOOLS SECTION */}
      <div>
        <SectionHeader
          title="3. SIMPLIFICATION (in beta)"
          isExpanded={expandedSections.tools}
          onToggle={() => toggleSection("tools")}
        />

        {expandedSections.tools && (
          <div className="mt-4 space-y-4">
            {/* Reduction Settings */}
            <div className="p-4 bg-white/10 rounded-lg border border-white/20">
              <div className="text-white text-base font-medium mb-3">
                Quadric Edge Collapse
              </div>

              {/* Reduction Amount - larger slider for mobile */}
              <div className="mb-4">
                <div className="text-white text-sm mb-3">
                  Target Reduction: {Math.round(reductionAmount * 100)}%
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.1"
                  value={reductionAmount}
                  onChange={(e) =>
                    setReductionAmount(parseFloat(e.target.value))
                  }
                  className="w-full h-3 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                />
                <div className="flex justify-between text-xs text-white/70 mt-2">
                  <span>10%</span>
                  <span>90%</span>
                </div>
              </div>

              <Button
                onClick={() => {
                  console.log(
                    "🔄 Mobile button clicked! Amount:",
                    reductionAmount,
                  );
                  onReducePoints(
                    reductionAmount,
                    "quadric_edge_collapse" as any,
                  );
                }}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white text-base py-3 h-auto"
                disabled={isProcessing}
              >
                🔧 Apply Quadric Decimation
              </Button>

              {/* Mobile Decimation Painter Toggle */}
              <div
                className={`p-3 rounded-lg border transition-all ${
                  decimationPainterMode
                    ? "bg-blue-500/20 border-blue-500/50"
                    : "bg-white/10 border-white/20"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Palette
                      className={`w-4 h-4 ${
                        decimationPainterMode
                          ? "text-blue-300"
                          : "text-blue-400"
                      }`}
                    />
                    <div>
                      <div
                        className={`text-sm font-medium ${
                          decimationPainterMode ? "text-blue-200" : "text-white"
                        }`}
                      >
                        Decimation Painter {decimationPainterMode ? "🎯" : ""}
                      </div>
                      <div className="text-white/60 text-xs">
                        {decimationPainterMode
                          ? "Tap edges to decimate them"
                          : "Tap edges to decimate individual pairs"}
                      </div>
                    </div>
                  </div>
                  <Switch
                    id="decimation-painter-mobile"
                    checked={decimationPainterMode}
                    onCheckedChange={setDecimationPainterMode}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <Separator className="bg-white/20" />

      {/* 4. EXPORT SECTION */}
      <div>
        <SectionHeader
          title="4. FABRICATION EXPORT"
          isExpanded={expandedSections.export}
          onToggle={() => toggleSection("export")}
          badge={geometry ? "Ready" : "No Model"}
        />

        {expandedSections.export && (
          <div className="mt-4 space-y-4">
            {/* Standard Export - larger buttons for mobile */}
            <div>
              <div className="text-white text-sm font-medium mb-3 flex items-center gap-2">
                <Download className="w-4 h-4" />
                Standard Export
              </div>
              <Button
                onClick={() => handleExportClick("complete")}
                disabled={!geometry}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold h-12 text-base"
              >
                <Download className="w-5 h-5 mr-2" />
                Export Complete Model
              </Button>
            </div>

            <Separator className="bg-white/20" />

            {/* Parts Export */}
            <div>
              <div className="text-white text-sm font-medium mb-3 flex items-center gap-2">
                <Package className="w-4 h-4" />
                Polygon Parts Export
              </div>
              <Button
                onClick={() => handleExportClick("parts")}
                disabled={!geometry}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold h-12 text-base"
              >
                <Package className="w-5 h-5 mr-2" />
                Export Polygon Parts
              </Button>
            </div>

            {!geometry && (
              <p className="text-sm text-white/50 text-center mt-4">
                Upload or load a model first to enable exports
              </p>
            )}

            <Separator className="bg-white/20 my-4" />

            {/* Coming Soon Features - Mobile */}
            <div className="space-y-3">
              <div className="text-white text-base font-medium mb-3 text-center opacity-60">
                Coming Soon
              </div>

              {/* Papercraft Export */}
              <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-600/50 opacity-60">
                <div className="flex items-center gap-3">
                  <div className="text-white text-base">
                    Papercraft export (as pdf)
                  </div>
                  <div className="relative group">
                    <div className="w-5 h-5 bg-blue-500/20 border border-blue-400/30 rounded-full flex items-center justify-center text-blue-300 text-sm font-bold cursor-help">
                      i
                    </div>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-900 border border-blue-400/30 rounded-md text-sm text-white opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-200 z-50">
                      Print out nets of your model with appropriate glue tabs so
                      you can cut, fold, and glue your models into life!
                    </div>
                  </div>
                </div>
                <span className="text-blue-300/60 text-sm font-medium bg-blue-500/10 px-3 py-1.5 rounded">
                  COMING SOON
                </span>
              </div>

              {/* 3D Print 'n' Glue */}
              <div className="space-y-3">
                <div className="text-white text-base font-medium mb-2 flex items-center gap-2">
                  <Hammer className="w-4 h-4" />
                  3D Print 'n' Glue Export
                </div>

                <Button
                  onClick={() =>
                    exportChamferedParts({
                      ...chamferedOptions,
                      useTriangulated:
                        chamferedOptions.modelType === "triangle",
                    })
                  }
                  disabled={!geometry}
                  className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold h-12"
                >
                  <Hammer className="w-5 h-5 mr-2" />
                  Export Chamfered Parts
                </Button>

                <p className="text-sm text-white/60">
                  Generate chamfered parts with angled sides that fit together
                  perfectly for easy assembly
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Processing Indicator */}
      {isProcessing && (
        <div className="mt-6 p-4 bg-yellow-500/20 rounded-lg border border-yellow-500/30">
          <div className="text-yellow-300 text-base font-medium flex items-center">
            <div className="w-5 h-5 border-2 border-yellow-300 border-t-transparent rounded-full animate-spin mr-3"></div>
            Processing model...
          </div>
        </div>
      )}

      {/* Coming Soon Features - Mobile */}
      <div className="mt-6 space-y-3">
        <div className="text-white text-base font-medium mb-3 text-center opacity-60">
          Coming Soon
        </div>

        {/* Papercraft Export */}
        <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-600/50 opacity-60">
          <div className="flex items-center gap-3">
            <div className="text-white text-base">
              Papercraft export (as pdf)
            </div>
            <div className="relative group">
              <div className="w-5 h-5 bg-blue-500/20 border border-blue-400/30 rounded-full flex items-center justify-center text-blue-300 text-sm font-bold cursor-help">
                i
              </div>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-900 border border-blue-400/30 rounded-md text-sm text-white opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-200 z-50">
                Print out nets of your model with appropriate glue tabs so you
                can cut, fold, and glue your models into life!
              </div>
            </div>
          </div>
          <span className="text-blue-300/60 text-sm font-medium bg-blue-500/10 px-3 py-1.5 rounded">
            COMING SOON
          </span>
        </div>

        {/* 3D Print 'n' Glue */}
        <div className="space-y-3">
          <div className="text-white text-base font-medium mb-2 flex items-center gap-2">
            <Hammer className="w-4 h-4" />
            3D Print 'n' Glue Export
          </div>

          <Button
            onClick={() =>
              exportChamferedParts({
                ...chamferedOptions,
                useTriangulated: chamferedOptions.modelType === "triangle",
              })
            }
            disabled={!geometry}
            className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold h-12"
          >
            <Hammer className="w-5 h-5 mr-2" />
            Export Chamfered Parts
          </Button>

          <p className="text-sm text-white/60">
            Generate chamfered parts with angled sides that fit together
            perfectly for easy assembly
          </p>
        </div>
      </div>

      {/* Export Format Selection Dialog */}
      {false && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-black/90 backdrop-blur-md border border-white/20 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-white text-lg font-semibold mb-4 text-center">
              Choose Export Format
            </h3>
            <p className="text-white/70 text-sm mb-6 text-center">
              {exportType === "complete"
                ? "Select format for complete model export:"
                : "Select format for polygon parts export:"}
            </p>

            <div className="space-y-3">
              <button
                onClick={() => exportSTL()}
                className="w-full p-4 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center justify-center gap-3"
              >
                <Download className="w-5 h-5" />
                <div className="text-left">
                  <div className="font-semibold">STL Format</div>
                  <div className="text-sm text-green-100">
                    Best for 3D printing and viewing
                  </div>
                </div>
              </button>
            </div>

            <button
              onClick={() => {}}
              className="w-full mt-4 p-3 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors text-base"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
