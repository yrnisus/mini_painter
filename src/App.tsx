import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, Brain, Zap, Camera, Palette, Eye, EyeOff, Layers, CheckCircle, AlertCircle } from 'lucide-react';
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

interface SemanticRegion {
  id: string;
  name: string;
  semantic_type: string;
  vertices: number[];
  confidence: number;
  area: number;
}

interface OptimizedSAMResponse {
  success: boolean;
  num_regions: number;
  regions: SemanticRegion[];
  stats: {
    original_masks: number;
    semantic_regions: number;
    reduction_ratio: number;
    miniature_type: string;
    processing_method: string;
  };
  research_features: string[];
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

// STL Loader Functions
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

// FIXED: Masking Utils with SAM Integration
const createGeometricMasking = (geometry: THREE.BufferGeometry, maskingGroups: MaskingGroup[]): VertexMasking => {
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

// FIXED: Apply vertex colors with proper SAM mapping support
const applyVertexColors = (
  geometry: THREE.BufferGeometry, 
  masking: VertexMasking, 
  maskingGroups: MaskingGroup[], 
  paintColors: PaintColors
): THREE.BufferGeometry => {
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const vertexCount = positions.count;
  const colors = new Float32Array(vertexCount * 3);
  
  console.log('🎨 Applying vertex colors to', vertexCount, 'vertices');
  console.log('🎨 Masking groups:', maskingGroups.map(g => g.id));
  console.log('🎨 Masking data:', Object.entries(masking).map(([id, vertices]) => `${id}: ${vertices.length} vertices`));
  
  // Default neutral gray color
  const defaultColor = new THREE.Color(0xCCCCCC);
  for (let i = 0; i < vertexCount; i++) {
    colors[i * 3] = defaultColor.r;
    colors[i * 3 + 1] = defaultColor.g;
    colors[i * 3 + 2] = defaultColor.b;
  }
  
  // Apply colors for each masking group
  Object.entries(masking).forEach(([groupId, vertices]) => {
    const group = maskingGroups.find(g => g.id === groupId);
    if (!group || !group.visible || !vertices || vertices.length === 0) {
      console.log(`🎨 Skipping group ${groupId}: group=${!!group}, visible=${group?.visible}, vertices=${vertices?.length}`);
      return;
    }
    
    const colorHex = paintColors[groupId] || group.color;
    const color = new THREE.Color(colorHex);
    
    console.log(`🎨 Applying color ${colorHex} to ${vertices.length} vertices for group ${groupId}`);
    
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

// FIXED: SAM Results Processing for Real Geometric Data
const processOptimizedSAMResults = (optimizedResult: OptimizedSAMResponse): {
  vertexMapping: VertexMasking;
  maskingGroups: MaskingGroup[];
} => {
  console.log('🎯 PROCESSING REAL OPTIMIZED SAM RESULTS...');
  console.log(`Input: ${optimizedResult.num_regions} semantic regions`);
  console.log('Research features:', optimizedResult.research_features);
  console.log('Processing method:', optimizedResult.stats.processing_method);
  
  const vertexMapping: VertexMasking = {};
  const maskingGroups: MaskingGroup[] = [];
  
  // Color mapping for semantic types
  const semanticColors: { [key: string]: string } = {
    'base': '#8B4513',      // Brown
    'legs': '#4682B4',      // Steel blue
    'torso': '#C0C0C0',     // Silver
    'arms': '#CD853F',      // Peru
    'head': '#F5DEB3',      // Wheat
    'weapon': '#2F4F4F',    // Dark slate gray
    'cape': '#800080',      // Purple
    'details': '#FFD700',   // Gold
    'body': '#D2B48C',      // Tan
    'limbs': '#A0522D',     // Sienna
    'unassigned': '#808080' // Gray for unassigned
  };
  
  optimizedResult.regions.forEach((region, index) => {
    const groupId = region.id;
    const color = semanticColors[region.semantic_type] || `hsl(${index * 40}, 70%, 60%)`;
    
    // FIXED: Store vertex mapping directly from backend
    vertexMapping[groupId] = [...region.vertices]; // Copy the array
    
    // Create masking group with semantic info
    maskingGroups.push({
      id: groupId,
      name: `${region.name} (${region.vertices.length}v)`,
      color: color,
      visible: true
    });
    
    console.log(`  ✅ ${region.semantic_type}: ${region.vertices.length} vertices (${region.confidence.toFixed(2)} confidence)`);
  });
  
  const totalVertices = Object.values(vertexMapping).reduce((sum, vertices) => sum + vertices.length, 0);
  console.log(`✅ REAL SAM processing complete:`);
  console.log(`   Regions: ${maskingGroups.length}`);
  console.log(`   Total vertices assigned: ${totalVertices}`);
  console.log(`   Reduction ratio: ${optimizedResult.stats.reduction_ratio.toFixed(1)}x`);
  
  // FIXED: Verify vertex assignments
  console.log('🔍 Vertex assignment verification:');
  Object.entries(vertexMapping).forEach(([groupId, vertices]) => {
    const percentage = totalVertices > 0 ? (vertices.length / totalVertices * 100).toFixed(1) : '0';
    console.log(`   ${groupId}: ${vertices.length} vertices (${percentage}%)`);
  });

  return { vertexMapping, maskingGroups };
};

// Three.js Scene Component - FIXED for SAM integration
interface ThreeSceneProps {
  paintColors: PaintColors;
  maskingGroups: MaskingGroup[];
  modelData: ModelData | null;
  backgroundColor: number;
  selectedGroup: string;
  onRefsReady?: (mesh: THREE.Mesh | null, camera: THREE.PerspectiveCamera | null, renderer: THREE.WebGLRenderer | null) => void;
  // FIXED: Add SAM vertex mapping prop
  samVertexMapping?: VertexMasking | null;
}

const ThreeScene: React.FC<ThreeSceneProps> = ({ 
  paintColors, 
  maskingGroups, 
  modelData, 
  backgroundColor,
  selectedGroup,
  onRefsReady,
  samVertexMapping // FIXED: SAM mapping prop
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

    // Setup lighting
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
    };
  }, [onRefsReady]);

  // Background color updates  
  useEffect(() => {
    if (sceneRef.current && rendererRef.current) {
      sceneRef.current.background = new THREE.Color(backgroundColor);
      rendererRef.current.setClearColor(backgroundColor, 1);
    }
  }, [backgroundColor]);

  // FIXED: Model loading with SAM mapping support
  useEffect(() => {
    if (!modelData?.geometry || !sceneRef.current) return;
    
    console.log('🎯 Loading model with SAM mapping support...');
    console.log('SAM mapping available:', !!samVertexMapping);
    
    const geometry = modelData.geometry.clone();
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }
    
    // FIXED: Use SAM mapping if available, otherwise use geometric masking
    let masking: VertexMasking;
    if (samVertexMapping) {
      console.log('🎭 Using SAM vertex mapping');
      masking = samVertexMapping;
    } else {
      console.log('📐 Using geometric masking');
      masking = createGeometricMasking(geometry, maskingGroups);
    }
    
    // Apply vertex colors
    applyVertexColors(geometry, masking, maskingGroups, paintColors);

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
  }, [modelData, maskingGroups, onRefsReady, samVertexMapping]); // FIXED: Add samVertexMapping dependency
  
  // FIXED: Update vertex colors when paint colors or masking groups change
  useEffect(() => {
    if (meshRef.current && vertexMaskingRef.current) {
      console.log('🎨 Updating vertex colors...');
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

// Main App Component - FIXED
const App: React.FC = () => {
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [paintColors, setPaintColors] = useState<PaintColors>({});
  const [maskingGroups, setMaskingGroups] = useState<MaskingGroup[]>(MASKING_GROUPS);
  const [selectedGroup, setSelectedGroup] = useState<string>('base_support');
  const [selectedColor, setSelectedColor] = useState<string>('#FF0000');
  const [backgroundColor, setBackgroundColor] = useState<number>(0xffffff);
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');
  const [optimizedSAMResults, setOptimizedSAMResults] = useState<OptimizedSAMResponse | null>(null);
  // FIXED: Add SAM vertex mapping state
  const [samVertexMapping, setSamVertexMapping] = useState<VertexMasking | null>(null);

  // Refs for SAM integration
  const meshRef = useRef<THREE.Mesh | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Check backend connection on component mount
  useEffect(() => {
    checkBackendConnection();
  }, []);

  const checkBackendConnection = async () => {
    try {
      const response = await fetch('http://localhost:5000/health');
      if (response.ok) {
        const data = await response.json();
        setBackendStatus('connected');
        console.log('✅ Backend connected:', data);
      } else {
        setBackendStatus('error');
      }
    } catch (error) {
      setBackendStatus('error');
      console.log('❌ Backend connection failed:', error);
    }
  };

  const handleRefsReady = useCallback((
    mesh: THREE.Mesh | null, 
    camera: THREE.PerspectiveCamera | null, 
    renderer: THREE.WebGLRenderer | null
  ) => {
    meshRef.current = mesh;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    console.log('🔗 Scene refs updated:', { mesh: !!mesh, camera: !!camera, renderer: !!renderer });
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
      setOptimizedSAMResults(null);
      setSamVertexMapping(null); // FIXED: Clear SAM mapping on new model
      setMaskingGroups(MASKING_GROUPS); // FIXED: Reset to default groups
      
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
    setMaskingGroups(prev => 
      prev.map(group => 
        group.id === groupId ? { ...group, visible: !group.visible } : group
      )
    );
  }, []);

  const handleColorSelect = useCallback((color: string) => {
    setSelectedColor(color);
    setPaintColors(prev => ({ ...prev, [selectedGroup]: color }));
  }, [selectedGroup]);

  // FIXED: Optimized SAM Integration with proper state management
  const runOptimizedSAM = async () => {
    if (!meshRef.current || !cameraRef.current || !rendererRef.current || !modelData) {
      alert('❌ Scene not ready. Please ensure a 3D model is loaded.');
      return;
    }

    console.log('🚀 Starting REAL optimized SAM segmentation...');

    try {
      // Step 1: Initialize optimized SAM
      console.log('🤖 Initializing optimized SAM...');
      const initResponse = await fetch('http://localhost:5000/init-optimized-sam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_type: 'vit_h',
          device: 'cpu'
        })
      });

      if (!initResponse.ok) {
        throw new Error(`Initialization failed: ${initResponse.statusText}`);
      }

      const initResult = await initResponse.json();
      console.log('✅ SAM initialized:', initResult);

      // Step 2: Position camera and capture image
      console.log('📸 Capturing optimal view...');
      cameraRef.current.position.set(0, 8, 12);
      cameraRef.current.lookAt(0, 4, 0);
      cameraRef.current.updateMatrixWorld();
      rendererRef.current.render(meshRef.current.parent as THREE.Scene, cameraRef.current);

      const imageData = rendererRef.current.domElement.toDataURL('image/png');

      // Step 3: Extract mesh vertices - FIXED to match backend format
      const geometry = meshRef.current.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      const vertices: number[][] = [];
      
      for (let i = 0; i < positions.count; i++) {
        vertices.push([
          positions.getX(i),
          positions.getY(i),
          positions.getZ(i)
        ]);
      }

      console.log(`📊 Processing ${vertices.length} vertices for REAL semantic segmentation`);

      // Step 4: Send to optimized backend
      const segmentResponse = await fetch('http://localhost:5000/segment-optimized', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          color_image: imageData,
          vertices: vertices,
          miniature_type: 'humanoid',
          camera_matrix: cameraRef.current.matrixWorld.toArray(),
          projection_matrix: cameraRef.current.projectionMatrix.toArray(),
          viewport_size: { width: 1024, height: 1024 }
        })
      });

      if (!segmentResponse.ok) {
        throw new Error(`Segmentation failed: ${segmentResponse.statusText}`);
      }

      const result: OptimizedSAMResponse = await segmentResponse.json();
      console.log(`✅ REAL SAM success: ${result.num_regions} semantic regions`);

      // Step 5: Process results and update UI - FIXED
      const { vertexMapping, maskingGroups: samGroups } = processOptimizedSAMResults(result);
      
      setOptimizedSAMResults(result);
      setMaskingGroups(samGroups); // FIXED: Update masking groups
      setSamVertexMapping(vertexMapping); // FIXED: Set SAM mapping
      setPaintColors({}); // Clear existing paint colors

      console.log('🎨 REAL semantic regions applied:');
      result.regions.forEach(region => {
        console.log(`   ${region.semantic_type}: ${region.name} (${region.vertices.length} vertices)`);
      });

    } catch (error) {
      console.error('❌ REAL optimized SAM failed:', error);
      alert(`❌ Optimized SAM failed: ${error}`);
    }
  };

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
            🎯 REAL Geometric SAM Painter
          </h1>
          <p style={{ fontSize: '18px', color: '#6B7280', fontWeight: '500' }}>
            Height-based & radial detection with real 3D coordinate analysis
          </p>
          
