import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, Brain, Zap, Camera, Palette, Eye, EyeOff, Layers } from 'lucide-react';
import * as THREE from 'three';

// Types
interface ModelData {
  name: string;
  size: number;
  type: string;
  uploadedAt: Date;
  geometry?: THREE.BufferGeometry;
}

interface PaintColors {
  [key: string]: string;
}

interface MaskingGroup {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

interface VertexMasking {
  [groupId: string]: number[];
}

interface AIAnalysis {
  success: boolean;
  masking_groups?: {
    [groupId: string]: {
      name: string;
      color: string;
      vertices: number[];
      description: string;
      vertex_count: number;
      percentage: number;
    };
  };
}

// Constants
const PAINT_COLORS: string[] = [
  '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#800000', '#008000', '#000080', '#808000', '#800080', '#008080',
  '#FFA500', '#FFC0CB', '#A52A2A', '#808080', '#000000', '#FFFFFF'
];

const BACKGROUND_COLORS: { name: string; color: number }[] = [
  { name: 'White', color: 0xffffff },
  { name: 'Light Gray', color: 0x808080 },
  { name: 'Dark Gray', color: 0x404040 },
  { name: 'Black', color: 0x000000 },
  { name: 'Blue', color: 0x87ceeb }
];

const MASKING_GROUPS: MaskingGroup[] = [
  { id: 'base_support', name: 'Base & Support', color: '#654321', visible: true },
  { id: 'lower_section', name: 'Lower Section', color: '#8B4513', visible: true },
  { id: 'main_body', name: 'Main Body', color: '#C0C0C0', visible: true },
  { id: 'upper_section', name: 'Upper Section', color: '#800080', visible: true },
  { id: 'details', name: 'Fine Details', color: '#FDBCB4', visible: true }
];

// SAM mapping storage
let globalSAMMapping: any | null = null;
let globalSAMViewData: any | null = null;

const setSAMMapping = (samMapping: any, viewData: any): void => {
  console.log('🎭 Setting global SAM mapping...');
  globalSAMMapping = samMapping;
  globalSAMViewData = viewData;
};

const clearSAMMapping = (): void => {
  console.log('🔄 Clearing SAM mapping - switching to geometric mode');
  globalSAMMapping = null;
  globalSAMViewData = null;
};

// STL Loader
const loadSTLFile = (file: File): Promise<THREE.BufferGeometry> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const geometry = parseSTL(arrayBuffer);
        if (!geometry || !geometry.attributes.position) {
          throw new Error('Invalid geometry generated');
        }
        resolve(geometry);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('File reading failed'));
    reader.readAsArrayBuffer(file);
  });
};

const parseSTL = (arrayBuffer: ArrayBuffer): THREE.BufferGeometry => {
  const header = new Uint8Array(arrayBuffer, 0, 5);
  let headerString = '';
  for (let i = 0; i < header.length; i++) {
    headerString += String.fromCharCode(header[i]);
  }
  
  if (headerString.toLowerCase() === 'solid') {
    return parseASCIISTL(arrayBuffer);
  } else {
    return parseBinarySTL(arrayBuffer);
  }
};

const parseASCIISTL = (arrayBuffer: ArrayBuffer): THREE.BufferGeometry => {
  const text = new TextDecoder().decode(arrayBuffer);
  const vertices: number[] = [];
  const normals: number[] = [];
  const lines = text.split('\n');
  let currentNormal = [0, 0, 0];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('facet normal')) {
      const parts = line.split(/\s+/);
      currentNormal = [parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0, parseFloat(parts[4]) || 0];
    } else if (line.startsWith('vertex')) {
      const parts = line.split(/\s+/);
      vertices.push(parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0);
      normals.push(currentNormal[0], currentNormal[1], currentNormal[2]);
    }
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
};

