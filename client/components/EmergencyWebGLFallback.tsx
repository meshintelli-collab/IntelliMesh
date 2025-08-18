import React, { Component, ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

/**
 * Emergency fallback component that catches ANY error related to WebGL/Canvas rendering
 * This is the absolute last line of defense before the entire app crashes
 */
class EmergencyWebGLFallback extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: "",
    };
  }

  static getDerivedStateFromError(error: Error): State {
    console.error("🚨 EMERGENCY: WebGL fallback caught critical error:", error);

    return {
      hasError: true,
      errorMessage: error.message,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("🚨 EMERGENCY: Full error details:", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      errorBoundary: "EmergencyWebGLFallback",
    });

    // Try to capture additional context
    try {
      const userAgent = navigator.userAgent;
      const webglSupport = !!window.WebGLRenderingContext;
      const webgl2Support = !!window.WebGL2RenderingContext;

      console.error("🚨 EMERGENCY: Browser context:", {
        userAgent,
        webglSupport,
        webgl2Support,
        hardwareConcurrency: navigator.hardwareConcurrency,
        platform: navigator.platform,
      });
    } catch (e) {
      console.error("Could not capture browser context:", e);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-orange-50 rounded-lg border-2 border-dashed border-orange-300">
          <div className="text-center p-8 max-w-md">
            <div className="text-4xl mb-4">🚨</div>
            <h3 className="text-lg font-semibold text-orange-700 mb-2">
              Critical 3D Viewer Error
            </h3>
            <p className="text-orange-600 mb-4">
              A critical error occurred that prevented the 3D viewer from
              starting. This is likely due to graphics driver or hardware
              compatibility issues.
            </p>
            <details className="text-sm text-orange-500 mb-4">
              <summary className="cursor-pointer font-medium">
                Technical Error
              </summary>
              <div className="mt-2 p-2 bg-orange-100 rounded text-left">
                <p className="font-medium mb-1">Error:</p>
                <p className="break-words">{this.state.errorMessage}</p>
              </div>
            </details>
            <div className="text-sm text-orange-500">
              <p className="mb-2">Emergency recovery steps:</p>
              <ul className="text-left space-y-1">
                <li>• Try refreshing the page</li>
                <li>• Update your graphics drivers</li>
                <li>• Try a different browser (Chrome, Firefox, Edge)</li>
                <li>• Enable hardware acceleration in browser settings</li>
                <li>• Restart your browser</li>
                <li>• Use a device with WebGL support</li>
              </ul>
            </div>
            <button
              onClick={() => {
                console.log("🔄 Emergency fallback: Attempting recovery...");
                this.setState({ hasError: false, errorMessage: "" });
              }}
              className="mt-4 px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
            >
              Try Recovery
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default EmergencyWebGLFallback;
