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

  // Simple error handler
  const handleWebGLError = (error: Error) => {
    setWebglSupported(false);
    setError(error.message);
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

  // Render the Canvas with minimal error handling
  try {
    return (
      <WebGLErrorBoundary
        onError={(error) => {
          setWebglSupported(false);
          setError(error.message);
        }}
        fallback={fallbackComponent || <WebGLFallback />}
      >
        <Canvas
          ref={canvasRef}
          onCreated={() => {
            // Minimal success indication
          }}
          onError={(error) => {
            setWebglSupported(false);
            setError(error.message);
          }}
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
    return fallbackComponent || <WebGLFallback />;
  }
};

export default WebGLCanvas;