const parseBinarySTL = (arrayBuffer: ArrayBuffer): THREE.BufferGeometry => {
  const view = new DataView(arrayBuffer);
  const triangleCount = view.getUint32(80, true);
  const vertices: number[] = [];
  const normals: number[] = [];
  let offset = 84;
  
  for (let i = 0; i < triangleCount; i++) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;
    
    for (let j = 0; j < 3; j++) {
      vertices.push(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
      normals.push(nx, ny, nz);
      offset += 12;
    }
    offset += 2;
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
};

// SAM Processing Functions - UPDATED FOR ENHANCED BACKEND
const processSAMResults = (samResults: any, mesh: THREE.Mesh, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) => {
  console.log('🎭 PROCESSING ENHANCED SAM RESULTS...');
  console.log(`Input: ${samResults.masks.length} superpoint-based regions`);
  
  const vertexMapping: any = {};
  const maskingGroups = samResults.masks.map((mask: any, index: number) => {
    const groupId = `sam_mask_${mask.mask_id}`;
    
    // Use actual vertex assignments from superpoint mapping
    if (mask.vertices && mask.vertices.length > 0) {
      vertexMapping[groupId] = mask.vertices;
      console.log(`  Region ${mask.mask_id}: ${mask.vertices.length} vertices assigned via superpoints`);
    } else {
      vertexMapping[groupId] = [];
      console.log(`  Region ${mask.mask_id}: No vertices assigned`);
    }
    
    return {
      id: groupId,
      name: `Region ${mask.mask_id + 1} (${mask.vertices?.length || 0} vtx)`,
      color: `hsl(${(mask.mask_id * 137.5) % 360}, 70%, 60%)`,
      visible: true
    };
  });
  
  // Log final results
  const totalVertices = Object.values(vertexMapping).reduce((sum: number, vertices: any) => sum + vertices.length, 0);
  console.log(`✅ Enhanced SAM processing complete:`);
  console.log(`   Regions: ${maskingGroups.length}`);
  console.log(`   Total vertices assigned: ${totalVertices}`);
  
  Object.entries(vertexMapping).forEach(([groupId, vertices]: [string, any]) => {
    console.log(`     ${groupId}: ${vertices.length} vertices`);
  });

  return { vertexMapping, maskingGroups };
};

// Masking Utils
const createGeometricMasking = (geometry: THREE.BufferGeometry, maskingGroups: MaskingGroup[], aiAnalysis?: AIAnalysis): VertexMasking => {
  const positions = geometry.attributes.position;
  const vertexCount = positions.count;
  const masking: VertexMasking = {};
  
  maskingGroups.forEach(group => {
    masking[group.id] = [];
  });
  
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const size = bbox.getSize(new THREE.Vector3());
  
  for (let i = 0; i < vertexCount; i++) {
    const y = positions.getY(i);
    const normalizedY = (y - bbox.min.y) / size.y;
    
    if (normalizedY < 0.2 && maskingGroups[0]) {
      masking[maskingGroups[0].id]?.push(i);
    } else if (normalizedY < 0.4 && maskingGroups[1]) {
      masking[maskingGroups[1].id]?.push(i);
    } else if (normalizedY < 0.6 && maskingGroups[2]) {
      masking[maskingGroups[2].id]?.push(i);
    } else if (normalizedY < 0.8 && maskingGroups[3]) {
      masking[maskingGroups[3].id]?.push(i);
    } else if (maskingGroups[4]) {
      masking[maskingGroups[4].id]?.push(i);
    } else if (maskingGroups[0]) {
      masking[maskingGroups[0].id]?.push(i);
    }
  }
  
  return masking;
};

const applyVertexColors = (geometry: THREE.BufferGeometry, masking: VertexMasking, maskingGroups: MaskingGroup[], paintColors: PaintColors): THREE.BufferGeometry => {
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const vertexCount = positions.count;
  const colors = new Float32Array(vertexCount * 3);
  
  // Default neutral gray color
  const defaultColor = new THREE.Color(0x808080);
  for (let i = 0; i < vertexCount; i++) {
    colors[i * 3] = defaultColor.r;
    colors[i * 3 + 1] = defaultColor.g;
    colors[i * 3 + 2] = defaultColor.b;
  }
  
  Object.entries(masking).forEach(([groupId, vertices]) => {
    const group = maskingGroups.find(g => g.id === groupId);
    if (!group || !group.visible || !vertices || vertices.length === 0) return;
    
    const colorHex = paintColors[groupId] || group.color;
    const color = new THREE.Color(colorHex);
    
    vertices.forEach(vertexIndex => {
      if (vertexIndex >= 0 && vertexIndex < vertexCount) {
        colors[vertexIndex * 3] = color.r;
        colors[vertexIndex * 3 + 1] = color.g;
        colors[vertexIndex * 3 + 2] = color.b;
      }
    });
  });
  
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
};

// Three.js Scene Component
interface ThreeSceneProps {
  paintColors: PaintColors;
  maskingGroups: MaskingGroup[];
  modelData: ModelData | null;
  backgroundColor: number;
  selectedGroup: string;
  aiAnalysis?: AIAnalysis;
  onRefsReady?: (mesh: THREE.Mesh | null, camera: THREE.PerspectiveCamera | null, renderer: THREE.WebGLRenderer | null) => void;
}

const ThreeScene: React.FC<ThreeSceneProps> = ({ 
  paintColors, 
  maskingGroups, 
  modelData, 
  backgroundColor,
  selectedGroup,
  aiAnalysis,
  onRefsReady
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const vertexMaskingRef = useRef<VertexMasking | null>(null);
  const orbitCenterRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 6, 0));

  // Scene initialization
  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 2000);
    camera.position.set(0, 10, 10);
    camera.lookAt(orbitCenterRef.current);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.shadowMap.enabled = false;
    
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Setup lighting - balanced for neutral gray models
    const ambientLight = new THREE.AmbientLight(0x404040, 2.0);
    scene.add(ambientLight);
    
    const frontLight = new THREE.DirectionalLight(0xffffff, 3.0);
    frontLight.position.set(0, 10, 20);
    scene.add(frontLight);
    
    const topLight = new THREE.DirectionalLight(0xffffff, 1.5);
    topLight.position.set(0, 20, 0);
    scene.add(topLight);

    // Setup mouse controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    const handleMouseDown = (event: MouseEvent) => {
      isDragging = true;
      previousMousePosition = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    };

    const handleMouseUp = () => { 
      isDragging = false; 
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging || !cameraRef.current) return;
      event.preventDefault();
      
      const deltaMove = {
        x: event.clientX - previousMousePosition.x,
        y: event.clientY - previousMousePosition.y
      };

      const cameraOffset = cameraRef.current.position.clone().sub(orbitCenterRef.current);
      const spherical = new THREE.Spherical();
      spherical.setFromVector3(cameraOffset);
      
      spherical.theta -= deltaMove.x * 0.01;
      spherical.phi -= deltaMove.y * 0.01;
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
      
      cameraRef.current.position.setFromSpherical(spherical).add(orbitCenterRef.current);
      cameraRef.current.lookAt(orbitCenterRef.current);
      
      previousMousePosition = { x: event.clientX, y: event.clientY };
    };

    const handleWheel = (event: WheelEvent) => {
      if (!cameraRef.current) return;
      event.preventDefault();
      
      const direction = cameraRef.current.position.clone().sub(orbitCenterRef.current).normalize();
      const moveAmount = event.deltaY * 0.05;
      const newPosition = cameraRef.current.position.clone().add(direction.multiplyScalar(moveAmount));
      
      const distanceFromCenter = newPosition.distanceTo(orbitCenterRef.current);
      if (distanceFromCenter > 2 && distanceFromCenter < 50) {
        cameraRef.current.position.copy(newPosition);
      }
      
      cameraRef.current.lookAt(orbitCenterRef.current);
    };

    renderer.domElement.addEventListener('mousedown', handleMouseDown, { passive: false });
    renderer.domElement.addEventListener('mouseup', handleMouseUp, { passive: false });
    renderer.domElement.addEventListener('mousemove', handleMouseMove, { passive: false });
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
    
    window.addEventListener('mouseup', handleMouseUp, { passive: false });
    window.addEventListener('mousemove', handleMouseMove, { passive: false });

    // Start animation loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      if (rendererRef.current && cameraRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Setup SAM test functions - ENHANCED BACKEND INTEGRATION
    (window as any).testSAMCapture = async () => {
      console.log('🎯 ENHANCED SAM test called - using optimized backend workflow...');
      
      if (sceneRef.current && cameraRef.current && rendererRef.current && meshRef.current) {
        console.log('✅ All refs available, starting enhanced SAM workflow...');
        
        try {
          // Check if SAM is initialized
          console.log('🔍 Checking SAM backend status...');
          const healthResponse = await fetch('http://localhost:5000/health');
          if (!healthResponse.ok) {
            throw new Error('Backend not available');
          }
          
          const healthData = await healthResponse.json();
          console.log('✅ Backend health:', healthData);
          
          if (!healthData.sam_loaded) {
            console.log('🤖 Initializing optimized SAM...');
            const initResponse = await fetch('http://localhost:5000/init-optimized-sam', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model_type: 'vit_h',
                checkpoint_path: './checkpoints/sam_vit_h_4b8939.pth',
                device: 'cpu'
              })
            });
            
            if (!initResponse.ok) {
              throw new Error('SAM initialization failed');
            }
            
            const initData = await initResponse.json();
            console.log('✅ SAM initialized:', initData);
          }
          
          // Capture image for SAM processing
          console.log('📸 Capturing optimized view...');
          camera.position.set(0, 8, 12);
          camera.lookAt(0, 4, 0);
          camera.updateMatrixWorld();
          
          renderer.render(scene, camera);
          const imageData = renderer.domElement.toDataURL('image/png');
          
          // Extract mesh data
          const geometry = meshRef.current.geometry;
          const positionAttribute = geometry.getAttribute('position');
          const indexAttribute = geometry.getIndex();
          
          if (!positionAttribute || !indexAttribute) {
            throw new Error('Mesh missing required attributes');
          }
          
          const vertices = positionAttribute.array as Float32Array;
          const faces = indexAttribute.array as Uint32Array;
          
          console.log('📊 Mesh stats:', {
            vertices: vertices.length / 3,
            faces: faces.length / 3
          });
          
          // Send to optimized SAM backend
          const samResponse = await fetch('http://localhost:5000/segment-optimized', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              color_image: imageData,
              vertices: Array.from(vertices),
              miniature_type: 'humanoid'
            })
          });

          if (!samResponse.ok) {
            throw new Error('Optimized SAM processing failed');
          }

          const samResult = await samResponse.json();
          console.log(`✅ Optimized SAM complete: ${samResult.num_regions} semantic regions`);

          // Format results for frontend
          const formattedResult = {
            masks: samResult.regions.map((region: any, index: number) => ({
              mask_id: index,
              area: region.area || 1000,
              stability_score: region.confidence || 0.9,
              vertices: region.vertices || [],
              semantic_type: region.semantic_type || 'unknown'
            })),
            viewport_size: { width: 512, height: 512 },
            camera_data: {
              camera_matrix: cameraRef.current?.matrixWorld.toArray() || Array(16).fill(0),
              projection_matrix: cameraRef.current?.projectionMatrix.toArray() || Array(16).fill(0)
            },
            optimized: true,
            stats: samResult.stats
          };

          // Send results to frontend callback
          if ((window as any).onSAMResults) {
            console.log('🔄 Calling frontend onSAMResults with optimized SAM data...');
            (window as any).onSAMResults(formattedResult);
            console.log('✅ Optimized SAM workflow complete!');
          }
          
        } catch (error) {
          console.error('❌ Enhanced SAM workflow failed:', error);
          
          // Show user-friendly error
          if (error instanceof Error) {
            if (error.message.includes('fetch') || error.message.includes('Backend not available')) {
              alert('❌ Cannot connect to SAM backend. Please ensure the Python server is running on localhost:5000');
            } else {
              alert(`❌ SAM processing failed: ${error.message}`);
            }
          }
          
          // Fallback to mock data for UI testing
          console.log('🔄 Falling back to mock data for UI testing...');
          const mockSamResults = {
            masks: [
              { mask_id: 0, area: 2400, stability_score: 0.95, vertices: [] },
              { mask_id: 1, area: 1800, stability_score: 0.91, vertices: [] },
              { mask_id: 2, area: 1500, stability_score: 0.88, vertices: [] }
            ],
            viewport_size: { width: 1024, height: 1024 },
            camera_data: {
              camera_matrix: cameraRef.current?.matrixWorld.toArray() || Array(16).fill(0),
              projection_matrix: cameraRef.current?.projectionMatrix.toArray() || Array(16).fill(0)
            }
          };
          
          if ((window as any).onSAMResults) {
            (window as any).onSAMResults(mockSamResults);
            console.log('✅ Fallback mock SAM results sent to frontend');
          }
        }
      } else {
        console.log('❌ Scene not ready for SAM capture');
        alert('Scene not ready for SAM capture. Please wait for model to load.');
      }
    };

    // Notify parent that refs are ready
    if (onRefsReady) {
      setTimeout(() => {
        onRefsReady(meshRef.current, cameraRef.current, rendererRef.current);
      }, 100);
    }

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      
      if (meshRef.current && sceneRef.current) {
        sceneRef.current.remove(meshRef.current);
        if (meshRef.current.geometry) meshRef.current.geometry.dispose();
        if (meshRef.current.material) (meshRef.current.material as THREE.Material).dispose();
      }
      
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (mountRef.current && rendererRef.current.domElement) {
          mountRef.current.removeChild(rendererRef.current.domElement);
        }
      }
      
      delete (window as any).testSAMCapture;
    };
  }, [onRefsReady]);

  // Background color updates  
  useEffect(() => {
    if (sceneRef.current && rendererRef.current) {
      sceneRef.current.background = new THREE.Color(backgroundColor);
      rendererRef.current.setClearColor(backgroundColor, 1);
    }
  }, [backgroundColor]);

  // Model loading
  useEffect(() => {
    if (!modelData?.geometry || !sceneRef.current) return;
    
    const geometry = modelData.geometry.clone();
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }
    
    // Use SAM mapping if available, otherwise use geometric masking
    let masking: VertexMasking;
    if (globalSAMMapping) {
      masking = globalSAMMapping;
    } else {
      masking = createGeometricMasking(geometry, maskingGroups, aiAnalysis);
    }
    
    // Apply initial vertex colors
    applyVertexColors(geometry, masking, maskingGroups, {});

    // Create material - neutral gray
    const material = new THREE.MeshPhongMaterial({
      color: 0x808080,
      vertexColors: true,
      shininess: 30,
      specular: 0x222222
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = true;
    mesh.frustumCulled = false;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.PI / 4;
    
    // Scale and position the mesh
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    
    if (box) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const targetSize = 15;
      const scale = maxDim > 0 ? targetSize / maxDim : 1;
      
      mesh.position.copy(center).multiplyScalar(-scale);
      mesh.scale.setScalar(scale);
      
      orbitCenterRef.current = mesh.position.clone();
      orbitCenterRef.current.y += 6;
    }
    
    // Remove current mesh
    if (meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      if (meshRef.current.geometry) meshRef.current.geometry.dispose();
      if (meshRef.current.material) (meshRef.current.material as THREE.Material).dispose();
    }

    meshRef.current = mesh;
    vertexMaskingRef.current = masking;
    sceneRef.current.add(mesh);

    // Notify parent that mesh is ready
    if (onRefsReady && cameraRef.current && rendererRef.current) {
      onRefsReady(meshRef.current, cameraRef.current, rendererRef.current);
    }

    // Force a render
    if (rendererRef.current && cameraRef.current && sceneRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, [modelData, maskingGroups, aiAnalysis, onRefsReady]);
  
  // Update vertex colors when paint colors or masking groups change
  useEffect(() => {
    if (meshRef.current && vertexMaskingRef.current) {
      const geometry = meshRef.current.geometry as THREE.BufferGeometry;
      applyVertexColors(geometry, vertexMaskingRef.current, maskingGroups, paintColors);
      geometry.attributes.color.needsUpdate = true;
      
      if (rendererRef.current && cameraRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    }
  }, [paintColors, maskingGroups]);

  return (
    <div 
      ref={mountRef} 
      style={{
        width: '100%', 
        height: '600px',
        background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
        borderRadius: '12px', 
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4)',
        cursor: 'grab', 
        border: '1px solid #d1d5db', 
        position: 'relative', 
        overflow: 'visible'
      }}
      onMouseDown={(e) => { e.currentTarget.style.cursor = 'grabbing'; }}
      onMouseUp={(e) => { e.currentTarget.style.cursor = 'grab'; }}
    />
  );
};

// Main App Component
const App: React.FC = () => {
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [paintColors, setPaintColors] = useState<PaintColors>({});
  const [maskingGroups, setMaskingGroups] = useState<MaskingGroup[]>(MASKING_GROUPS);
  const [selectedGroup, setSelectedGroup] = useState<string>('base_support');
  const [selectedColor, setSelectedColor] = useState<string>('#FF0000');
  const [backgroundColor, setBackgroundColor] = useState<number>(0xffffff);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');

  // SAM Groups State
  const [useSAMGroups, setUseSAMGroups] = useState<boolean>(false);
  const [samMasks, setSamMasks] = useState<any[]>([]);
  const [samGroupsData, setSamGroupsData] = useState<any>(null);
  const [samMaskGroups, setSamMaskGroups] = useState<MaskingGroup[]>([]);
  const [samSemanticGroups, setSamSemanticGroups] = useState<MaskingGroup[]>([]);
  const [samGroupMode, setSamGroupMode] = useState<'individual' | 'semantic'>('individual');

  // Refs for SAM 3D mapping integration
  const meshRef = useRef<THREE.Mesh | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Check backend connection on component mount
  useEffect(() => {
    checkBackendConnection();
  }, []);

  // SAM results handler
  useEffect(() => {
    (window as any).onSAMResults = (results: any) => {
      console.log('🎭 SAM Results received:', results);
      
      setSamMasks(results.masks);
      setSamGroupsData(results);
      
      if (meshRef.current && cameraRef.current && rendererRef.current) {
        try {
          const { vertexMapping, maskingGroups } = processSAMResults(
            results,
            meshRef.current,
            cameraRef.current,
            rendererRef.current
          );
          
          const viewData = {
            camera_matrix: results.camera_data?.camera_matrix || cameraRef.current?.matrixWorld.toArray() || Array(16).fill(0),
            projection_matrix: results.camera_data?.projection_matrix || cameraRef.current?.projectionMatrix.toArray() || Array(16).fill(0),
            viewport_size: results.viewport_size || { width: 1024, height: 1024 }
          };
          
          setSAMMapping(vertexMapping, viewData);
          setSamMaskGroups(maskingGroups);
          setSamGroupMode('individual');
          setUseSAMGroups(true);
          
          console.log(`🎭 SAM integration complete - showing ${maskingGroups.length} regions`);
          
        } catch (error) {
          console.error('❌ Error processing SAM results:', error);
        }
      }
    };
    
    return () => {
      delete (window as any).onSAMResults;
    };
  }, [modelData]);

  const checkBackendConnection = async () => {
    try {
      const response = await fetch('http://localhost:5000/health');
      if (response.ok) {
        setBackendStatus('connected');
      } else {
        setBackendStatus('error');
      }
    } catch (error) {
      setBackendStatus('error');
    }
  };

  const getCurrentMaskingGroups = () => {
    if (!useSAMGroups) return maskingGroups;
    return samGroupMode === 'individual' ? samMaskGroups : samSemanticGroups;
  };

  const handleSAMToggle = useCallback(() => {
    const newUseSAMGroups = !useSAMGroups;
    setUseSAMGroups(newUseSAMGroups);
    
    if (!newUseSAMGroups) {
      clearSAMMapping();
    }
  }, [useSAMGroups]);

  const handleRefsReady = useCallback((
    mesh: THREE.Mesh | null, 
    camera: THREE.PerspectiveCamera | null, 
    renderer: THREE.WebGLRenderer | null
  ) => {
    meshRef.current = mesh;
    cameraRef.current = camera;
    rendererRef.current = renderer;
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    
    try {
      let geometry: THREE.BufferGeometry;
      
      if (file.name.toLowerCase().endsWith('.stl')) {
        geometry = await loadSTLFile(file);
      } else {
        geometry = new THREE.BoxGeometry(2, 3, 1);
      }

      const newModelData: ModelData = {
        name: file.name, 
        size: file.size, 
        type: file.type,
        uploadedAt: new Date(), 
        geometry: geometry
      };

      setModelData(newModelData);
      setPaintColors({});
      
      clearSAMMapping();
      setSamMasks([]);
      setSamGroupsData(null);
      setUseSAMGroups(false);
      
    } catch (error) {
      console.error('Error loading file:', error);
      const fallbackGeometry = new THREE.CylinderGeometry(1, 1, 3, 16);
      setModelData({
        name: `${file.name} (placeholder)`, 
        size: file.size, 
        type: file.type,
        uploadedAt: new Date(), 
        geometry: fallbackGeometry
      });
      setPaintColors({});
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleGroupToggle = useCallback((groupId: string) => {
    if (useSAMGroups) {
      if (samGroupMode === 'individual') {
        setSamMaskGroups(prev => 
          prev.map(group => 
            group.id === groupId ? { ...group, visible: !group.visible } : group
          )
        );
      } else {
        setSamSemanticGroups(prev => 
          prev.map(group => 
            group.id === groupId ? { ...group, visible: !group.visible } : group
          )
        );
      }
    } else {
      setMaskingGroups(prev => 
        prev.map(group => 
          group.id === groupId ? { ...group, visible: !group.visible } : group
        )
      );
    }
  }, [useSAMGroups, samGroupMode]);

  const handleColorSelect = useCallback((color: string) => {
    setSelectedColor(color);
    setPaintColors(prev => ({ ...prev, [selectedGroup]: color }));
  }, [selectedGroup]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #E0E7FF 0%, #F3E8FF 50%, #FCE7F3 100%)',
      padding: '20px'
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{ 
            fontSize: '48px', fontWeight: '800', color: '#1F2937', marginBottom: '8px',
            textShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            3D Miniature Painter
          </h1>
          <p style={{ fontSize: '18px', color: '#6B7280', fontWeight: '500' }}>
            Upload your STL files and paint your 3D miniatures with AI-powered segmentation
          </p>
          
          <div style={{ 
            marginTop: '16px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '8px',
            fontSize: '14px'
          }}>
            {backendStatus === 'connected' && (
              <React.Fragment>
                <Brain size={16} style={{ color: '#10B981' }} />
                <span style={{ color: '#10B981', fontWeight: '600' }}>AI Backend Connected</span>
              </React.Fragment>
            )}
            {backendStatus === 'error' && (
              <React.Fragment>
                <Zap size={16} style={{ color: '#F59E0B' }} />
                <span style={{ color: '#F59E0B', fontWeight: '600' }}>Basic Mode (AI Backend Offline)</span>
              </React.Fragment>
            )}
          </div>
          
          <div style={{ marginTop: '20px', fontSize: '14px', color: '#6B7280' }}>
            Mouse: Orbit camera around model • Scroll: Zoom in/out
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '40px' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="file"
              accept=".stl,.obj"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleFileUpload(file);
                }
              }}
              style={{ display: 'none' }}
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              style={{
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                padding: '12px 24px',
                background: isLoading ? '#9CA3AF' : 'linear-gradient(to right, #3B82F6, #8B5CF6)',
                color: 'white', 
                borderRadius: '8px', 
                border: 'none',
                cursor: isLoading ? 'not-allowed' : 'pointer', 
                fontSize: '16px', 
                fontWeight: '500',
                minWidth: '200px'
              }}
            >
              <Upload size={20} />
              {isLoading ? 'Loading Model...' : 'Upload STL Model'}
            </label>
          </div>
        </div>

        {modelData ? (
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '32px' }}>
            <div>
              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#1F2937', marginBottom: '20px' }}>
                  3D Preview: {modelData.name}
                  {aiAnalysis?.success && (
                    <span style={{ 
                      marginLeft: '12px', 
                      fontSize: '14px', 
                      color: '#10B981', 
                      fontWeight: '500',
                      padding: '4px 8px',
                      backgroundColor: '#ECFDF5',
                      borderRadius: '4px'
                    }}>
                      AI Enhanced
                    </span>
                  )}
                </h2>
                
                <ThreeScene 
                  paintColors={paintColors} 
                  maskingGroups={getCurrentMaskingGroups()} 
                  modelData={modelData} 
                  backgroundColor={backgroundColor}
                  selectedGroup={selectedGroup}
                  aiAnalysis={aiAnalysis}
                  onRefsReady={handleRefsReady}
                />
              </div>
            </div>

            <div>
              {/* Masking Panel */}
              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Palette size={20} />
                    Masking Groups
                  </h3>
                  
                  {samMasks.length > 0 && (
                    <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#F3F4F6', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <button
                          onClick={handleSAMToggle}
                          style={{
                            padding: '6px 12px',
                            background: useSAMGroups ? '#10B981' : '#6B7280',
                            color: 'white',
                            borderRadius: '4px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '600'
                          }}
                        >
                          {useSAMGroups ? '🤖 SAM Groups' : '📐 Geometric Groups'}
                        </button>
                        
                        <span style={{ fontSize: '12px', color: '#6B7280' }}>
                          {useSAMGroups 
                            ? `${samGroupMode === 'individual' ? samMaskGroups.length : samSemanticGroups.length} AI-detected regions` 
                            : `${maskingGroups.length} geometric regions`}
                        </span>
                      </div>
                      
                      {useSAMGroups && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => setSamGroupMode('individual')}
                            style={{
                              padding: '4px 8px',
                              background: samGroupMode === 'individual' ? '#3B82F6' : '#E5E7EB',
                              color: samGroupMode === 'individual' ? 'white' : '#6B7280',
                              borderRadius: '4px',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '11px'
                            }}
                          >
                            Individual ({samMaskGroups.length})
                          </button>
                          <button
                            onClick={() => setSamGroupMode('semantic')}
                            style={{
                              padding: '4px 8px',
                              background: samGroupMode === 'semantic' ? '#3B82F6' : '#E5E7EB',
                              color: samGroupMode === 'semantic' ? 'white' : '#6B7280',
                              borderRadius: '4px',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '11px'
                            }}
                          >
                            Semantic ({samSemanticGroups.length})
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* Masking Groups List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {getCurrentMaskingGroups().map((group) => (
                    <div
                      key={group.id}
                      onClick={() => setSelectedGroup(group.id)}
                      style={{
                        padding: '12px',
                        border: selectedGroup === group.id ? '2px solid #3B82F6' : '1px solid #E5E7EB',
                        borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s ease',
                        backgroundColor: selectedGroup === group.id ? '#EFF6FF' : '#FFFFFF'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{
                            width: '16px', height: '16px', borderRadius: '50%',
                            backgroundColor: group.color, border: '1px solid #D1D5DB'
                          }} />
                          <span style={{ fontWeight: '500', fontSize: '14px', color: '#1F2937' }}>
                            {group.name}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGroupToggle(group.id);
                          }}
                          style={{
                            padding: '4px', background: 'none', border: 'none',
                            borderRadius: '4px', cursor: 'pointer', color: '#6B7280'
                          }}
                        >
                          {group.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Background Picker */}
              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
                  Background Color
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {BACKGROUND_COLORS.map((bg) => (
                    <button
                      key={bg.color}
                      onClick={() => setBackgroundColor(bg.color)}
                      style={{
                        padding: '8px 12px',
                        border: backgroundColor === bg.color ? '2px solid #3B82F6' : '1px solid #E5E7EB',
                        borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s ease',
                        backgroundColor: backgroundColor === bg.color ? '#EFF6FF' : '#FFFFFF',
                        display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px'
                      }}
                    >
                      <div style={{
                        width: '16px', height: '16px', borderRadius: '4px',
                        backgroundColor: `#${bg.color.toString(16).padStart(6, '0')}`,
                        border: '1px solid #D1D5DB'
                      }} />
                      {bg.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Picker */}
              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
                  Paint {getCurrentMaskingGroups().find(g => g.id === selectedGroup)?.name || 'Selected Group'}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
                  {PAINT_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => handleColorSelect(color)}
                      style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        border: selectedColor === color ? '3px solid #1F2937' : '2px solid #D1D5DB',
                        backgroundColor: color, cursor: 'pointer', transition: 'all 0.2s ease',
                        boxShadow: selectedColor === color ? '0 4px 14px 0 rgba(0, 0, 0, 0.3)' : '0 2px 4px 0 rgba(0, 0, 0, 0.1)'
                      }}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              {/* SAM Test Section */}
              {modelData && (
                <div style={{
                  background: 'white', borderRadius: '16px', padding: '24px',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
                }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '16px' }}>
                    🎯 Optimized SAM Segmentation
                  </h3>
                  <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
                    <button
                      onClick={() => {
                        console.log('🚀 Starting OPTIMIZED SAM analysis...');
                        if ((window as any).testSAMCapture) {
                          (window as any).testSAMCapture();
                        } else {
                          console.error('❌ SAM function not available');
                          alert('SAM function not ready. Please wait for scene to load.');
                        }
                      }}
                      style={{
                        padding: '12px 24px',
                        background: 'linear-gradient(to right, #10B981, #059669)',
                        color: 'white',
                        borderRadius: '8px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '600'
                      }}
                    >
                      🎯 Run Optimized SAM (8-12 Regions)
                    </button>
                    
                    <button
                      onClick={() => {
                        console.log('🎨 Quick UI test with mock SAM data...');
                        const quickMockResults = {
                          masks: [
                            { mask_id: 0, area: 1500, stability_score: 0.99, vertices: [] },
                            { mask_id: 1, area: 1200, stability_score: 0.92, vertices: [] },
                            { mask_id: 2, area: 900, stability_score: 0.88, vertices: [] }
                          ],
                          viewport_size: { width: 1024, height: 1024 },
                          camera_data: {
                            camera_matrix: Array(16).fill(0),
                            projection_matrix: Array(16).fill(0)
                          }
                        };
                        
                        if ((window as any).onSAMResults) {
                          (window as any).onSAMResults(quickMockResults);
                          console.log('✅ Quick mock test completed');
                        }
                      }}
                      style={{
                        padding: '8px 16px',
                        background: 'linear-gradient(to right, #8B5CF6, #7C3AED)',
                        color: 'white',
                        borderRadius: '6px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '500'
                      }}
                    >
                      🎨 Quick Mock Test (UI Only)
                    </button>
                    
                    <button
                      onClick={async () => {
                        try {
                          const response = await fetch('http://localhost:5000/health');
                          if (response.ok) {
                            const result = await response.json();
                            alert(`Backend Status: ${result.status}\nSAM Loaded: ${result.sam_loaded}`);
                          } else {
                            alert('Backend connection failed');
                          }
                        } catch (error) {
                          alert('Backend not available');
                        }
                      }}
                      style={{
                        padding: '8px 16px',
                        background: 'linear-gradient(to right, #3B82F6, #1D4ED8)',
                        color: 'white',
                        borderRadius: '6px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '500'
                      }}
                    >
                      Test Backend Connection
                    </button>
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '8px', lineHeight: '1.4' }}>
                    <div style={{ marginBottom: '4px' }}>
                      <strong>🎯 Optimized SAM:</strong> Uses research-based parameters for ~10 meaningful regions
                    </div>
                    <div style={{ marginBottom: '4px' }}>
                      <strong>🎨 Mock Test:</strong> UI testing with fake data (no backend required)
                    </div>
                    <div>
                      <strong>Status:</strong> Scene {meshRef.current && cameraRef.current && rendererRef.current ? '✅ Ready' : '⏳ Loading'} for processing
                    </div>
                  </div>
                </div>
              )}

              {/* Model Info */}
              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
              }}>
                <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '16px' }}>
                  Model Info
                </h3>
                <div style={{ fontSize: '14px', color: '#4B5563', lineHeight: '1.6' }}>
                  <div><strong>Name:</strong> {modelData.name}</div>
                  <div><strong>Size:</strong> {(modelData.size / 1024 / 1024).toFixed(2)} MB</div>
                  <div><strong>Type:</strong> {modelData.name.split('.').pop()?.toUpperCase()}</div>
                  <div><strong>Uploaded:</strong> {modelData.uploadedAt.toLocaleString()}</div>
                </div>
              </div>

              {/* SAM Results Info */}
              {samMasks.length > 0 && (
                <div style={{
                  background: 'white', borderRadius: '16px', padding: '24px',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginTop: '20px'
                }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '16px' }}>
                    🎭 SAM Analysis Results
                  </h3>
                  <div style={{ fontSize: '14px', color: '#4B5563', lineHeight: '1.6' }}>
                    <div><strong>Status:</strong> ✅ SAM Segmentation Complete</div>
                    <div><strong>Detected Regions:</strong> {samMasks.length}</div>
                    <div><strong>Individual Groups:</strong> {samMaskGroups.length}</div>
                    <div><strong>Largest Region:</strong> {Math.max(...samMasks.map(m => m.area)).toLocaleString()} pixels</div>
                    <div><strong>Average Confidence:</strong> {(samMasks.reduce((sum, m) => sum + m.stability_score, 0) / samMasks.length).toFixed(3)}</div>
                    
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #E5E7EB' }}>
                      <div><strong>3D Mapping:</strong> {useSAMGroups ? '🎭 Active' : '📐 Geometric Mode'}</div>
                      <div><strong>Scene Ready:</strong> {meshRef.current && cameraRef.current && rendererRef.current ? '✅ Yes' : '⏳ Initializing'}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', paddingTop: '60px' }}>
            <div style={{
              background: 'white', borderRadius: '16px', padding: '48px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', maxWidth: '500px', margin: '0 auto'
            }}>
              <div style={{ color: '#9CA3AF', marginBottom: '16px' }}>
                <Upload size={64} style={{ margin: '0 auto' }} />
              </div>
              <h3 style={{ fontSize: '24px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>
                No Model Uploaded
              </h3>
              <p style={{ color: '#6B7280', fontSize: '16px', marginBottom: '16px' }}>
                Upload an STL file to start painting your miniature
                {backendStatus === 'connected' && (
                  <span style={{ display: 'block', marginTop: '8px', color: '#10B981', fontWeight: '500' }}>
                    🤖 AI-powered 3D segmentation ready!
                  </span>
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;