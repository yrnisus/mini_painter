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
  // NEW: Include camera data in response
  camera_data?: {
    camera_matrix: number[];
    projection_matrix: number[];
  };
}

/**
 * ENHANCED: Captures view and stores camera data for 3D mapping
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
    
    // Ensure camera matrices are up to date
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    
    // Capture the current canvas as PNG
    const colorPNG = renderer.domElement.toDataURL('image/png');
    console.log('📷 PNG captured, length:', colorPNG.length);
    
    // Create mock depth data (enhanced for better SAM processing)
    const depthArray = new Float32Array(width * height);
    depthArray.fill(0.5); // Mock depth - could be enhanced with real depth buffer
    
    const viewData: ViewData = {
      colorPNG,
      depthArray,
      cameraMatrix: camera.matrixWorld.toArray(),
      projectionMatrix: camera.projectionMatrix.toArray(),
      viewportSize: { width, height }
    };
    
    console.log('✅ View captured with camera data:', {
      colorSize: colorPNG.length,
      cameraMatrix: viewData.cameraMatrix.length,
      projectionMatrix: viewData.projectionMatrix.length,
      viewport: viewData.viewportSize
    });
    
    return viewData;
  } catch (error) {
    console.error('❌ Error in captureViewForSAM:', error);
    throw error;
  }
};

/**
 * ENHANCED: Sends view data with camera information for 3D mapping
 */
export const sendToSAMBackend = async (viewData: ViewData): Promise<SAMResponse | null> => {
  console.log('🤖 sendToSAMBackend called');
  
  try {
    console.log('🤖 Sending view to SAM backend...');
    
    const payload = {
      color_image: viewData.colorPNG,
      depth_array: Array.from(viewData.depthArray),
      camera_matrix: viewData.cameraMatrix,
      projection_matrix: viewData.projectionMatrix,
      viewport_size: viewData.viewportSize
    };
    
    console.log('📤 Payload prepared with camera data:', {
      color_image_length: payload.color_image.length,
      depth_array_length: payload.depth_array.length,
      camera_matrix_length: payload.camera_matrix.length,
      projection_matrix_length: payload.projection_matrix.length,
      viewport_size: payload.viewport_size
    });
    
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
      statusText: response.statusText
    });
    
    if (response.ok) {
      const result: SAMResponse = await response.json();
      
      // ENHANCED: Add camera data to response for 3D mapping
      result.camera_data = {
        camera_matrix: viewData.cameraMatrix,
        projection_matrix: viewData.projectionMatrix
      };
      
      console.log('✅ SAM segmentation result with camera data:', {
        num_masks: result.num_masks,
        has_camera_data: !!result.camera_data,
        viewport_size: result.viewport_size
      });
      
      // Call frontend callback with enhanced data
      if ((window as any).onSAMResults) {
        console.log('🔄 Calling frontend onSAMResults with camera data...');
        (window as any).onSAMResults(result);
        console.log('✅ SAM results with 3D mapping data sent to frontend');
      } else {
        console.error('❌ onSAMResults callback not found on window');
      }
      
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
    return null;
  }
};

/**
 * ENHANCED: Positions camera and captures with optimal settings for 3D mapping
 */
export const testSingleViewCapture = (
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  mesh: THREE.Mesh
): ViewData | undefined => {
  console.log('🎯 testSingleViewCapture called for 3D mapping!');
  
  try {
    // Position camera for optimal view (front-angled view for better coverage)
    console.log('📍 Positioning camera for optimal SAM capture...');
    camera.position.set(0, 8, 12);
    camera.lookAt(0, 4, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    
    // Ensure mesh is visible and properly positioned
    if (mesh) {
      mesh.updateMatrixWorld();
      console.log('📐 Mesh world matrix updated');
    }
    
    // Force a render to ensure everything is up to date
    console.log('🎨 Forcing render...');
    renderer.render(scene, camera);
    
    // Capture the view with camera data
    console.log('📸 Capturing view with camera data...');
    const viewData = captureViewForSAM(scene, camera, renderer);
    
    // Send to backend for SAM processing
    console.log('🤖 Sending to backend with 3D mapping support...');
    sendToSAMBackend(viewData);
    
    console.log('✅ testSingleViewCapture completed with 3D mapping support');
    return viewData;
  } catch (error) {
    console.error('❌ Error in testSingleViewCapture:', error);
    return undefined;
  }
};

/**
 * Sets up enhanced SAM test functions with 3D mapping support
 */
export const setupSAMTestFunctions = (
  sceneRef: React.MutableRefObject<THREE.Scene | null>,
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>,
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>,
  meshRef: React.MutableRefObject<THREE.Mesh | null>
) => {
  console.log('🔧 Setting up enhanced SAM test functions with 3D mapping');
  
  (window as any).testSAMCapture = () => {
    console.log('🎯 Enhanced SAM test called from window!');
    
    if (sceneRef.current && cameraRef.current && rendererRef.current && meshRef.current) {
      console.log('✅ All refs available for 3D mapping, calling enhanced SAM capture...');
      try {
        testSingleViewCapture(
          sceneRef.current,
          cameraRef.current,
          rendererRef.current,
          meshRef.current
        );
      } catch (error) {
        console.error('❌ Error in enhanced SAM capture:', error);
      }
    } else {
      console.log('❌ Scene not ready for 3D mapping SAM capture');
      console.log('Missing refs:', {
        scene: !sceneRef.current,
        camera: !cameraRef.current,
        renderer: !rendererRef.current,
        mesh: !meshRef.current
      });
    }
  };
  
  console.log('✅ Enhanced SAM functions with 3D mapping set on window');
  
  return () => {
    console.log('🧹 Cleaning up enhanced SAM functions');
    delete (window as any).testSAMCapture;
  };
};