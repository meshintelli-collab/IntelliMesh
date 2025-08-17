import React, { useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { webglErrorHandler } from '../lib/utilities/webglErrorHandler';
import WebGLErrorBoundary from './WebGLErrorBoundary';

interface WebGLCanvasProps {
  children: React.ReactNode;
  onWebGLError?: (error: string) => void;
  fallbackComponent?: React.ReactNode;
  [key: string]: any; // Allow passing through Canvas props
}

const WebGLCanvas: React.FC<WebGLCanvasProps> = ({
  children,
  onWebGLError,
  fallbackComponent,
  ...canvasProps
}) => {
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasCriticalError, setHasCriticalError] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    console.log('🚀 WebGLCanvas: Starting WebGL support check...');

    // Check WebGL support on mount
    const support = webglErrorHandler.checkWebGLSupport();

    console.log('📋 WebGL Support Result:', support);

    if (!support.supported) {
      console.error('❌ WebGL not supported, showing fallback UI');
      setWebglSupported(false);
      setError(support.error || 'WebGL not supported');
      onWebGLError?.(support.error || 'WebGL not supported');
    } else {
      console.log('✅ WebGL supported, proceeding with Canvas creation');
      setWebglSupported(true);
    }
  }, [onWebGLError]);

  // Error boundary for WebGL context creation errors
  const handleWebGLError = (error: Error) => {
    console.error('WebGL Canvas Error:', error);
    setWebglSupported(false);
    setError(error.message);
    setHasCriticalError(true);
    onWebGLError?.(error.message);
  };

  // Fallback component when WebGL is not supported
  const WebGLFallback = () => (
    <div className="flex flex-col items-center justify-center h-full bg-gray-100 rounded-lg border-2 border-dashed border-gray-300">
      <div className="text-center p-8 max-w-md">
        <div className="text-4xl mb-4">🖥️</div>
        <h3 className="text-lg font-semibold text-gray-700 mb-2">
          3D Viewer Not Available
        </h3>
        <p className="text-gray-600 mb-4">
          WebGL is required for 3D visualization but is not available on this device.
        </p>
        {error && (
          <details className="text-sm text-gray-500 mb-4">
            <summary className="cursor-pointer font-medium">Technical Details</summary>
            <p className="mt-2 p-2 bg-gray-50 rounded text-left break-words">
              {error}
            </p>
          </details>
        )}
        <div className="text-sm text-gray-500">
          <p className="mb-2">Possible solutions:</p>
          <ul className="text-left space-y-1">
            <li>• Enable hardware acceleration in your browser</li>
            <li>• Update your graphics drivers</li>
            <li>• Try a different browser</li>
            <li>• Use a device with WebGL support</li>
          </ul>
        </div>
      </div>
    </div>
  );

  // Show loading state while checking WebGL support
  if (webglSupported === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Checking 3D support...</p>
        </div>
      </div>
    );
  }

  // Show fallback if WebGL is not supported
  if (!webglSupported) {
    return fallbackComponent || <WebGLFallback />;
  }

  // Render the Canvas with error handling
  try {
    console.log('🎮 Attempting to create Canvas with Three.js...');

    return (
      <WebGLErrorBoundary
        onError={(error, errorInfo) => {
          console.error('❌ WebGL Error Boundary caught error:', error, errorInfo);
          handleWebGLError(error);
        }}
        fallback={fallbackComponent || <WebGLFallback />}
      >
        <Canvas
          ref={canvasRef}
          onCreated={(state) => {
            console.log('✅ Canvas created successfully');

            // Comprehensive WebGL context validation
            if (!state.gl) {
              console.error('❌ No WebGL context in onCreated state');
              handleWebGLError(new Error('No WebGL context provided by @react-three/fiber'));
              return;
            }

            // Check if it's a proper WebGL context
            if (typeof state.gl.getParameter !== 'function') {
              console.error('❌ Invalid WebGL context - missing getParameter method:', {
                gl: state.gl,
                type: typeof state.gl,
                constructor: state.gl.constructor?.name || 'Unknown',
                hasCanvas: 'canvas' in state.gl,
                isContextLost: 'isContextLost' in state.gl ? state.gl.isContextLost() : 'Not available'
              });
              handleWebGLError(new Error('Invalid WebGL context: getParameter method not available'));
              return;
            }

            // Check if context is lost
            if (state.gl.isContextLost && state.gl.isContextLost()) {
              console.error('❌ WebGL context is lost in onCreated');
              handleWebGLError(new Error('WebGL context was lost'));
              return;
            }

            // Safe parameter retrieval with error handling
            try {
              const webglInfo = {
                contextLost: state.gl.isContextLost ? state.gl.isContextLost() : 'Unknown'
              };

              // Safely get renderer info
              try {
                webglInfo.renderer = state.gl.getParameter(state.gl.RENDERER);
              } catch (e) {
                webglInfo.renderer = 'Failed to retrieve';
                console.warn('Could not get RENDERER parameter:', e);
              }

              try {
                webglInfo.vendor = state.gl.getParameter(state.gl.VENDOR);
              } catch (e) {
                webglInfo.vendor = 'Failed to retrieve';
                console.warn('Could not get VENDOR parameter:', e);
              }

              try {
                webglInfo.version = state.gl.getParameter(state.gl.VERSION);
              } catch (e) {
                webglInfo.version = 'Failed to retrieve';
                console.warn('Could not get VERSION parameter:', e);
              }

              console.log('📊 WebGL Info:', webglInfo);
            } catch (error) {
              console.error('❌ Error getting WebGL parameters:', error);
              handleWebGLError(error instanceof Error ? error : new Error('Failed to get WebGL parameters'));
            }
          }}
          onError={(error) => {
            console.error('❌ Canvas onError callback triggered:', error);
            handleWebGLError(error);
          }}
          dpr={1} // Force device pixel ratio to 1 to reduce complexity
          gl={{
            antialias: false,
            alpha: false,
            depth: true,
            stencil: false,
            powerPreference: 'default',
            failIfMajorPerformanceCaveat: false,
            preserveDrawingBuffer: false,
          }}
          {...canvasProps}
        >
          {children}
        </Canvas>
      </WebGLErrorBoundary>
    );
  } catch (error) {
    console.error('❌ Canvas creation threw exception:', error);
    handleWebGLError(error instanceof Error ? error : new Error('Canvas creation failed'));
    return fallbackComponent || <WebGLFallback />;
  }
};

export default WebGLCanvas;
