import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { PaintColors, MaskingGroup, ModelData } from '../types/index';

interface ThreeSceneProps {
  paintColors: PaintColors;
  maskingGroups: MaskingGroup[];
  modelData: ModelData | null;
  backgroundColor: number;
}

const ThreeScene: React.FC<ThreeSceneProps> = ({ 
  paintColors, 
  maskingGroups, 
  modelData, 
  backgroundColor 
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const animationIdRef = useRef<number | null>(null);
  
  // Fixed orbit center that doesn't change (this prevents snapping)
  const orbitCenterRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 6, 0));

  // Scene initialization
  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    // Don't set background here - let the separate useEffect handle it
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 2000);
    camera.position.set(0, 10, 10); // Raised camera position
    camera.lookAt(orbitCenterRef.current);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.shadowMap.enabled = false;
    // Don't set clear color here - let the separate useEffect handle it
    
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

      // Use the FIXED orbit center (never changes)
      const orbitCenter = orbitCenterRef.current;
      
      // Calculate camera's position relative to orbit center
      const cameraOffset = cameraRef.current.position.clone().sub(orbitCenter);
      
      // Convert to spherical coordinates around orbit center
      const spherical = new THREE.Spherical();
      spherical.setFromVector3(cameraOffset);
      
      // Apply rotation
      spherical.theta -= deltaMove.x * 0.01;
      spherical.phi -= deltaMove.y * 0.01;
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
      
      // Convert back to world position
      cameraRef.current.position.setFromSpherical(spherical).add(orbitCenter);
      cameraRef.current.lookAt(orbitCenter);
      
      previousMousePosition = { x: event.clientX, y: event.clientY };
    };

    const handleWheel = (event: WheelEvent) => {
      if (!cameraRef.current) return;
      event.preventDefault();
      
      const camera = cameraRef.current;
      const orbitCenter = orbitCenterRef.current;
      
      // Get direction from orbit center to camera (zoom in/out direction)
      const direction = camera.position.clone().sub(orbitCenter).normalize();
      const moveAmount = event.deltaY * 0.05;
      
      // Move camera closer/further from orbit center
      const newPosition = camera.position.clone().add(direction.multiplyScalar(moveAmount));
      
      // Prevent getting too close or too far
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
  }, []); // Remove backgroundColor dependency to prevent scene recreation

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

    if (meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      if (meshRef.current.geometry) meshRef.current.geometry.dispose();
      if (meshRef.current.material) (meshRef.current.material as THREE.Material).dispose();
    }

    const material = new THREE.MeshStandardMaterial({
      color: '#A0A0A0', roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(modelData.geometry.clone(), material);
    
    if (!mesh.geometry.attributes.normal) {
      mesh.geometry.computeVertexNormals();
    }
    
    mesh.visible = true;
    mesh.frustumCulled = false;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.PI / 4;
    
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    
    if (box) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const targetSize = 15;
      const scale = maxDim > 0 ? targetSize / maxDim : 1;
      
      mesh.position.copy(center).multiplyScalar(-scale);
      mesh.scale.setScalar(scale);
      
      // Set orbit center to be higher up on the model (less empty space below)
      orbitCenterRef.current.copy(mesh.position);
      orbitCenterRef.current.y += 6; // Look at a point 6 units above the model center
    }
    
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    sceneRef.current.add(mesh);
    meshRef.current = mesh;

    if (rendererRef.current && cameraRef.current && sceneRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, [modelData]);
  
  // Paint color updates
  useEffect(() => {
    if (meshRef.current && meshRef.current.material) {
      const material = meshRef.current.material as THREE.MeshStandardMaterial;
      if (Object.keys(paintColors).length === 0) {
        material.color.setHex(0xA0A0A0);
      } else {
        material.color.setHex(parseInt((paintColors.armor || '#A0A0A0').replace('#', ''), 16));
      }
    }
  }, [paintColors]);

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