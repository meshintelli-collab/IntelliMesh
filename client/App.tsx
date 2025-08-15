import "./global.css";

import { Toaster } from "@/components/ui/toaster";

// Type declaration for root tracking
declare global {
  interface HTMLElement {
    _reactRoot?: any;
  }
}
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { STLProvider } from "./context/STLContext";
import { STLErrorBoundary } from "./components/ErrorBoundary";
import Index from "./pages/Index";
import About from "./pages/About";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <STLErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <STLProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/about" element={<About />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </STLProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </STLErrorBoundary>
);

// Ensure createRoot is only called once to prevent double mounting warnings
// Ensure createRoot is only called once to prevent double mounting warnings
const rootElement = document.getElementById("root")!;
if (!rootElement._reactRoot) {
  const root = createRoot(rootElement);
  rootElement._reactRoot = root;
  root.render(<App />);
} else {
  rootElement._reactRoot.render(<App />);
}
