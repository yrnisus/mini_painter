// src/utils/enhanced-sam-service.ts - Enhanced SAM Service with Multi-view Processing
import * as THREE from 'three';

// Types for the new SAM system
export interface SuperPoint {
  id: number;
  vertices: number[];
  centroid: [number, number, number];
  normal: [number, number, number];
  curvature: number;
  area: number;
  neighbors: number[];
}

export interface CameraView {
  id: number;
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  view_matrix: number[][];
  fov: number;
  aspect: number;
  near: number;
  far: number;
}

export interface SuperPointAssignment {
  superpoint_id: number;
  assigned_masks: string[];
  num_masks: number;
  vertices: number[];
}

export interface MeshAnalysisResult {
  status: string;
  superpoints: SuperPoint[];
  camera_views: CameraView[];
  stats: {
    num_superpoints: number;
    avg_vertices_per_superpoint: number;
    num_camera_views: number;
  };
}

export interface SAMProcessingResult {
  status: string;
  assignments: SuperPointAssignment[];
  stats: {
    total_views_processed: number;
    total_masks_generated: number;
    total_masks_assigned: number;
    assignment_efficiency: number;
    superpoints_with_assignments: number;
  };
}

export class EnhancedSAMService {
  private baseUrl: string;
  private isInitialized: boolean = false;

  constructor(baseUrl: string = 'http://localhost:5000') {
    this.baseUrl = baseUrl;
  }

  async initialize(modelType: string = 'vit_h'): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/init-sam`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_type: modelType,
          checkpoint_path: './checkpoints/sam_vit_h_4b8939.pth',
          device: 'cpu'
        }),
      });

      const result = await response.json();
      this.isInitialized = result.status === 'success';
      
      if (!this.isInitialized) {
        console.error('SAM initialization failed:', result.message);
      }
      
      return this.isInitialized;
    } catch (error) {
      console.error('SAM initialization error:', error);
      return false;
    }
  }

  async analyzeMesh(
    vertices: Float32Array, 
    faces: Uint32Array
  ): Promise<MeshAnalysisResult | null> {
    if (!this.isInitialized) {
      throw new Error('SAM service not initialized');
    }

    try {
      // Convert arrays to regular arrays for JSON serialization
      const verticesArray = Array.from(vertices);
      const facesArray = Array.from(faces);

      // Reshape vertices array to N×3 format
      const reshapedVertices = [];
      for (let i = 0; i < verticesArray.length; i += 3) {
        reshapedVertices.push([
          verticesArray[i],
          verticesArray[i + 1],
          verticesArray[i + 2]
        ]);
      }

      // Reshape faces array to N×3 format
      const reshapedFaces = [];
      for (let i = 0; i < facesArray.length; i += 3) {
        reshapedFaces.push([
          facesArray[i],
          facesArray[i + 1],
          facesArray[i + 2]
        ]);
      }

      const response = await fetch(`${this.baseUrl}/analyze-mesh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vertices: reshapedVertices,
          faces: reshapedFaces
        }),
      });

      const result = await response.json();
      
      if (result.status === 'success') {
        console.log(`Mesh analysis complete: ${result.stats.num_superpoints} superpoints created`);
        return result;
      } else {
        console.error('Mesh analysis failed:', result.message);
        return null;
      }
    } catch (error) {
      console.error('Mesh analysis error:', error);
      return null;
    }
  }

  async renderViewsAndProcessSAM(
    scene: THREE.Scene,
    meshAnalysis: MeshAnalysisResult,
    targetMesh: THREE.Mesh
  ): Promise<SAMProcessingResult | null> {
    try {
      console.log(`Rendering ${meshAnalysis.camera_views.length} views for SAM processing...`);
      
      // Create temporary renderer for view capture
      const renderer = new THREE.WebGLRenderer({ 
        antialias: true, 
        preserveDrawingBuffer: true,
        alpha: true
      });
      renderer.setSize(512, 512); // Fixed resolution for consistent SAM processing
      renderer.setClearColor(0x000000, 0); // Transparent background
      
      // Create temporary camera
      const camera = new THREE.PerspectiveCamera(60, 1.0, 0.1, 1000);
      
      // Capture images from each view
      const viewImages: string[] = [];
      const viewInfo: CameraView[] = [];

      for (const view of meshAnalysis.camera_views) {
        // Set camera position and orientation
        camera.position.set(view.position[0], view.position[1], view.position[2]);
        camera.lookAt(view.target[0], view.target[1], view.target[2]);
        camera.up.set(view.up[0], view.up[1], view.up[2]);
        camera.fov = view.fov;
        camera.aspect = view.aspect;
        camera.near = view.near;
        camera.far = view.far;
        camera.updateProjectionMatrix();

        // Render the scene
        renderer.render(scene, camera);
        
        // Capture the frame as base64
        const canvas = renderer.domElement;
        const imageData = canvas.toDataURL('image/png');
        
        viewImages.push(imageData);
        viewInfo.push(view);
      }

      // Clean up temporary renderer
      renderer.dispose();

      console.log(`Captured ${viewImages.length} views, sending to SAM...`);

      // Send to backend for SAM processing
      const response = await fetch(`${this.baseUrl}/process-multiview-sam`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          view_images: viewImages,
          view_info: viewInfo,
          superpoints: meshAnalysis.superpoints
        }),
      });

      const result = await response.json();

      if (result.status === 'success') {
        console.log(`SAM processing complete: ${result.stats.total_masks_generated} masks generated, ${result.stats.total_masks_assigned} assigned`);
        return result;
      } else {
        console.error('SAM processing failed:', result.message);
        return null;
      }

    } catch (error) {
      console.error('Multi-view SAM processing error:', error);
      return null;
    }
  }

  async processAdvancedSAM(
    scene: THREE.Scene,
    targetMesh: THREE.Mesh
  ): Promise<{
    superpoints: SuperPoint[];
    assignments: SuperPointAssignment[];
    stats: any;
  } | null> {
    try {
      console.log('Starting advanced SAM processing...');

      // Step 1: Analyze mesh and create superpoints
      const geometry = targetMesh.geometry;
      const positionAttribute = geometry.getAttribute('position');
      const indexAttribute = geometry.getIndex();

      if (!positionAttribute || !indexAttribute) {
        throw new Error('Mesh must have position and index attributes');
      }

      const vertices = positionAttribute.array as Float32Array;
      const faces = indexAttribute.array as Uint32Array;

      const meshAnalysis = await this.analyzeMesh(vertices, faces);
      if (!meshAnalysis) {
        throw new Error('Mesh analysis failed');
      }

      // Step 2: Render multiple views and process with SAM
      const samResult = await this.renderViewsAndProcessSAM(scene, meshAnalysis, targetMesh);
      if (!samResult) {
        throw new Error('SAM processing failed');
      }

      return {
        superpoints: meshAnalysis.superpoints,
        assignments: samResult.assignments,
        stats: {
          mesh_analysis: meshAnalysis.stats,
          sam_processing: samResult.stats
        }
      };

    } catch (error) {
      console.error('Advanced SAM processing failed:', error);
      return null;
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const result = await response.json();
      return result.status === 'healthy' && result.sam_loaded;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }
}

