// src/App.tsx - Main Application Component with Enhanced SAM Integration
import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Camera, Upload, Palette, Download, Layers, Bot, RefreshCw, CheckCircle, AlertCircle, Cpu } from 'lucide-react';

// Inline SAM service types and functionality
interface SuperPoint {
  id: number;
  vertices: number[];
  centroid: [number, number, number];
  normal: [number, number, number];
  curvature: number;
  area: number;
  neighbors: number[];
}

interface CameraView {
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

interface SuperPointAssignment {
  superpoint_id: number;
  assigned_masks: string[];
  num_masks: number;
  vertices: number[];
}

interface MeshAnalysisResult {
  status: string;
  superpoints: SuperPoint[];
  camera_views: CameraView[];
  stats: {
    num_superpoints: number;
    avg_vertices_per_superpoint: number;
    num_camera_views: number;
  };
}

interface SAMProcessingResult {
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

// Inline SAM Service
class EnhancedSAMService {
  private baseUrl: string;
  private isInitialized: boolean = false;

  constructor(baseUrl: string = 'http://localhost:5000') {
    this.baseUrl = baseUrl;
  }

  async initialize(modelType: string = 'vit_b'): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/init-sam`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_type: modelType,
          checkpoint_path: './checkpoints/sam_vit_b_01ec64.pth',
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

  async analyzeMesh(vertices: Float32Array, faces: Uint32Array): Promise<MeshAnalysisResult | null> {
    if (!this.isInitialized) {
      throw new Error('SAM service not initialized');
    }

    try {
      const verticesArray = Array.from(vertices);
      const facesArray = Array.from(faces);

      const reshapedVertices = [];
      for (let i = 0; i < verticesArray.length; i += 3) {
        reshapedVertices.push([
          verticesArray[i],
          verticesArray[i + 1],
          verticesArray[i + 2]
        ]);
      }

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

  async renderViewsAndProcessSAM(scene: THREE.Scene, meshAnalysis: MeshAnalysisResult, targetMesh: THREE.Mesh): Promise<SAMProcessingResult | null> {
    try {
      console.log(`Rendering ${meshAnalysis.camera_views.length} views for SAM processing...`);
      
      const renderer = new THREE.WebGLRenderer({ 
        antialias: true, 
        preserveDrawingBuffer: true,
        alpha: true
      });
      renderer.setSize(512, 512);
      renderer.setClearColor(0x000000, 0);
      
      const camera = new THREE.PerspectiveCamera(60, 1.0, 0.1, 1000);
      
      const viewImages: string[] = [];
      const viewInfo: CameraView[] = [];

      for (const view of meshAnalysis.camera_views) {
        camera.position.set(view.position[0], view.position[1], view.position[2]);
        camera.lookAt(view.target[0], view.target[1], view.target[2]);
        camera.up.set(view.up[0], view.up[1], view.up[2]);
        camera.fov = view.fov;
        camera.aspect = view.aspect;
        camera.near = view.near;
        camera.far = view.far;
        camera.updateProjectionMatrix();

        renderer.render(scene, camera);
        
        const canvas = renderer.domElement;
        const imageData = canvas.toDataURL('image/png');
        
        viewImages.push(imageData);
        viewInfo.push(view);
      }

      renderer.dispose();

      console.log(`Captured ${viewImages.length} views, sending to SAM...`);

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

  async processAdvancedSAM(scene: THREE.Scene, targetMesh: THREE.Mesh): Promise<{
    superpoints: SuperPoint[];
    assignments: SuperPointAssignment[];
    stats: any;
  } | null> {
    try {
      console.log('Starting advanced SAM processing...');

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

// Utility functions
class SuperPointAssignmentUtils {
  static createMaskingGroups(assignments: SuperPointAssignment[], superpoints: SuperPoint[]): Map<number, number[]> {
    const maskingGroups = new Map<number, number[]>();
    
    assignments.forEach((assignment, index) => {
      maskingGroups.set(index, assignment.vertices);
    });

    return maskingGroups;
  }

  static convertToVertexColors(assignments: SuperPointAssignment[], totalVertices: number, colors: THREE.Color[] = []): THREE.Color[] {
    if (colors.length === 0) {
      colors = new Array(totalVertices).fill(null).map(() => new THREE.Color(0.8, 0.8, 0.8));
    }

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
      const saturation = 0.7 + (i % 3) * 0.1;
      const lightness = 0.5 + (i % 2) * 0.2;
      
      const color = new THREE.Color();
      color.setHSL(hue / 360, saturation, lightness);
      colors.push(color);
    }
    
    return colors;
  }
}

interface ModelViewerProps {
  onColorsChange?: (colors: THREE.Color[]) => void;
}

interface ProcessingStatus {
  stage: 'idle' | 'analyzing' | 'rendering' | 'processing' | 'complete' | 'error';
  message: string;
  progress?: number;
}

interface SAMResults {
  superpoints: SuperPoint[];
  assignments: SuperPointAssignment[];
  stats: any;
}

const App: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<any>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const samServiceRef = useRef<EnhancedSAMService | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [isUploaded, setIsUploaded] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#ff6b35');
  const [paintingMode, setPaintingMode] = useState<'individual' | 'semantic'>('semantic');
  const [currentMaskingGroup, setCurrentMaskingGroup] = useState<number>(0);
  const [maskingGroups, setMaskingGroups] = useState<Map<number, number[]>>(new Map());
  const [backgroundType, setBackgroundType] = useState<'studio' | 'transparent' | 'grid'>('studio');
  const [samInitialized, setSamInitialized] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({ 
    stage: 'idle', 
    message: 'Ready to process' 
  });
  const [samResults, setSamResults] = useState<SAMResults | null>(null);
  const [showAssignmentStats, setShowAssignmentStats] = useState(false);

  // Initialize Three.js scene
  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera setup - proper initial positioning
    const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer setup - fixed size for the card layout
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: backgroundType === 'transparent' 
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(700, 556); // Fixed size to match the card
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Style the canvas properly
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    
    rendererRef.current = renderer;

    // Lighting setup
    setupLighting(scene);
    
    // Background setup
    setupBackground(scene, renderer, backgroundType);

    // Improved mouse controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    const spherical = new THREE.Spherical();
    const target = new THREE.Vector3(0, 0, 0);

    // Set initial spherical coordinates
    const cameraOffset = camera.position.clone().sub(target);
    spherical.setFromVector3(cameraOffset);

    const handleMouseDown = (event: MouseEvent) => {
      isDragging = true;
      previousMousePosition = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging) return;
      event.preventDefault();
      
      const deltaMove = {
        x: event.clientX - previousMousePosition.x,
        y: event.clientY - previousMousePosition.y
      };

      // Update spherical coordinates
      spherical.theta -= deltaMove.x * 0.01;
      spherical.phi += deltaMove.y * 0.01;
      
      // Constrain phi to avoid flipping
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));

      // Update camera position
      camera.position.setFromSpherical(spherical).add(target);
      camera.lookAt(target);

      previousMousePosition = { x: event.clientX, y: event.clientY };
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      
      // Zoom by adjusting radius
      spherical.radius += event.deltaY * 0.01;
      spherical.radius = Math.max(1, Math.min(50, spherical.radius));
      
      // Update camera position
      camera.position.setFromSpherical(spherical).add(target);
      camera.lookAt(target);
    };

    // Resize handler - simplified for fixed size
    const handleResize = () => {
      // For fixed-size container, just ensure the renderer stays at correct size
      if (renderer && camera) {
        camera.aspect = 700 / 556;
        camera.updateProjectionMatrix();
        renderer.setSize(700, 556);
      }
    };

    // Add event listeners
    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('mouseup', handleMouseUp);

    // Initial setup
    handleResize();

    // Mount renderer
    container.appendChild(renderer.domElement);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Initialize SAM service
    initializeSAMService();

    return () => {
      // Cleanup
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mouseup', handleMouseUp);
      
      if (container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [backgroundType]);

  const initializeSAMService = async () => {
    try {
      setProcessingStatus({ stage: 'analyzing', message: 'Initializing SAM service...' });
      
      samServiceRef.current = new EnhancedSAMService();
      const initialized = await samServiceRef.current.initialize();
      
      if (initialized) {
        setSamInitialized(true);
        setProcessingStatus({ stage: 'idle', message: 'SAM service ready' });
      } else {
        throw new Error('SAM initialization failed');
      }
    } catch (error) {
      console.error('SAM initialization error:', error);
      setSamInitialized(false);
      setProcessingStatus({ 
        stage: 'error', 
        message: 'SAM service initialization failed. Please check backend.' 
      });
    }
  };

  const setupLighting = (scene: THREE.Scene) => {
    // Much brighter ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 1.2);
    scene.add(ambientLight);

    // Brighter main directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Brighter fill lights
    const fillLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    fillLight1.position.set(-10, 0, 5);
    scene.add(fillLight1);

    const fillLight2 = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight2.position.set(0, -10, 5);
    scene.add(fillLight2);

    // Additional top light for better visibility
    const topLight = new THREE.DirectionalLight(0xffffff, 0.4);
    topLight.position.set(0, 20, 0);
    scene.add(topLight);
  };

  const setupBackground = (scene: THREE.Scene, renderer: THREE.WebGLRenderer, type: string) => {
    switch (type) {
      case 'studio':
        scene.background = new THREE.Color(0xf5f5f5);
        renderer.setClearColor(0xf5f5f5, 1);
        break;
      case 'transparent':
        scene.background = null;
        renderer.setClearColor(0x000000, 0);
        break;
      case 'grid':
        scene.background = new THREE.Color(0xf0f0f0);
        renderer.setClearColor(0xf0f0f0, 1);
        break;
    }
  };

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setProcessingStatus({ stage: 'analyzing', message: 'Loading STL file...' });

    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;
      
      // Simple STL parser
      const dataView = new DataView(arrayBuffer);
      const triangleCount = dataView.getUint32(80, true);
      
      const vertices: number[] = [];
      const indices: number[] = [];
      let offset = 84;
      
      for (let i = 0; i < triangleCount; i++) {
        // Skip normal (12 bytes)
        offset += 12;
        
        // Read 3 vertices
        for (let j = 0; j < 3; j++) {
          vertices.push(
            dataView.getFloat32(offset, true),
            dataView.getFloat32(offset + 4, true),
            dataView.getFloat32(offset + 8, true)
          );
          indices.push(vertices.length / 3 - 1);
          offset += 12;
        }
        
        offset += 2; // Skip attribute byte count
      }

      // Create geometry
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      // Clear previous mesh
      if (meshRef.current && sceneRef.current) {
        sceneRef.current.remove(meshRef.current);
      }

      // Create new mesh
      const material = new THREE.MeshPhongMaterial({
        color: 0xcccccc,
        vertexColors: true
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Proper centering and scaling
      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox!;
      const center = bbox.getCenter(new THREE.Vector3());
      const size = bbox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      // Center the geometry
      geometry.translate(-center.x, -center.y, -center.z);

      // Scale to fit nicely in view (target size of 4 units)
      const targetSize = 4;
      const scale = maxDim > 0 ? targetSize / maxDim : 1;
      geometry.scale(scale, scale, scale);

      // Position mesh at origin
      mesh.position.set(0, 0, 0);

      meshRef.current = mesh;
      sceneRef.current?.add(mesh);

      // Reset camera to good viewing position
      if (cameraRef.current) {
        const camera = cameraRef.current;
        camera.position.set(6, 6, 6);
        camera.lookAt(0, 0, 0);
        
        // Update spherical coordinates for controls
        const spherical = new THREE.Spherical();
        spherical.setFromVector3(camera.position);
      }

      // Initialize vertex colors
      const positionAttribute = geometry.getAttribute('position');
      const colors = new Float32Array(positionAttribute.count * 3);
      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = 0.8;     // R
        colors[i + 1] = 0.8; // G
        colors[i + 2] = 0.8; // B
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      setIsUploaded(true);
      setProcessingStatus({ stage: 'idle', message: 'Model loaded successfully' });
    };

    reader.readAsArrayBuffer(uploadedFile);
  }, []);

  const processAdvancedSAM = async () => {
    if (!meshRef.current || !sceneRef.current || !samServiceRef.current || !samInitialized) {
      alert('Please upload a model and ensure SAM is initialized');
      return;
    }

    try {
      setProcessingStatus({ stage: 'analyzing', message: 'Analyzing mesh geometry...' });
      
      // Add timeout protection (5 minutes max)
      const timeoutId = setTimeout(() => {
        throw new Error('Processing timeout - please try a smaller model');
      }, 300000);
      
      const result = await samServiceRef.current.processAdvancedSAM(
        sceneRef.current,
        meshRef.current
      );
      
      // Clear timeout if processing completes
      clearTimeout(timeoutId);

      if (result) {
        setSamResults(result);
        
        // Convert assignments to masking groups
        const groups = SuperPointAssignmentUtils.createMaskingGroups(
          result.assignments,
          result.superpoints
        );
        setMaskingGroups(groups);

        // Apply visual feedback
        updateVertexColors(result.assignments);

        setProcessingStatus({ 
          stage: 'complete', 
          message: `Processing complete! Generated ${result.assignments.length} semantic regions.` 
        });

        // Show statistics
        setShowAssignmentStats(true);
      } else {
        throw new Error('SAM processing returned no results');
      }
    } catch (error) {
      console.error('Advanced SAM processing failed:', error);
      if (error instanceof Error && error.message.includes('timeout')) {
        setProcessingStatus({ 
          stage: 'error', 
          message: 'Processing timed out. Try a model with fewer vertices.' 
        });
      } else {
        setProcessingStatus({ 
          stage: 'error', 
          message: 'SAM processing failed. Please try again.' 
        });
      }
    }
  };

  const updateVertexColors = (assignments: SuperPointAssignment[]) => {
    if (!meshRef.current) return;

    const geometry = meshRef.current.geometry;
    const positionAttribute = geometry.getAttribute('position');
    const colorAttribute = geometry.getAttribute('color') as THREE.BufferAttribute;

    if (!colorAttribute) return;

    const colors = SuperPointAssignmentUtils.convertToVertexColors(
      assignments,
      positionAttribute.count
    );

    // Update the existing color array instead of replacing it
    const existingArray = colorAttribute.array as Float32Array;
    colors.forEach((color, index) => {
      existingArray[index * 3] = color.r;
      existingArray[index * 3 + 1] = color.g;
      existingArray[index * 3 + 2] = color.b;
    });

    colorAttribute.needsUpdate = true;
  };

  const paintCurrentGroup = () => {
    if (!meshRef.current || maskingGroups.size === 0) return;

    const vertices = maskingGroups.get(currentMaskingGroup);
    if (!vertices) return;

    const geometry = meshRef.current.geometry;
    const colorAttribute = geometry.getAttribute('color') as THREE.BufferAttribute;
    if (!colorAttribute) return;

    const color = new THREE.Color(selectedColor);
    const colorArray = colorAttribute.array as Float32Array;

    vertices.forEach(vertexIndex => {
      if (vertexIndex * 3 + 2 < colorArray.length) {
        colorArray[vertexIndex * 3] = color.r;
        colorArray[vertexIndex * 3 + 1] = color.g;
        colorArray[vertexIndex * 3 + 2] = color.b;
      }
    });

    colorAttribute.needsUpdate = true;
  };

  const exportModel = () => {
    if (!meshRef.current) return;

    const geometry = meshRef.current.geometry;
    const positionAttribute = geometry.getAttribute('position');
    const colorAttribute = geometry.getAttribute('color');

    if (!positionAttribute || !colorAttribute) return;

    // Create STL with colors (simplified export)
    let stlContent = 'solid coloredModel\n';
    const positions = positionAttribute.array as Float32Array;

    for (let i = 0; i < positions.length; i += 9) {
      // Calculate face normal
      const v1 = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
      const v2 = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);
      const v3 = new THREE.Vector3(positions[i + 6], positions[i + 7], positions[i + 8]);

      const normal = new THREE.Vector3()
        .subVectors(v2, v1)
        .cross(new THREE.Vector3().subVectors(v3, v1))
        .normalize();

      stlContent += `  facet normal ${normal.x} ${normal.y} ${normal.z}\n`;
      stlContent += '    outer loop\n';
      stlContent += `      vertex ${v1.x} ${v1.y} ${v1.z}\n`;
      stlContent += `      vertex ${v2.x} ${v2.y} ${v2.z}\n`;
      stlContent += `      vertex ${v3.x} ${v3.y} ${v3.z}\n`;
      stlContent += '    endloop\n';
      stlContent += '  endfacet\n';
    }

    stlContent += 'endsolid coloredModel\n';

    const blob = new Blob([stlContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'painted_model.stl';
    a.click();
    URL.revokeObjectURL(url);
  };

  const getProcessingIcon = () => {
    switch (processingStatus.stage) {
      case 'analyzing':
      case 'rendering':
      case 'processing':
        return <RefreshCw className="animate-spin" />;
      case 'complete':
        return <CheckCircle className="text-green-500" />;
      case 'error':
        return <AlertCircle className="text-red-500" />;
      default:
        return <Cpu />;
    }
  };

  const getProcessingStatusColor = () => {
    switch (processingStatus.stage) {
      case 'analyzing':
      case 'rendering':
      case 'processing':
        return 'text-blue-600';
      case 'complete':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left Panel - Controls */}
      <div className="w-80 bg-white shadow-lg flex flex-col">
        <div className="p-6 border-b">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">3D Miniature Painter</h2>
          
          {/* File Upload */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload STL Model
            </label>
            <div className="relative">
              <input
                type="file"
                accept=".stl"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex items-center justify-center p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 transition-colors">
                <Upload className="w-6 h-6 text-gray-400 mr-2" />
                <span className="text-gray-600">
                  {file ? file.name : 'Choose STL file'}
                </span>
              </div>
            </div>
          </div>

          {/* SAM Processing Status */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">SAM Status</span>
              <div className={`w-3 h-3 rounded-full ${samInitialized ? 'bg-green-500' : 'bg-red-500'}`} />
            </div>
            <div className={`flex items-center text-sm ${getProcessingStatusColor()}`}>
              {getProcessingIcon()}
              <span className="ml-2">{processingStatus.message}</span>
            </div>
          </div>

          {/* Advanced SAM Processing */}
          <button
            onClick={processAdvancedSAM}
            disabled={!isUploaded || !samInitialized || processingStatus.stage !== 'idle'}
            className="w-full flex items-center justify-center px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Bot className="w-5 h-5 mr-2" />
            Process with Advanced SAM
          </button>
        </div>

        {/* Painting Controls */}
        <div className="flex-1 p-6 space-y-6 overflow-y-auto">
          {/* Color Picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Paint Color
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={selectedColor}
                onChange={(e) => setSelectedColor(e.target.value)}
                className="w-12 h-12 rounded-lg border border-gray-300 cursor-pointer"
              />
              <input
                type="text"
                value={selectedColor}
                onChange={(e) => setSelectedColor(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Masking Groups */}
          {maskingGroups.size > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Masking Groups ({maskingGroups.size})
              </label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {Array.from(maskingGroups.entries()).map(([groupId, vertices]) => (
                  <button
                    key={groupId}
                    onClick={() => setCurrentMaskingGroup(groupId)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all ${
                      currentMaskingGroup === groupId
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center">
                      <Layers className="w-4 h-4 mr-2 text-gray-500" />
                      <span className="text-sm font-medium">Group {groupId}</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {vertices.length} vertices
                    </span>
                  </button>
                ))}
              </div>
              
              <button
                onClick={paintCurrentGroup}
                disabled={maskingGroups.size === 0}
                className="w-full mt-3 flex items-center justify-center px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Palette className="w-4 h-4 mr-2" />
                Paint Selected Group
              </button>
            </div>
          )}

          {/* Background Options */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Background
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { type: 'studio', label: 'Studio' },
                { type: 'transparent', label: 'Clear' },
                { type: 'grid', label: 'Grid' }
              ].map(({ type, label }) => (
                <button
                  key={type}
                  onClick={() => setBackgroundType(type as any)}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                    backgroundType === type
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="p-6 border-t space-y-3">
          <button
            onClick={exportModel}
            disabled={!isUploaded}
            className="w-full flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Download className="w-4 h-4 mr-2" />
            Export Painted Model
          </button>
        </div>
      </div>

      {/* Right Panel - 3D Viewport */}
      <div className="flex-1 flex items-center justify-center bg-gray-100 p-8">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden" style={{ width: '700px', height: '600px' }}>
          <div className="p-4 border-b bg-gray-50">
            <h3 className="text-lg font-semibold text-gray-800">3D Model Viewer</h3>
            <p className="text-sm text-gray-600">Drag to rotate • Scroll to zoom</p>
          </div>
          <div className="relative bg-gray-200" style={{ width: '700px', height: '556px' }}>
            <div 
              ref={mountRef} 
              className="w-full h-full"
              style={{ width: '700px', height: '556px' }}
            />
            
            {/* Stats Overlay */}
            {showAssignmentStats && samResults && (
              <div className="absolute top-4 right-4 bg-white/90 backdrop-blur rounded-lg p-4 shadow-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-800">SAM Analysis Results</h3>
                  <button
                    onClick={() => setShowAssignmentStats(false)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    ×
                  </button>
                </div>
                <div className="space-y-1 text-sm text-gray-600">
                  <div>Superpoints: {samResults.superpoints.length}</div>
                  <div>Semantic Groups: {samResults.assignments.length}</div>
                  <div>Views Processed: {samResults.stats.sam_processing.total_views_processed}</div>
                  <div>Masks Generated: {samResults.stats.sam_processing.total_masks_generated}</div>
                  <div>Assignment Efficiency: {(samResults.stats.sam_processing.assignment_efficiency * 100).toFixed(1)}%</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;