          <div style={{ 
            marginTop: '16px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '8px',
            fontSize: '14px'
          }}>
            {backendStatus === 'connected' ? (
              <React.Fragment>
                <CheckCircle size={16} style={{ color: '#10B981' }} />
                <span style={{ color: '#10B981', fontWeight: '600' }}>Real Geometry Analysis Ready</span>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <AlertCircle size={16} style={{ color: '#F59E0B' }} />
                <span style={{ color: '#F59E0B', fontWeight: '600' }}>Backend Offline - Mock Mode</span>
              </React.Fragment>
            )}
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
                  {optimizedSAMResults && (
                    <span style={{ 
                      marginLeft: '12px', 
                      fontSize: '14px', 
                      color: '#10B981', 
                      fontWeight: '500',
                      padding: '4px 8px',
                      backgroundColor: '#ECFDF5',
                      borderRadius: '4px'
                    }}>
                      🎯 Real Geometry SAM Active
                    </span>
                  )}
                </h2>
                
                <ThreeScene 
                  paintColors={paintColors} 
                  maskingGroups={maskingGroups} 
                  modelData={modelData} 
                  backgroundColor={backgroundColor}
                  selectedGroup={selectedGroup}
                  onRefsReady={handleRefsReady}
                  samVertexMapping={samVertexMapping} // FIXED: Pass SAM mapping
                />
              </div>
            </div>