// Utility functions for working with superpoint assignments
export class SuperPointAssignmentUtils {
  
  static createMaskingGroups(
    assignments: SuperPointAssignment[], 
    superpoints: SuperPoint[]
  ): Map<number, number[]> {
    const maskingGroups = new Map<number, number[]>();
    
    assignments.forEach((assignment, index) => {
      maskingGroups.set(index, assignment.vertices);
    });

    return maskingGroups;
  }

  static convertToVertexColors(
    assignments: SuperPointAssignment[],
    totalVertices: number,
    colors: THREE.Color[] = []
  ): THREE.Color[] {
    // Initialize with default color if not provided
    if (colors.length === 0) {
      colors = new Array(totalVertices).fill(null).map(() => new THREE.Color(0.8, 0.8, 0.8));
    }

    // Generate distinct colors for each assignment
    const assignmentColors = this.generateDistinctColors(assignments.length);

    assignments.forEach((assignment, index) => {
      const color = assignmentColors[index];
      assignment.vertices.forEach(vertexIndex => {
        if (vertexIndex < colors.length) {
          colors[vertexIndex] = color.clone();
        }
      });
    });

    return colors;
  }

  static generateDistinctColors(count: number): THREE.Color[] {
    const colors: THREE.Color[] = [];
    
    for (let i = 0; i < count; i++) {
      const hue = (i * 360 / count) % 360;
      const saturation = 0.7 + (i % 3) * 0.1; // Vary saturation slightly
      const lightness = 0.5 + (i % 2) * 0.2;  // Vary lightness slightly
      
      const color = new THREE.Color();
      color.setHSL(hue / 360, saturation, lightness);
      colors.push(color);
    }
    
    return colors;
  }

  static getAssignmentStatistics(assignments: SuperPointAssignment[]): {
    totalAssignments: number;
    totalVertices: number;
    averageVerticesPerAssignment: number;
    largestAssignment: number;
    smallestAssignment: number;
  } {
    const vertexCounts = assignments.map(a => a.vertices.length);
    const totalVertices = vertexCounts.reduce((sum, count) => sum + count, 0);

    return {
      totalAssignments: assignments.length,
      totalVertices,
      averageVerticesPerAssignment: totalVertices / assignments.length,
      largestAssignment: Math.max(...vertexCounts),
      smallestAssignment: Math.min(...vertexCounts)
    };
  }

  static validateAssignments(
    assignments: SuperPointAssignment[],
    totalVertices: number
  ): {
    isValid: boolean;
    errors: string[];
    coverage: number;
  } {
    const errors: string[] = [];
    const assignedVertices = new Set<number>();

    // Check for vertex index validity and duplicates
    assignments.forEach((assignment, index) => {
      assignment.vertices.forEach(vertexIndex => {
        if (vertexIndex < 0 || vertexIndex >= totalVertices) {
          errors.push(`Assignment ${index}: Invalid vertex index ${vertexIndex}`);
        }
        
        if (assignedVertices.has(vertexIndex)) {
          errors.push(`Vertex ${vertexIndex} assigned to multiple superpoints`);
        } else {
          assignedVertices.add(vertexIndex);
        }
      });
    });

    const coverage = assignedVertices.size / totalVertices;

    return {
      isValid: errors.length === 0,
      errors,
      coverage
    };
  }
}

export default EnhancedSAMService;