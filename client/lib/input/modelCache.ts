import * as THREE from 'three';
import { PolygonGeometryBuilder } from './polygonGeometryBuilder';
import { OBJConverter } from './objConverter';

/**
 * Model cache system for pre-generated procedural models
 * Saves models as OBJ strings to preserve polygon structure
 */
export class ModelCache {
  private static cache = new Map<string, { objString: string; geometry: THREE.BufferGeometry }>();
  
  /**
   * Pre-generate all random models and cache them as OBJ
   */
  static initializeCache(): void {

    const models = this.getModelDefinitions();
    let successCount = 0;
    let failureCount = 0;

    models.forEach(model => {
      try {
        // Generate geometry
        const polygonGeometry = model.generator();
        const bufferGeometry = PolygonGeometryBuilder.toBufferGeometry(polygonGeometry);

        // Validate geometry before conversion
        if (!bufferGeometry.attributes.position || bufferGeometry.attributes.position.count === 0) {
          throw new Error(`Generated geometry has no vertices`);
        }

        // Convert to OBJ to preserve polygon structure
        const objResult = OBJConverter.geometryToOBJ(bufferGeometry, model.name);

        // Cache both OBJ string and geometry
        this.cache.set(model.name, {
          objString: objResult.objString,
          geometry: bufferGeometry.clone()
        });

        successCount++;
      } catch (error) {
        failureCount++;
        console.error(`❌ Failed to cache ${model.name}:`, error);
        // Continue with other models instead of failing completely
      }
    });


    // If no models cached successfully, fall back to simple shapes
    if (this.cache.size === 0) {
      console.warn('⚠️ No models cached successfully, creating fallback models');
      this.createFallbackModels();
    }
  }
  
  /**
   * Get a random model from cache
   */
  static getRandomModel(): { name: string; geometry: THREE.BufferGeometry; objString: string } | null {
    if (this.cache.size === 0) {
      console.warn('Model cache not initialized, generating on demand');
      this.initializeCache();
    }
    
    const modelNames = Array.from(this.cache.keys());
    const randomName = modelNames[Math.floor(Math.random() * modelNames.length)];
    const cached = this.cache.get(randomName);
    
    if (!cached) return null;
    
    return {
      name: randomName,
      geometry: cached.geometry.clone(), // Clone to avoid mutations
      objString: cached.objString
    };
  }
  
  /**
   * Get specific model from cache
   */
  static getModel(name: string): { geometry: THREE.BufferGeometry; objString: string } | null {
    const cached = this.cache.get(name);
    if (!cached) return null;
    
    return {
      geometry: cached.geometry.clone(),
      objString: cached.objString
    };
  }
  
  /**
   * Get all available model names
   */
  static getAvailableModels(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Create simple fallback models if complex models fail
   */
  private static createFallbackModels(): void {

    try {
      // Simple cube - this should always work
      const cubeGeometry = PolygonGeometryBuilder.toBufferGeometry(
        PolygonGeometryBuilder.createBoxWithQuads(20, 20, 20)
      );

      if (cubeGeometry.attributes.position && cubeGeometry.attributes.position.count > 0) {
        const objResult = OBJConverter.geometryToOBJ(cubeGeometry, 'fallback-cube.stl');
        this.cache.set('fallback-cube.stl', {
          objString: objResult.objString,
          geometry: cubeGeometry.clone()
        });
      }
    } catch (error) {
      console.error('❌ Even fallback models failed:', error);
    }
  }

  /**
   * Define all the random models to cache (testing with just cube first)
   */
  private static getModelDefinitions() {
    return [
      // Just test with the absolute simplest case first
      {
        name: 'cube-polygon.stl',
        generator: () => PolygonGeometryBuilder.createBoxWithQuads(20, 20, 20)
      }
    ];
  }
}
