import * as THREE from 'three';

export interface SceneRefs {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  meshRef: React.MutableRefObject<THREE.Mesh | null>;
  animationIdRef: React.MutableRefObject<number | null>;
}

export interface CameraControls {
  orbitCenterRef: React.MutableRefObject<THREE.Vector3>;
}

/**
 * Initializes the Three.js scene with camera, renderer, and lighting
 */
export const initializeScene = (
  mountElement: HTMLDivElement,
  refs: SceneRefs,
  orbitCenter: THREE.Vector3
): (() => void) => {
  const scene = new THREE.Scene();
  refs.sceneRef.current = scene;

  const camera = new THREE.PerspectiveCamera(
    75, 
    mountElement.clientWidth / mountElement.clientHeight, 
    0.1, 
    2000
  );
  camera.position.set(0, 10, 10);
  camera.lookAt(orbitCenter);
  refs.cameraRef.current = camera;

  const renderer = new THREE.WebGLRenderer({ 
    antialias: true, 
    alpha: false, 
    preserveDrawingBuffer: true 
  });
  renderer.setSize(mountElement.clientWidth, mountElement.clientHeight);
  renderer.shadowMap.enabled = false;
  
  // Style the renderer canvas
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.top = '0';
  renderer.domElement.style.left = '0';
  
  mountElement.appendChild(renderer.domElement);
  refs.rendererRef.current = renderer;

  // Setup lighting
  setupLighting(scene);

  // Setup mouse controls
  const cleanupControls = setupMouseControls(renderer.domElement, refs.cameraRef, orbitCenter);

  // Start animation loop
  const animate = () => {
    refs.animationIdRef.current = requestAnimationFrame(animate);
    if (refs.rendererRef.current && refs.cameraRef.current && refs.sceneRef.current) {
      refs.rendererRef.current.render(refs.sceneRef.current, refs.cameraRef.current);
    }
  };
  animate();

  // Return cleanup function
  return () => {
    if (refs.animationIdRef.current) {
      cancelAnimationFrame(refs.animationIdRef.current);
    }
    
    cleanupControls();

    if (refs.meshRef.current && refs.sceneRef.current) {
      refs.sceneRef.current.remove(refs.meshRef.current);
      if (refs.meshRef.current.geometry) refs.meshRef.current.geometry.dispose();
      if (refs.meshRef.current.material) (refs.meshRef.current.material as THREE.Material).dispose();
    }
    
    if (refs.rendererRef.current) {
      refs.rendererRef.current.dispose();
      if (mountElement && refs.rendererRef.current.domElement) {
        mountElement.removeChild(refs.rendererRef.current.domElement);
      }
    }
  };
};

/**
 * Sets up lighting for the scene
 */
const setupLighting = (scene: THREE.Scene): void => {
  // Ambient light for overall illumination
  scene.add(new THREE.AmbientLight(0x404040, 3.0));
  
  // Front directional light
  const frontLight = new THREE.DirectionalLight(0xffffff, 4.0);
  frontLight.position.set(0, 10, 20);
  frontLight.castShadow = false;
  scene.add(frontLight);
  
  // Top directional light
  const topLight = new THREE.DirectionalLight(0xffffff, 2.0);
  topLight.position.set(0, 20, 0);
  topLight.castShadow = false;
  scene.add(topLight);
};

/**
 * Sets up mouse controls for camera orbit
 */
const setupMouseControls = (
  canvas: HTMLCanvasElement,
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>,
  orbitCenter: THREE.Vector3
): (() => void) => {
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
    const direction = camera.position.clone().sub(orbitCenter).normalize();
    const moveAmount = event.deltaY * 0.05;
    const newPosition = camera.position.clone().add(direction.multiplyScalar(moveAmount));
    
    const distanceFromCenter = newPosition.distanceTo(orbitCenter);
    if (distanceFromCenter > 2 && distanceFromCenter < 50) {
      camera.position.copy(newPosition);
    }
    
    camera.lookAt(orbitCenter);
  };

  // Add event listeners
  canvas.addEventListener('mousedown', handleMouseDown, { passive: false });
  canvas.addEventListener('mouseup', handleMouseUp, { passive: false });
  canvas.addEventListener('mousemove', handleMouseMove, { passive: false });
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  
  window.addEventListener('mouseup', handleMouseUp, { passive: false });
  window.addEventListener('mousemove', handleMouseMove, { passive: false });

  // Return cleanup function
  return () => {
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('mouseup', handleMouseUp);
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('wheel', handleWheel);
    window.removeEventListener('mouseup', handleMouseUp);
    window.removeEventListener('mousemove', handleMouseMove);
  };
};

/**
 * Updates the scene background color
 */
export const updateBackgroundColor = (
  scene: THREE.Scene | null,
  renderer: THREE.WebGLRenderer | null,
  backgroundColor: number
): void => {
  if (scene && renderer) {
    scene.background = new THREE.Color(backgroundColor);
    renderer.setClearColor(backgroundColor, 1);
  }
};