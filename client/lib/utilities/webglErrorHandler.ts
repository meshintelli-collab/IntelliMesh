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
        console.error('❌ WebGL context missing getParameter method');
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
        console.error('❌ WebGL context is lost immediately after creation');
        this.webglSupport = {
          supported: false,
          error: 'WebGL context lost immediately',
          fallbackReason: 'Graphics hardware or driver issue',
          recommendation: 'Update graphics drivers or restart browser'
        };
        return this.webglSupport;
      }

      // Step 4: Test basic WebGL capabilities
      console.log('🔧 Testing WebGL capabilities...');
      const maxTextures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
      const maxVertexAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
      const vendor = gl.getParameter(gl.VENDOR);
      const renderer = gl.getParameter(gl.RENDERER);

      console.log('📊 WebGL Info:', {
        vendor,
        renderer,
        maxTextures,
        maxVertexAttribs
      });

      // Step 5: Test THREE.js WebGLRenderer creation with minimal settings
      console.log('🎮 Testing THREE.js WebGLRenderer creation...');
      let threeRenderer: THREE.WebGLRenderer | null = null;

      try {
        threeRenderer = new THREE.WebGLRenderer({
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

        console.log('✅ THREE.js WebGLRenderer created successfully');

        // Test basic rendering capability and context validity
        threeRenderer.setSize(1, 1);

        // Test if the renderer context is valid
        const rendererGL = threeRenderer.getContext();
        if (!rendererGL || typeof rendererGL.getParameter !== 'function') {
          throw new Error('THREE.js WebGLRenderer created invalid context');
        }

        // Test basic GL operations
        try {
          rendererGL.getParameter(rendererGL.VERSION);
          threeRenderer.clear();
        } catch (glError) {
          throw new Error(`WebGL context operations failed: ${glError instanceof Error ? glError.message : 'Unknown GL error'}`);
        }

        threeRenderer.dispose();

      } catch (rendererError) {
        console.error('❌ THREE.js WebGLRenderer creation failed:', rendererError);

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

      console.log('✅ WebGL Support Check PASSED - fully supported');
      return this.webglSupport;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown WebGL error';

      console.error('❌ WebGL Support Check FAILED:', error);

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
