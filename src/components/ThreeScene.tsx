import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { PaintColors, MaskingGroup, ModelData } from '../types/index';

interface ThreeSceneProps {
  paintColors: PaintColors;
  maskingGroups: MaskingGroup[];
  modelData: ModelData | null;
  backgroundColor: number;
  selectedGroup: string;
  aiAnalysis?: any;
}

const ThreeScene: React.FC<ThreeSceneProps> = ({ 
  paintColors, 
  maskingGroups, 
  modelData, 
  backgroundColor,
  selectedGroup,
  aiAnalysis
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const vertexMaskingRef = useRef<{[groupId: string]: number[]} | null>(null);
  
  // Fixed orbit center that doesn't change (this prevents snapping)
  const orbitCenterRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 6, 0));

  // SAM Test Capture Functions
  const captureViewForSAM = (
    scene: THREE.Scene, 
    camera: THREE.PerspectiveCamera, 
    renderer: THREE.WebGLRenderer
  ) => {
    console.log('📸 captureViewForSAM called');
    
    const width = 1024;
    const height = 1024;
    
    try {
      console.log('📸 Capturing view for SAM...');
      console.log('Renderer domElement exists:', !!renderer.domElement);
      
      // Simple approach: just capture the current canvas
      const colorPNG = renderer.domElement.toDataURL('image/png');
      console.log('📷 PNG captured, length:', colorPNG.length);
      
      // For now, create mock depth data (we'll improve this later)
      const depthArray = new Float32Array(width * height);
      depthArray.fill(0.5); // Mock depth
      
      const viewData = {
        colorPNG,
        depthArray,
        cameraMatrix: camera.matrixWorld.toArray(),
        projectionMatrix: camera.projectionMatrix.toArray(),
        viewportSize: { width, height }
      };
      
      console.log('✅ View captured:', {
        colorSize: colorPNG.length,
        hasCamera: viewData.cameraMatrix.length > 0,
        hasPNG: colorPNG.startsWith('data:image/png')
      });
      
      return viewData;
    } catch (error) {
      console.error('❌ Error in captureViewForSAM:', error);
      throw error;
    }
  };

  const testSingleViewCapture = (
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    mesh: THREE.Mesh
  ) => {
    console.log('🎯 testSingleViewCapture called!');
    console.log('Parameters:', { scene: !!scene, camera: !!camera, renderer: !!renderer, mesh: !!mesh });
    
    try {
      // Position camera for optimal front view
      console.log('📍 Positioning camera...');
      camera.position.set(0, 10, 15);
      camera.lookAt(0, 6, 0);
      camera.updateMatrixWorld();
      
      // Force a render
      console.log('🎨 Forcing render...');
      renderer.render(scene, camera);
      
      // Capture the current view
      console.log('📸 Capturing view...');
      const viewData = captureViewForSAM(scene, camera, renderer);
      
      // Send to backend for SAM processing
      console.log('🤖 Sending to backend...');
      sendToSAMBackend(viewData);
      
      console.log('✅ testSingleViewCapture completed');
      return viewData;
    } catch (error) {
      console.error('❌ Error in testSingleViewCapture:', error);
    }
  };

  const sendToSAMBackend = async (viewData: any) => {
    console.log('🤖 sendToSAMBackend called');
    
    try {
      console.log('🤖 Sending view to SAM backend...');
      console.log('Backend URL: http://localhost:5000/segment-single-view');
      console.log('View data keys:', Object.keys(viewData));
      
      // First, let's test if the endpoint exists
      console.log('🔍 Testing if endpoint exists...');
      try {
        const testResponse = await fetch('http://localhost:5000/segment-single-view', {
          method: 'OPTIONS'
        });
        console.log('OPTIONS response:', testResponse.status);
      } catch (optionsError) {
        console.warn('OPTIONS test failed:', optionsError);
      }
      
      const payload = {
        color_image: viewData.colorPNG,
        depth_array: Array.from(viewData.depthArray),
        camera_matrix: viewData.cameraMatrix,
        projection_matrix: viewData.projectionMatrix,
        viewport_size: viewData.viewportSize
      };
      
      console.log('📤 Payload prepared:', {
        color_image_length: payload.color_image.length,
        depth_array_length: payload.depth_array.length,
        camera_matrix_length: payload.camera_matrix.length,
        viewport_size: payload.viewport_size
      });
      
      console.log('📤 Making POST request...');
      
      const response = await fetch('http://localhost:5000/segment-single-view', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });
      
      console.log('📥 Response received:', {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ SAM segmentation result:', result);
        console.log(`🎭 Found ${result.num_masks} masks!`);
        
        // Log mask details
        result.masks?.forEach((mask: any, i: number) => {
          console.log(`Mask ${i}: ${mask.pixel_coords?.length || 0} pixels, area=${mask.area}, score=${mask.stability_score?.toFixed(3)}`);
        });
        
        return result;
      } else {
        const errorText = await response.text();
        console.error('❌ SAM backend error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
      }
    } catch (error) {
      console.error('❌ Network error sending to SAM backend:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
  };

  // Add test capture function to window for easy access
  useEffect(() => {
    console.log('🔧 Setting up enhanced SAM test function, modelData:', !!modelData);
    
    (window as any).testSAMCapture = () => {
      console.log('🎯 Enhanced SAM test called!');
      console.log('Scene refs:', {
        scene: !!sceneRef.current,
        camera: !!cameraRef.current,
        renderer: !!rendererRef.current,
        mesh: !!meshRef.current
      });
      
      if (sceneRef.current && cameraRef.current && rendererRef.current && meshRef.current) {
        console.log('✅ All refs available, calling enhanced SAM mapping...');
        try {
          testSAMTo3DMapping(
            sceneRef.current,
            cameraRef.current,
            rendererRef.current,
            meshRef.current
          );
        } catch (error) {
          console.error('❌ Error in enhanced SAM mapping:', error);
        }
      } else {
        console.log('❌ Scene not ready for capture');
        console.log('Missing refs:', {
          scene: !sceneRef.current,
          camera: !cameraRef.current,
          renderer: !rendererRef.current,
          mesh: !meshRef.current
        });
      }
    };
    
    // Also add the old simple test for comparison
    (window as any).testSAMCaptureSimple = () => {
      if (sceneRef.current && cameraRef.current && rendererRef.current && meshRef.current) {
        testSingleViewCapture(
          sceneRef.current,
          cameraRef.current,
          rendererRef.current,
          meshRef.current
        );
      }
    };
    
    console.log('✅ Enhanced SAM functions set on window');
    
    return () => {
      console.log('🧹 Cleaning up SAM functions');
      delete (window as any).testSAMCapture;
      delete (window as any).testSAMCaptureSimple;
    };
  }, [modelData]);

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

    // Lighting
    scene.add(new THREE.AmbientLight(0x404040, 3.0));
    const frontLight = new THREE.DirectionalLight(0xffffff, 4.0);
    frontLight.position.set(0, 10, 20);
    frontLight.castShadow = false;
    scene.add(frontLight);
    
    const topLight = new THREE.DirectionalLight(0xffffff, 2.0);
    topLight.position.set(0, 20, 0);
    topLight.castShadow = false;
    scene.add(topLight);

    // Mouse controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    const handleMouseDown = (event: MouseEvent) => {
      isDragging = true;
      previousMousePosition = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    };

    const handleMouseUp = () => { isDragging = false; };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging || !cameraRef.current) return;
      event.preventDefault();
      
      const deltaMove = {
        x: event.clientX - previousMousePosition.x,
        y: event.clientY - previousMousePosition.y
      };

      const orbitCenter = orbitCenterRef.current;
      const cameraOffset = cameraRef.current.position.clone().sub(orbitCenter);
      const spherical = new THREE.Spherical();
      spherical.setFromVector3(cameraOffset);
      
      spherical.theta -= deltaMove.x * 0.01;
      spherical.phi -= deltaMove.y * 0.01;
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
      
      cameraRef.current.position.setFromSpherical(spherical).add(orbitCenter);
      cameraRef.current.lookAt(orbitCenter);
      
      previousMousePosition = { x: event.clientX, y: event.clientY };
    };

    const handleWheel = (event: WheelEvent) => {
      if (!cameraRef.current) return;
      event.preventDefault();
      
      const camera = cameraRef.current;
      const orbitCenter = orbitCenterRef.current;
      const direction = camera.position.clone().sub(orbitCenter).normalize();
      const moveAmount = event.deltaY * 0.05;
      const newPosition = camera.position.clone().add(direction.multiplyScalar(moveAmount));
      
      const distanceFromCenter = newPosition.distanceTo(orbitCenter);
      if (distanceFromCenter > 2 && distanceFromCenter < 50) {
        camera.position.copy(newPosition);
      }
      
      camera.lookAt(orbitCenter);
    };

    const canvas = renderer.domElement;
    canvas.addEventListener('mousedown', handleMouseDown, { passive: false });
    canvas.addEventListener('mouseup', handleMouseUp, { passive: false });
    canvas.addEventListener('mousemove', handleMouseMove, { passive: false });
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    
    window.addEventListener('mouseup', handleMouseUp, { passive: false });
    window.addEventListener('mousemove', handleMouseMove, { passive: false });

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      if (rendererRef.current && cameraRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    
    animate();

    return () => {
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('wheel', handleWheel);
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
  }, []);

  // Background color updates  
  useEffect(() => {
    if (sceneRef.current && rendererRef.current) {
      sceneRef.current.background = new THREE.Color(backgroundColor);
      rendererRef.current.setClearColor(backgroundColor, 1);
    }
  }, [backgroundColor]);

  // Create geometric masking based on mesh properties
  const createGeometricMasking = (geometry: THREE.BufferGeometry) => {
    const positions = geometry.attributes.position;
    const vertexCount = positions.count;
    const masking: {[groupId: string]: number[]} = {};
    
    // Initialize masking groups
    maskingGroups.forEach(group => {
      masking[group.id] = [];
    });
    
    // Get bounding box and center
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox!;
    const size = bbox.getSize(new THREE.Vector3());
    const center = bbox.getCenter(new THREE.Vector3());
    
    console.log(`Creating masking for ${vertexCount} vertices`);
    console.log(`Bounding box: min=${bbox.min.toArray()}, max=${bbox.max.toArray()}`);
    console.log(`Size: ${size.toArray()}, Center: ${center.toArray()}`);
    
    // Use AI analysis grouping if available
    if (aiAnalysis?.success && aiAnalysis.masking_groups) {
      const aiGroups = aiAnalysis.masking_groups;
      console.log('Using AI-based geometric segmentation with', Object.keys(aiGroups).length, 'groups');
      console.log('AI Groups:', Object.keys(aiGroups));
      console.log('Frontend Groups:', maskingGroups.map(g => g.id));
      
      // Calculate AI group proportions and height zones
      const totalAIVertices = Object.values(aiGroups).reduce((sum: number, group: any) => 
        sum + (group.vertices?.length || 0), 0
      );
      
      console.log(`Backend vertices: ${totalAIVertices}, Frontend vertices: ${vertexCount}`);
      
      // Create height-based zones using AI proportions
      const groupZones: Array<{id: string, heightRange: [number, number], proportion: number}> = [];
      let currentHeight = 0;
      
      // Sort groups by their typical height (base->upper)
      const sortedGroups = [
        'base_support',
        'lower_section', 
        'main_body',
        'details',
        'upper_section'
      ].filter(id => aiGroups[id]);
      
      sortedGroups.forEach(groupId => {
        const group = aiGroups[groupId];
        const proportion = group.vertices?.length / totalAIVertices || 0;
        const heightSpan = proportion * 0.8; // Use 80% of proportional height
        
        groupZones.push({
          id: groupId,
          heightRange: [currentHeight, currentHeight + heightSpan],
          proportion: proportion
        });
        
        currentHeight += heightSpan;
      });
      
      console.log('AI-based height zones:', groupZones);
      
      // Apply AI-informed geometric segmentation
      groupZones.forEach(zone => {
        const frontendGroup = maskingGroups.find(g => g.id === zone.id);
        if (!frontendGroup) return;
        
        masking[zone.id] = [];
        
        for (let i = 0; i < vertexCount; i++) {
          const x = positions.getX(i);
          const y = positions.getY(i);
          const z = positions.getZ(i);
          
          const normalizedY = (y - bbox.min.y) / size.y;
          const distanceFromCenter = Math.sqrt(
            Math.pow(x - center.x, 2) + Math.pow(z - center.z, 2)
          );
          const normalizedRadius = distanceFromCenter / (size.x * 0.5);
          
          let inZone = false;
          
          // Special logic per AI group type
          if (zone.id === 'base_support') {
            inZone = normalizedY < 0.15;
          } else if (zone.id === 'lower_section') {
            inZone = normalizedY >= 0.15 && normalizedY < 0.45;
          } else if (zone.id === 'main_body') {
            inZone = normalizedY >= 0.45 && normalizedY < 0.7 && normalizedRadius < 0.7;
          } else if (zone.id === 'details') {
            inZone = normalizedRadius > 0.7 || (normalizedY > 0.7 && normalizedRadius > 0.4);
          } else if (zone.id === 'upper_section') {
            inZone = normalizedY >= 0.7 && normalizedRadius < 0.4;
          }
          
          if (inZone) {
            masking[zone.id].push(i);
          }
        }
        
        console.log(`AI-informed mapping ${zone.id}: ${masking[zone.id].length} vertices`);
      });
    } else {
      // Fallback geometric segmentation
      console.log('Using fallback geometric segmentation');
      
      for (let i = 0; i < vertexCount; i++) {
        const y = positions.getY(i);
        const normalizedY = (y - bbox.min.y) / size.y;
        
        // Simple height-based assignment
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
          // Fallback to first group
          masking[maskingGroups[0].id]?.push(i);
        }
      }
    }
    
    // Log results
    const assignments = Object.entries(masking).map(([groupId, vertices]) => 
      `${groupId}: ${vertices.length} vertices (${(vertices.length / vertexCount * 100).toFixed(1)}%)`
    );
    console.log('Vertex masking created:', assignments);
    
    return masking;
  };

  // Apply vertex colors based on masking groups and paint colors
  const applyVertexColors = (geometry: THREE.BufferGeometry, masking: {[groupId: string]: number[]}) => {
    const positions = geometry.attributes.position;
    const vertexCount = positions.count;
    const colors = new Float32Array(vertexCount * 3);
    
    // Default color (gray)
    const defaultColor = new THREE.Color(0xA0A0A0);
    for (let i = 0; i < vertexCount; i++) {
      colors[i * 3] = defaultColor.r;
      colors[i * 3 + 1] = defaultColor.g;
      colors[i * 3 + 2] = defaultColor.b;
    }
    
    // Apply colors for each masking group
    Object.entries(masking).forEach(([groupId, vertices]) => {
      const group = maskingGroups.find(g => g.id === groupId);
      if (!group || !group.visible || !vertices || vertices.length === 0) return;
      
      // Use paint color if available, otherwise use group's default color
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

  // Model loading with improved masking
  useEffect(() => {
    if (!modelData?.geometry || !sceneRef.current) return;

    if (meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      if (meshRef.current.geometry) meshRef.current.geometry.dispose();
      if (meshRef.current.material) (meshRef.current.material as THREE.Material).dispose();
    }

    // Clone and prepare geometry
    const geometry = modelData.geometry.clone();
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }
    
    // Create vertex masking
    const masking = createGeometricMasking(geometry);
    vertexMaskingRef.current = masking;
    
    // Apply initial vertex colors
    applyVertexColors(geometry, masking);

    // Create material that uses vertex colors
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.1,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = true;
    mesh.frustumCulled = false;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.PI / 4;
    
    // Scale and position
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
      
      orbitCenterRef.current.copy(mesh.position);
      orbitCenterRef.current.y += 6;
    }
    
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    sceneRef.current.add(mesh);
    meshRef.current = mesh;

    if (rendererRef.current && cameraRef.current && sceneRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, [modelData, maskingGroups, aiAnalysis]);
  
  // Update vertex colors when paint colors or masking groups change
  useEffect(() => {
    if (meshRef.current && vertexMaskingRef.current) {
      const geometry = meshRef.current.geometry as THREE.BufferGeometry;
      applyVertexColors(geometry, vertexMaskingRef.current);
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
        width: '100%', height: '600px',
        background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
        borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4)',
        cursor: 'grab', border: '1px solid #d1d5db', position: 'relative', overflow: 'visible'
      }}
      onMouseDown={(e) => { e.currentTarget.style.cursor = 'grabbing'; }}
      onMouseUp={(e) => { e.currentTarget.style.cursor = 'grab'; }}
    />
  );
};

export default ThreeScene;