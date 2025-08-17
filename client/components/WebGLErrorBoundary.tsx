import React, { Component, ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class WebGLErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    console.error("🚨 WebGL Error Boundary caught error:", error);
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("🚨 WebGL Error Boundary componentDidCatch:", {
      error: error.message,
      componentStack: errorInfo.componentStack,
      errorBoundary: "WebGLErrorBoundary",
    });

    this.setState({
      error,
      errorInfo,
    });

    // Call the onError callback if provided
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Render fallback UI or the provided fallback component
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center h-full bg-red-50 rounded-lg border-2 border-dashed border-red-300">
          <div className="text-center p-8 max-w-md">
            <div className="text-4xl mb-4">⚠️</div>
            <h3 className="text-lg font-semibold text-red-700 mb-2">
              3D Viewer Error
            </h3>
            <p className="text-red-600 mb-4">
              An error occurred while initializing the 3D viewer.
            </p>
            {this.state.error && (
              <details className="text-sm text-red-500 mb-4">
                <summary className="cursor-pointer font-medium">
                  Error Details
                </summary>
                <div className="mt-2 p-2 bg-red-100 rounded text-left">
                  <p className="font-medium mb-1">Error:</p>
                  <p className="break-words mb-2">{this.state.error.message}</p>
                  {this.state.errorInfo && (
                    <>
                      <p className="font-medium mb-1">Component Stack:</p>
                      <pre className="text-xs overflow-auto max-h-32 bg-red-200 p-1 rounded">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </>
                  )}
                </div>
              </details>
            )}
            <button
              onClick={() => {
                this.setState({
                  hasError: false,
                  error: undefined,
                  errorInfo: undefined,
                });
              }}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default WebGLErrorBoundary;
