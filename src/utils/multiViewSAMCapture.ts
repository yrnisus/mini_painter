// src/utils/multiViewSAMCapture.ts - Enhanced multi-angle SAM capture

import * as THREE from 'three';
import { sendToSAMBackend, ViewData } from './samCaptureUtils';
import { SAMToVertexMapping, SAMMask } from './samTo3DMapper';

// Extended mask interface for multi-view
interface MultiViewSAMMask extends SAMMask {
  view_name?: string;
  view_index?: number;
  combined_mask?: boolean;
}

interface MultiViewResult {
  views: ViewData[];
  combinedMasks: MultiViewSAMMask[];
  viewCount: number;
}

/**
 * Captures multiple views of the 3D model for better SAM segmentation
 */
export const captureMultiViewSAM = async (
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  mesh: THREE.Mesh
): Promise<MultiViewResult | null> => {
  console.log('🎯 Starting multi-view SAM capture...');
  
  // Define optimal camera positions for miniatures
  const viewAngles = [
    { name: 'front', position: [0, 8, 12], lookAt: [0, 4, 0] },
    { name: 'back', position: [0, 8, -12], lookAt: [0, 4, 0] },
    { name: 'left', position: [-12, 8, 0], lookAt: [0, 4, 0] },
    { name: 'right', position: [12, 8, 0], lookAt: [0, 4, 0] },
    { name: 'top', position: [0, 20, 0], lookAt: [0, 0, 0] },
    { name: 'front-angle', position: [8, 12, 8], lookAt: [0, 4, 0] }
  ];
  
  const views: ViewData[] = [];
  const allMasks: MultiViewSAMMask[] = [];
  
  // Store original camera state
  const originalPosition = camera.position.clone();
  const originalTarget = new THREE.Vector3();
  camera.getWorldDirection(originalTarget);
  
  try {
    for (let i = 0; i < viewAngles.length; i++) {
      const view = viewAngles[i];
      console.log(`📸 Capturing view ${i + 1}/${viewAngles.length}: ${view.name}`);
      
      // Position camera
      camera.position.set(view.position[0], view.position[1], view.position[2]);
      camera.lookAt(view.lookAt[0], view.lookAt[1], view.lookAt[2]);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      
      // Update mesh
      if (mesh) {
        mesh.updateMatrixWorld();
      }
      
      // Force render
      renderer.render(scene, camera);
      
      // Capture view
      const colorPNG = renderer.domElement.toDataURL('image/png');
      const depthArray = new Float32Array(1024 * 1024).fill(0.5);
      
      const viewData: ViewData = {
        colorPNG,
        depthArray,
        cameraMatrix: camera.matrixWorld.toArray(),
        projectionMatrix: camera.projectionMatrix.toArray(),
        viewportSize: { width: 1024, height: 1024 }
      };
      
      views.push(viewData);
      
      // Send to SAM backend
      try {
        const samResponse = await sendToSAMBackend(viewData);
        if (samResponse && samResponse.masks) {
          // Add view index to masks for tracking
          const viewMasks: MultiViewSAMMask[] = samResponse.masks.map((mask, idx) => ({
            ...mask,
            view_name: view.name,
            view_index: i,
            mask_id: (i * 1000) + idx // Unique numeric ID across views
          }));
          
          allMasks.push(...viewMasks);
          console.log(`   View ${view.name}: ${samResponse.masks.length} masks`);
        }
      } catch (error) {
        console.error(`   Failed to get SAM results for view ${view.name}:`, error);
      }
      
      // Small delay between captures
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Restore original camera state
    camera.position.copy(originalPosition);
    camera.lookAt(originalTarget);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    
    console.log(`✅ Multi-view SAM complete: ${allMasks.length} total masks from ${views.length} views`);
    
    // Combine and deduplicate masks
    const combinedMasks = combineMasksFromMultipleViews(allMasks);
    
    return {
      views,
      combinedMasks,
      viewCount: views.length
    };
    
  } catch (error) {
    console.error('❌ Multi-view SAM capture failed:', error);
    
    // Restore camera on error
    camera.position.copy(originalPosition);
    camera.lookAt(originalTarget);
    camera.updateMatrixWorld();
    
    return null;
  }
};

/**
 * Combines masks from multiple views, removing duplicates and low-quality masks
 */
const combineMasksFromMultipleViews = (allMasks: MultiViewSAMMask[]): MultiViewSAMMask[] => {
  console.log('🔄 Combining masks from multiple views...');
  
  // Group masks by view
  const masksByView: { [viewName: string]: MultiViewSAMMask[] } = {};
  allMasks.forEach(mask => {
    const viewName = mask.view_name || 'unknown';
    if (!masksByView[viewName]) {
      masksByView[viewName] = [];
    }
    masksByView[viewName].push(mask);
  });
  
  console.log('Masks per view:', Object.entries(masksByView).map(([view, masks]) => 
    `${view}: ${masks.length} masks`
  ));
  
  // Select best masks from each view
  const selectedMasks: MultiViewSAMMask[] = [];
  
  Object.entries(masksByView).forEach(([viewName, masks]) => {
    // Sort by quality: larger area and higher stability
    const sortedMasks = masks.sort((a, b) => {
      const scoreA = a.area * a.stability_score;
      const scoreB = b.area * b.stability_score;
      return scoreB - scoreA;
    });
    
    // Take top masks from each view, but limit per view to avoid dominance
    const masksPerView = Math.min(10, Math.max(3, Math.floor(sortedMasks.length / 2)));
    const topMasks = sortedMasks.slice(0, masksPerView);
    
    console.log(`   ${viewName}: selected ${topMasks.length}/${masks.length} masks`);
    selectedMasks.push(...topMasks);
  });
  
  // Final filtering: remove very small or very large masks
  const filteredMasks = selectedMasks.filter(mask => {
    return mask.area > 200 && mask.area < 100000 && mask.stability_score > 0.7;
  });
  
  console.log(`✅ Final result: ${filteredMasks.length} combined masks`);
  
  // Re-index masks for consistency
  return filteredMasks.map((mask, index) => ({
    ...mask,
    mask_id: index,
    combined_mask: true
  }));
};

/**
 * Enhanced SAM button that uses multi-view capture
 */
export const enhancedMultiViewSAMTest = async (
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  mesh: THREE.Mesh,
  onResults: (masks: MultiViewSAMMask[]) => void
): Promise<void> => {
  console.log('🎭 Enhanced Multi-View SAM Test starting...');
  
  try {
    const result = await captureMultiViewSAM(scene, camera, renderer, mesh);
    
    if (result && result.combinedMasks.length > 0) {
      console.log(`✅ Multi-view SAM success: ${result.combinedMasks.length} combined masks`);
      
      // Format for frontend
      const formattedResult = {
        masks: result.combinedMasks,
        viewport_size: { width: 1024, height: 1024 },
        num_masks: result.combinedMasks.length,
        multi_view: true,
        view_count: result.viewCount,
        camera_data: {
          camera_matrix: camera.matrixWorld.toArray(),
          projection_matrix: camera.projectionMatrix.toArray()
        }
      };
      
      // Call the existing onSAMResults handler
      if ((window as any).onSAMResults) {
        (window as any).onSAMResults(formattedResult);
      }
      
    } else {
      console.error('❌ Multi-view SAM failed to produce results');
    }
    
  } catch (error) {
    console.error('❌ Enhanced multi-view SAM test failed:', error);
  }
};