import React from 'react';
import WebGLCanvas from './WebGLCanvas';

/**
 * Simple test component to verify Canvas functionality
 */
const CanvasTest: React.FC = () => {
  return (
    <div className="w-full h-64 border border-gray-300 rounded">
      <WebGLCanvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        onWebGLError={(error) => {
          console.error('Canvas Test Error:', error);
        }}
      >
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="orange" />
        </mesh>
        <ambientLight intensity={0.5} />
      </WebGLCanvas>
    </div>
  );
};

export default CanvasTest;
