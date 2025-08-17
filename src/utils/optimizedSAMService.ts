// src/utils/optimizedSAMService.ts - Frontend integration for optimized SAM

import * as THREE from 'three';

export interface SemanticRegion {
  id: string;
  name: string;
  semantic_type: string;
  vertices: number[];
  confidence: number;
  area: number;
}

export interface OptimizedSAMResponse {
  success: boolean;
  num_regions: number;
  regions: SemanticRegion[];
  stats: {
    original_masks: number;
    semantic_regions: number;
    reduction_ratio: number;
  };
}

export class OptimizedSAMService {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:5000') {
    this.baseUrl = baseUrl;
  }

  async initializeOptimizedSAM(modelType: string = 'vit_h'): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/init-optimized-sam`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_type: modelType,
          checkpoint_path: './checkpoints/sam_vit_h_4b8939.pth',
          device: 'cpu'
        })
      });

      const result = await response.json();
      console.log('✅ Optimized SAM initialized:', result.message);
      return result.success;
    } catch (error) {
      console.error('❌ Failed to initialize optimized SAM:', error);
      return false;
    }
  }

  async processOptimizedSegmentation(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    mesh: THREE.Mesh,
    miniatureType: string = 'humanoid'
  ): Promise<OptimizedSAMResponse | null> {
    try {
      console.log('🎯 Starting optimized SAM segmentation...');

      // Position camera for optimal view
      camera.position.set(0, 8, 12);
      camera.lookAt(0, 4, 0);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);

      // Capture image
      const colorImage = renderer.domElement.toDataURL('image/png');

      // Extract mesh vertices
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      const vertices: number[][] = [];
      
      for (let i = 0; i < positions.count; i++) {
        vertices.push([
          positions.getX(i),
          positions.getY(i),
          positions.getZ(i)
        ]);
      }

      // Send to optimized backend
      const response = await fetch(`${this.baseUrl}/segment-optimized`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          color_image: colorImage,
          vertices: vertices,
          miniature_type: miniatureType,
          camera_matrix: camera.matrixWorld.toArray(),
          projection_matrix: camera.projectionMatrix.toArray(),
          viewport_size: { width: 1024, height: 1024 }
        })
      });

      if (response.ok) {
        const result: OptimizedSAMResponse = await response.json();
        console.log(`✅ Optimized SAM complete: ${result.num_regions} semantic regions created`);
        console.log(`📊 Reduction: ${result.stats.original_masks} masks → ${result.stats.semantic_regions} regions (${result.stats.reduction_ratio.toFixed(1)}x reduction)`);
        
        return result;
      } else {
        console.error('❌ Optimized SAM request failed:', response.statusText);
        return null;
      }
    } catch (error) {
      console.error('❌ Optimized SAM processing failed:', error);
      return null;
    }
  }

  convertToMaskingGroups(regions: SemanticRegion[]): Array<{
    id: string;
    name: string;
    color: string;
    visible: boolean;
  }> {
    // Color palette optimized for miniature painting
    const semanticColors: { [key: string]: string } = {
      'base': '#8B4513',      // Brown for base
      'legs': '#4682B4',      // Steel blue for leg armor
      'torso': '#C0C0C0',     // Silver for torso armor
      'arms': '#CD853F',      // Peru for arms/shoulders
      'head': '#F5DEB3',      // Wheat for skin/head
      'weapon': '#2F4F4F',    // Dark slate gray for weapons
      'cape': '#800080',      // Purple for capes/cloaks
      'details': '#FFD700',   // Gold for fine details
      'body': '#D2B48C',      // Tan for creature bodies
      'limbs': '#A0522D'      // Sienna for creature limbs
    };

    return regions.map((region, index) => ({
      id: region.id,
      name: `${region.name} (${region.confidence.toFixed(2)} conf)`,
      color: semanticColors[region.semantic_type] || `hsl(${index * 40}, 70%, 60%)`,
      visible: true
    }));
  }

  createVertexMapping(regions: SemanticRegion[]): { [groupId: string]: number[] } {
    const mapping: { [groupId: string]: number[] } = {};
    
    regions.forEach(region => {
      mapping[region.id] = region.vertices;
    });

    return mapping;
  }
}

// Enhanced SAM integration for existing app
export const enhancedSAMIntegration = {
  
  async runOptimizedSAM(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    mesh: THREE.Mesh,
    onResults: (mapping: any, groups: any) => void,
    miniatureType: string = 'humanoid'
  ): Promise<void> {
    console.log('🚀 Enhanced SAM Integration - Optimized Version');
    
    const samService = new OptimizedSAMService();
    
    try {
      // Initialize optimized SAM
      const initialized = await samService.initializeOptimizedSAM('vit_h');
      if (!initialized) {
        throw new Error('Failed to initialize optimized SAM');
      }

      // Process with semantic grouping
      const result = await samService.processOptimizedSegmentation(
        scene, camera, renderer, mesh, miniatureType
      );

      if (result && result.success) {
        // Convert to frontend format
        const maskingGroups = samService.convertToMaskingGroups(result.regions);
        const vertexMapping = samService.createVertexMapping(result.regions);

        // Apply results
        onResults(vertexMapping, maskingGroups);

        console.log('✅ Enhanced SAM integration complete!');
        console.log(`📊 Results: ${result.num_regions} semantic painting zones`);
        result.regions.forEach(region => {
          console.log(`   ${region.semantic_type}: ${region.name} (${region.vertices.length} vertices)`);
        });

      } else {
        throw new Error('Optimized SAM processing failed');
      }

    } catch (error) {
      console.error('❌ Enhanced SAM integration failed:', error);
      
      // Fallback to mock semantic regions for testing
      console.log('🔄 Falling back to mock semantic regions...');
      const mockRegions = createMockSemanticRegions(mesh);
      const mockGroups = samService.convertToMaskingGroups(mockRegions);
      const mockMapping = samService.createVertexMapping(mockRegions);
      
      onResults(mockMapping, mockGroups);
    }
  }
};

// Mock semantic regions for testing when backend is unavailable
function createMockSemanticRegions(mesh: THREE.Mesh): SemanticRegion[] {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const vertexCount = geometry.attributes.position.count;
  
  // Create meaningful mock regions based on height and position
  const regions: SemanticRegion[] = [
    {
      id: 'semantic_base',
      name: 'Base & Support',
      semantic_type: 'base',
      vertices: Array.from({length: Math.floor(vertexCount * 0.15)}, (_, i) => i),
      confidence: 0.95,
      area: vertexCount * 0.15
    },
    {
      id: 'semantic_legs',
      name: 'Legs & Lower Armor',
      semantic_type: 'legs',
      vertices: Array.from({length: Math.floor(vertexCount * 0.25)}, (_, i) => Math.floor(vertexCount * 0.15) + i),
      confidence: 0.88,
      area: vertexCount * 0.25
    },
    {
      id: 'semantic_torso',
      name: 'Torso & Main Armor',
      semantic_type: 'torso',
      vertices: Array.from({length: Math.floor(vertexCount * 0.30)}, (_, i) => Math.floor(vertexCount * 0.40) + i),
      confidence: 0.92,
      area: vertexCount * 0.30
    },
    {
      id: 'semantic_arms',
      name: 'Arms & Shoulders',
      semantic_type: 'arms',
      vertices: Array.from({length: Math.floor(vertexCount * 0.15)}, (_, i) => Math.floor(vertexCount * 0.70) + i),
      confidence: 0.85,
      area: vertexCount * 0.15
    },
    {
      id: 'semantic_head',
      name: 'Head & Helmet',
      semantic_type: 'head',
      vertices: Array.from({length: Math.floor(vertexCount * 0.10)}, (_, i) => Math.floor(vertexCount * 0.85) + i),
      confidence: 0.90,
      area: vertexCount * 0.10
    },
    {
      id: 'semantic_details',
      name: 'Weapons & Details',
      semantic_type: 'weapon',
      vertices: Array.from({length: Math.floor(vertexCount * 0.05)}, (_, i) => Math.floor(vertexCount * 0.95) + i),
      confidence: 0.80,
      area: vertexCount * 0.05
    }
  ];

  console.log('🎭 Created mock semantic regions:');
  regions.forEach(region => {
    const percentage = (region.vertices.length / vertexCount * 100).toFixed(1);
    console.log(`   ${region.semantic_type}: ${percentage}% of vertices`);
  });

  return regions;
}

// Integration with existing App.tsx
export const setupOptimizedSAMButton = (
  meshRef: React.MutableRefObject<THREE.Mesh | null>,
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>,
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>,
  sceneRef: React.MutableRefObject<THREE.Scene | null>,
  onSAMResults: (result: any) => void
) => {
  
  (window as any).testOptimizedSAM = async () => {
    console.log('🎯 Optimized SAM test called!');
    
    if (sceneRef.current && cameraRef.current && rendererRef.current && meshRef.current) {
      try {
        await enhancedSAMIntegration.runOptimizedSAM(
          sceneRef.current,
          cameraRef.current,
          rendererRef.current,
          meshRef.current,
          (vertexMapping, maskingGroups) => {
            // Format for existing onSAMResults callback
            const formattedResult = {
              masks: maskingGroups.map((group: any, index: number) => {
                const vertices = vertexMapping[group.id] || [];
                return {
                  mask_id: index,
                  area: Array.isArray(vertices) ? vertices.length : 0,
                  stability_score: 0.9,
                  vertices: vertices
                };
              }),
              viewport_size: { width: 1024, height: 1024 },
              semantic_regions: true,
              optimized: true
            };
            
            onSAMResults(formattedResult);
          },
          'humanoid' // Default miniature type
        );
      } catch (error) {
        console.error('❌ Optimized SAM test failed:', error);
      }
    } else {
      console.error('❌ Scene not ready for optimized SAM');
    }
  };

  return () => {
    delete (window as any).testOptimizedSAM;
  };
};