import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { createServer } from "./server";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Add CORS configuration to prevent websocket issues
    cors: true,
    // Add headers for websocket compatibility
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
    fs: {
      allow: ["./client", "./shared"],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "server/**"],
    },
    hmr: {
      // Configure HMR for cloud environment with WebSocket fixes
      port: 8080,
      clientPort: 8080,
      // Fix WebSocket protocol issues
      protocol: "ws",
      // Disable HMR overlay to prevent WebSocket errors from breaking UI
      overlay: false,
      // Add connection timeout and retry configuration
      timeout: 60000,
      // Use server-sent events as fallback if WebSocket fails
      fallback: true,
    },
    // Add websocket configuration with stability improvements
    watch: {
      usePolling: false,
      interval: 100,
      // Ignore certain files that might cause connection issues
      ignored: ["**/node_modules/**", "**/.git/**"],
    },
    // Add WebSocket keepalive and connection options
    ws: {
      keepAlive: true,
      pingInterval: 30000,
      pongTimeout: 5000,
    },
  },
  build: {
    outDir: "dist/spa",
  },
  plugins: [react(), expressPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
}));

function expressPlugin(): Plugin {
  return {
    name: "express-plugin",
    apply: "serve", // Only apply during development (serve mode)
    configureServer(server) {
      const app = createServer();

      // Add Express app as middleware to Vite dev server
      server.middlewares.use(app);
    },
  };
}
