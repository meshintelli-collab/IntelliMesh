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
   * Check WebGL support and capabilities (cached)
   */
  checkWebGLSupport(): WebGLSupport {
    if (this.webglSupport) {
      return this.webglSupport;
    }

    try {
      // Step 1: Check if WebGL is even available in the browser
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;

      let gl: WebGLRenderingContext | null = null;

      // Try different WebGL context types
      const contextTypes = ['webgl2', 'webgl', 'experimental-webgl'];
      for (const contextType of contextTypes) {
        try {
          gl = canvas.getContext(contextType as any, {
            failIfMajorPerformanceCaveat: false,
            antialias: false,
            alpha: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
            powerPreference: 'default'
          }) as WebGLRenderingContext;

          if (gl) {
            break;
          }
        } catch (contextError) {
          // Silently continue to next context type
        }
      }

      if (!gl) {
        this.webglSupport = {
          supported: false,
          error: 'WebGL not available - no context could be created',
          fallbackReason: 'Browser does not support WebGL or WebGL is disabled',
          recommendation: 'Enable WebGL in browser settings or try a different browser'
        };
        return this.webglSupport;
      }

      // Step 2: Validate context methods are available
      if (typeof gl.getParameter !== 'function') {
        this.webglSupport = {
          supported: false,
          error: 'WebGL context incomplete - missing core methods',
          fallbackReason: 'WebGL implementation is incomplete or corrupted',
          recommendation: 'Try refreshing the page or using a different browser'
        };
        return this.webglSupport;
      }

      // Step 3: Check for context loss immediately
      if (gl.isContextLost && gl.isContextLost()) {
        this.webglSupport = {
          supported: false,
          error: 'WebGL context lost immediately',
          fallbackReason: 'Graphics hardware or driver issue',
          recommendation: 'Update graphics drivers or restart browser'
        };
        return this.webglSupport;
      }

      // Step 4: Quick capability test
      try {
        gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
      } catch (e) {
        this.webglSupport = {
          supported: false,
          error: 'WebGL parameter access failed',
          fallbackReason: 'WebGL context not fully functional',
          recommendation: 'Try refreshing the page or updating graphics drivers'
        };
        return this.webglSupport;
      }

      // Step 5: Quick THREE.js test
      try {
        const threeRenderer = new THREE.WebGLRenderer({
          canvas,
          context: gl,
          antialias: false,
          alpha: false,
          depth: false,
          stencil: false,
          powerPreference: 'default',
          failIfMajorPerformanceCaveat: false,
          preserveDrawingBuffer: false
        });

        threeRenderer.setSize(1, 1);
        threeRenderer.dispose();

      } catch (rendererError) {

        this.webglSupport = {
          supported: false,
          error: `THREE.js WebGLRenderer failed: ${rendererError instanceof Error ? rendererError.message : 'Unknown error'}`,
          fallbackReason: 'THREE.js cannot create WebGL renderer',
          recommendation: this.getRecommendationForError(rendererError instanceof Error ? rendererError.message : 'Unknown error')
        };
        return this.webglSupport;
      }

      this.webglSupport = {
        supported: true,
        error: undefined,
        fallbackReason: undefined,
        recommendation: 'WebGL fully supported'
      };

      return this.webglSupport;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown WebGL error';

      this.webglSupport = {
        supported: false,
        error: errorMessage,
        fallbackReason: 'Unexpected error during WebGL testing',
        recommendation: this.getRecommendationForError(errorMessage)
      };

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

      const renderer = new THREE.WebGLRenderer(conservativeOptions);
      renderer.getContext();
      return renderer;

    } catch (error) {
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
        return fallbackRenderer;

      } catch (fallbackError) {
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