            <div>
              {/* Optimized SAM Panel */}
              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Brain size={20} />
                  Real Geometric SAM Analysis
                </h3>
                
                <button
                  onClick={runOptimizedSAM}
                  disabled={!modelData}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: 'white',
                    border: 'none',
                    cursor: !modelData ? 'not-allowed' : 'pointer',
                    background: !modelData 
                      ? '#9CA3AF' 
                      : 'linear-gradient(to right, #10B981, #3B82F6)',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    marginBottom: '16px'
                  }}
                >
                  <Zap size={20} />
                  Run Real Geometry Analysis
                </button>

                {optimizedSAMResults && (
                  <div style={{
                    padding: '12px',
                    backgroundColor: '#ECFDF5',
                    border: '1px solid #BBF7D0',
                    borderRadius: '6px',
                    marginBottom: '16px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <CheckCircle size={16} style={{ color: '#059669' }} />
                      <span style={{ fontSize: '14px', fontWeight: '500', color: '#065F46' }}>
                        Real Geometry Results
                      </span>
                    </div>
                    <div style={{ fontSize: '14px', color: '#047857' }}>
                      <div>🎯 Regions: {optimizedSAMResults.num_regions}</div>
                      <div>📊 Method: {optimizedSAMResults.stats.processing_method}</div>
                      <div>🎨 Geometry: Real height & radial analysis</div>
                    </div>
                  </div>
                )}

                <div style={{
                  backgroundColor: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  borderRadius: '6px',
                  padding: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <Layers size={16} style={{ color: '#2563EB', marginTop: '2px' }} />
                    <div style={{ fontSize: '14px', color: '#1E40AF' }}>
                      <div style={{ fontWeight: '500', marginBottom: '4px' }}>Real Geometry Features:</div>
                      <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', lineHeight: '1.5' }}>
                        <li>Height-based segmentation (Y coordinates)</li>
                        <li>Radial detection (X,Z distance from center)</li>
                        <li>Back region detection (Z coordinates)</li>
                        <li>No vertex overlap - accurate assignments</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              {/* Masking Panel */}
              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Palette size={20} />
                  Painting Regions {samVertexMapping ? '(SAM)' : '(Geometric)'}
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {maskingGroups.map((group) => (
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

              {/* Color Picker */}
              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
                  Paint {maskingGroups.find(g => g.id === selectedGroup)?.name || 'Selected Group'}
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
                  {optimizedSAMResults && (
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #E5E7EB' }}>
                      <div><strong>SAM Status:</strong> ✅ Real geometry ({optimizedSAMResults.num_regions} regions)</div>
                      <div><strong>Method:</strong> {optimizedSAMResults.stats.processing_method}</div>
                    </div>
                  )}
                </div>
              </div>
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
                    🎯 Real geometry analysis ready!
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