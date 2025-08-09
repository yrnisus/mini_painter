import * as THREE from 'three';

export interface ViewData {
  colorPNG: string;
  depthArray: Float32Array;
  cameraMatrix: number[];
  projectionMatrix: number[];
  viewportSize: { width: number; height: number };
}

export interface SAMResponse {
  success: boolean;
  masks: Array<{
    mask_id: number;
    pixel_coords: [number, number][];
    bbox: [number, number, number, number];
    area: number;
    stability_score: number;
    mask_array: boolean[][];
  }>;
  image_shape: [number, number, number];
  viewport_size: { width: number; height: number };
  num_masks: number;
}

/**
 * Captures the current view from the Three.js scene for SAM processing
 */
export const captureViewForSAM = (
  scene: THREE.Scene, 
  camera: THREE.PerspectiveCamera, 
  renderer: THREE.WebGLRenderer
): ViewData => {
  console.log('📸 captureViewForSAM called');
  
  const width = 1024;
  const height = 1024;
  
  try {
    console.log('📸 Capturing view for SAM...');
    console.log('Renderer domElement exists:', !!renderer.domElement);
    
    // Capture the current canvas as PNG
    const colorPNG = renderer.domElement.toDataURL('image/png');
    console.log('📷 PNG captured, length:', colorPNG.length);
    
    // Create mock depth data (we'll improve this later with proper depth buffer capture)
    const depthArray = new Float32Array(width * height);
    depthArray.fill(0.5); // Mock depth
    
    const viewData: ViewData = {
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

/**
 * Positions camera for optimal view and captures the scene
 */
export const testSingleViewCapture = (
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  mesh: THREE.Mesh
): ViewData | undefined => {
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
    return undefined;
  }
};

/**
 * Sends captured view data to the SAM backend for processing
 */
export const sendToSAMBackend = async (viewData: ViewData): Promise<SAMResponse | null> => {
  console.log('🤖 sendToSAMBackend called');
  
  try {
    console.log('🤖 Sending view to SAM backend...');
    console.log('Backend URL: http://localhost:5000/segment-single-view');
    console.log('View data keys:', Object.keys(viewData));
    
    // First, test if the endpoint exists
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
      const result: SAMResponse = await response.json();
      console.log('✅ SAM segmentation result:', result);
      console.log(`🎭 Found ${result.num_masks} masks!`);
      
      // Log mask details
      result.masks?.forEach((mask, i) => {
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
      return null;
    }
  } catch (error) {
    console.error('❌ Network error sending to SAM backend:', error);
    
    // Proper TypeScript error handling
    if (error instanceof Error) {
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    } else {
      console.error('Unknown error type:', error);
    }
    return null;
  }
};

/**
 * Sets up global SAM test functions on the window object
 */
export const setupSAMTestFunctions = (
  sceneRef: React.MutableRefObject<THREE.Scene | null>,
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>,
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>,
  meshRef: React.MutableRefObject<THREE.Mesh | null>
) => {
  console.log('🔧 Setting up SAM test functions');
  
  (window as any).testSAMCapture = () => {
    console.log('🎯 SAM test called from window!');
    console.log('Scene refs:', {
      scene: !!sceneRef.current,
      camera: !!cameraRef.current,
      renderer: !!rendererRef.current,
      mesh: !!meshRef.current
    });
    
    if (sceneRef.current && cameraRef.current && rendererRef.current && meshRef.current) {
      console.log('✅ All refs available, calling SAM capture...');
      try {
        testSingleViewCapture(
          sceneRef.current,
          cameraRef.current,
          rendererRef.current,
          meshRef.current
        );
      } catch (error) {
        console.error('❌ Error in SAM capture:', error);
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
  
  console.log('✅ SAM functions set on window');
  
  return () => {
    console.log('🧹 Cleaning up SAM functions');
    delete (window as any).testSAMCapture;
  };
};