/**
 * WebGL Error Handler and Fallback System
 * Handles WebGL context creation failures gracefully
 */

import * as THREE from 'three';

export interface WebGLSupport {
  supported: boolean;
  error?: string;
  fallbackReason?: string;
  recommendation?: string;
}

class WebGLErrorHandler {
  private static instance: WebGLErrorHandler;
  private webglSupport: WebGLSupport | null = null;

  static getInstance(): WebGLErrorHandler {
    if (!WebGLErrorHandler.instance) {
      WebGLErrorHandler.instance = new WebGLErrorHandler();
    }
    return WebGLErrorHandler.instance;
  }

  /**
   * Check WebGL support and capabilities
   */
  checkWebGLSupport(): WebGLSupport {
    if (this.webglSupport) {
      return this.webglSupport;
    }

    try {
      // Test basic WebGL availability
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) {
        this.webglSupport = {
          supported: false,
          error: 'WebGL not available',
          fallbackReason: 'Browser does not support WebGL',
          recommendation: 'Please use a modern browser with WebGL support or enable hardware acceleration'
        };
        return this.webglSupport;
      }

      // Test WebGL2 support (preferred)
      const gl2 = canvas.getContext('webgl2');
      
      // Test for common WebGL context issues
      const renderer = new THREE.WebGLRenderer({ 
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: 'default' // Use default instead of high-performance to avoid GPU issues
      });

      // Basic capability check
      const maxTextures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
      const maxVertexAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);

      renderer.dispose();
      
      this.webglSupport = {
        supported: true,
        error: undefined,
        fallbackReason: undefined,
        recommendation: gl2 ? 'WebGL2 supported' : 'WebGL1 supported (limited features)'
      };

      console.log('✅ WebGL Support Check:', {
        webgl1: !!gl,
        webgl2: !!gl2,
        maxTextures,
        maxVertexAttribs
      });

      return this.webglSupport;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown WebGL error';
      
      this.webglSupport = {
        supported: false,
        error: errorMessage,
        fallbackReason: 'WebGL context creation failed',
        recommendation: this.getRecommendationForError(errorMessage)
      };

      console.error('❌ WebGL Support Check Failed:', error);
      return this.webglSupport;
    }
  }

  /**
   * Create a WebGL context with fallback options
   */
  createWebGLContext(canvas: HTMLCanvasElement, options: any = {}): THREE.WebGLRenderer | null {
    try {
      // Try with conservative settings first
      const conservativeOptions = {
        canvas,
        antialias: false,
        alpha: false,
        depth: true,
        stencil: false,
        powerPreference: 'default',
        failIfMajorPerformanceCaveat: false,
        preserveDrawingBuffer: false,
        ...options
      };

      console.log('🔧 Attempting WebGL context creation with conservative settings...');
      const renderer = new THREE.WebGLRenderer(conservativeOptions);
      
      // Test the context
      renderer.getContext();
      console.log('✅ WebGL context created successfully');
      return renderer;

    } catch (error) {
      console.warn('⚠️ Conservative WebGL context failed, trying minimal fallback...', error);
      
      try {
        // Try with minimal settings
        const minimalOptions = {
          canvas,
          antialias: false,
          alpha: false,
          depth: false,
          stencil: false,
          powerPreference: 'low-power',
          failIfMajorPerformanceCaveat: true,
          preserveDrawingBuffer: false
        };

        const fallbackRenderer = new THREE.WebGLRenderer(minimalOptions);
        fallbackRenderer.getContext();
        console.log('✅ Minimal WebGL context created as fallback');
        return fallbackRenderer;

      } catch (fallbackError) {
        console.error('❌ All WebGL context creation attempts failed:', fallbackError);
        return null;
      }
    }
  }

  /**
   * Get specific recommendations based on error type
   */
  private getRecommendationForError(errorMessage: string): string {
    if (errorMessage.includes('closed without opened')) {
      return 'WebSocket connection issue. Try refreshing the page.';
    }
    if (errorMessage.includes('context lost')) {
      return 'Graphics context was lost. Try refreshing the page or restarting your browser.';
    }
    if (errorMessage.includes('insufficient resources')) {
      return 'Not enough GPU memory. Try closing other browser tabs or applications.';
    }
    if (errorMessage.includes('blacklisted')) {
      return 'Graphics driver is blacklisted. Try updating your graphics drivers.';
    }
    
    return 'WebGL is not available. Please ensure hardware acceleration is enabled and your graphics drivers are up to date.';
  }

  /**
   * Handle renderer cleanup on context loss
   */
  handleContextLoss(renderer: THREE.WebGLRenderer) {
    console.warn('🔄 Handling WebGL context loss...');
    
    try {
      renderer.dispose();
      renderer.forceContextLoss();
    } catch (error) {
      console.error('Error during context loss cleanup:', error);
    }
  }

  /**
   * Reset the support check cache
   */
  resetSupportCheck() {
    this.webglSupport = null;
  }
}

export const webglErrorHandler = WebGLErrorHandler.getInstance();
export default webglErrorHandler;
