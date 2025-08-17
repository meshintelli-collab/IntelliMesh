import React from "react";
import { Canvas } from "@react-three/fiber";

interface SimpleCanvasProps {
  children: React.ReactNode;
  [key: string]: any;
}

/**
 * Simple Canvas wrapper that avoids all WebGL validation and complex error handling
 * This is the most basic Canvas implementation possible
 */
const SimpleCanvas: React.FC<SimpleCanvasProps> = ({ children, ...props }) => {
  try {
    return (
      <Canvas
        dpr={1}
        gl={{
          antialias: false,
          powerPreference: "default",
        }}
        onCreated={() => {
          console.log("Simple Canvas created");
        }}
        {...props}
      >
        {children}
      </Canvas>
    );
  } catch (error) {
    console.error("Simple Canvas failed:", error);
    return (
      <div className="flex items-center justify-center h-full bg-gray-100 rounded-lg">
        <p className="text-gray-600">3D viewer unavailable</p>
      </div>
    );
  }
};

export default SimpleCanvas;
