import React from "react";
import { Canvas } from "@react-three/fiber";

/**
 * Minimal WebGL test component that bypasses complex validation
 * Used to test if basic Canvas rendering works
 */
export const MinimalWebGLTest: React.FC = () => {
  return (
    <div className="w-full h-full">
      <Canvas
        dpr={1}
        gl={{
          antialias: false,
          alpha: false,
          depth: false,
          stencil: false,
          powerPreference: "default",
          failIfMajorPerformanceCaveat: false,
          preserveDrawingBuffer: false,
          precision: "lowp",
        }}
        camera={{ position: [0, 0, 5] }}
        onCreated={() => {
          console.log("✅ Minimal Canvas test successful");
        }}
        onError={(error) => {
          console.error("❌ Minimal Canvas test failed:", error);
        }}
      >
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="orange" />
        </mesh>
        <ambientLight intensity={0.5} />
      </Canvas>
    </div>
  );
};

export default MinimalWebGLTest;
