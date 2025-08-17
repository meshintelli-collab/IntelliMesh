import React, { useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { webglErrorHandler } from '../lib/utilities/webglErrorHandler';
import WebGLErrorBoundary from './WebGLErrorBoundary';
import EmergencyWebGLFallback from './EmergencyWebGLFallback';

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
  const [useMinimalFallback, setUseMinimalFallback] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Quick WebGL support check
    const support = webglErrorHandler.checkWebGLSupport();

    if (!support.supported) {
      setWebglSupported(false);
      setError(support.error || 'WebGL not supported');
      onWebGLError?.(support.error || 'WebGL not supported');
    } else {
      setWebglSupported(true);
    }
  }, [onWebGLError]);

  // Error boundary for WebGL context creation errors
  const handleWebGLError = (error: Error) => {
    console.error('WebGL Canvas Error:', error);

    // Try minimal fallback first before giving up completely
    if (!useMinimalFallback) {
      console.log('🔄 Attempting minimal Canvas fallback...');
      setUseMinimalFallback(true);
      return;
    }

    // If minimal fallback also failed, show full error
    console.error('❌ All Canvas fallbacks failed');
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

  // Show fallback if WebGL is not supported or critical error occurred
  if (!webglSupported || hasCriticalError) {
    return fallbackComponent || <WebGLFallback />;
  }

  // Try minimal Canvas fallback if requested
  if (useMinimalFallback) {
    console.log('🎮 Using minimal Canvas fallback approach...');
    return (
      <EmergencyWebGLFallback>
        <Canvas
          dpr={1}
          gl={{
            antialias: false,
            alpha: false,
            depth: true, // Enable depth for 3D rendering
            stencil: false,
            powerPreference: 'default',
            failIfMajorPerformanceCaveat: false,
            preserveDrawingBuffer: false,
            precision: 'lowp',
          }}
          onCreated={() => {
            console.log('✅ Minimal Canvas fallback successful');
            setUseMinimalFallback(false); // Success, so we can use this approach
          }}
          onError={(error) => {
            console.error('❌ Minimal Canvas fallback failed:', error);
            setTimeout(() => {
              handleWebGLError(error);
            }, 0);
          }}
          {...canvasProps}
        >
          {children}
        </Canvas>
      </EmergencyWebGLFallback>
    );
  }

  // Render the Canvas with comprehensive error handling
  return (
    <EmergencyWebGLFallback>
      {(() => {
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
                  // Very simple validation - just log success
                  console.log('✅ Canvas created successfully');

                  // Optional: Try to get basic info without causing errors
                  try {
                    if (state.gl && typeof state.gl.getParameter === 'function') {
                      const version = state.gl.getParameter(state.gl.VERSION);
                      console.log('📊 WebGL Version:', version);
                    }
                  } catch (e) {
                    // Silently ignore validation errors
                    console.log('🎮 Canvas running without WebGL parameter access');
                  }
                }}
                onError={(error) => {
                  console.warn('⚠️ Canvas onError callback triggered:', error);
                  // Don't immediately trigger state updates that could cause issues
                  console.log('🎮 Canvas error handled gracefully, continuing operation');
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
                  logarithmicDepthBuffer: false,
                  precision: 'lowp',
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
      })()}
    </EmergencyWebGLFallback>
  );
};

export default WebGLCanvas;
