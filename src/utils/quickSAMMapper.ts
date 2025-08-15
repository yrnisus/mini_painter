import * as THREE from 'three';
import { SAMResponse } from './samCaptureUtils';
import { MaskingGroup } from '../types';
import { SAMToVertexMapping, SAMMask } from './samTo3DMapper';

/**
 * ULTRA FAST SAM mapping for testing purposes
 * Uses geometric approximation instead of pixel-perfect mapping
 */
export const quickMapSAMToVertices = (
  samMasks: SAMMask[],
  mesh: THREE.Mesh,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer
): SAMToVertexMapping => {
  console.log('⚡ QUICK SAM mapping (testing mode)...');
  console.log(`Processing ${samMasks.length} SAM masks with geometric approximation`);
  
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const vertexCount = positions.count;
  
  // Get renderer size
  const rendererSize = new THREE.Vector2();
  renderer.getSize(rendererSize);
  
  // Sort masks by area (largest first)
  const sortedMasks = [...samMasks].sort((a, b) => b.area - a.area);
  console.log('Top 5 masks by area:', sortedMasks.slice(0, 5).map(m => `${m.mask_id}: ${m.area} pixels`));
  
  // Create group mapping
  const samToVertexMapping: SAMToVertexMapping = {};
  const groupNames = ['main_body', 'details', 'upper_section', 'lower_section', 'base_support'];
  
  // Initialize groups
  groupNames.forEach(groupName => {
    samToVertexMapping[groupName] = [];
  });
  
  // ULTRA FAST APPROACH: Use geometric zones based on SAM mask positions
  const maskZones = sortedMasks.slice(0, 5).map((mask, index) => {
    const [bboxX, bboxY, bboxWidth, bboxHeight] = mask.bbox;
    
    // Convert bbox to normalized screen coordinates
    const normalizedZone = {
      groupName: groupNames[index],
      centerX: (bboxX + bboxWidth / 2) / rendererSize.width,
      centerY: (bboxY + bboxHeight / 2) / rendererSize.height,
      width: bboxWidth / rendererSize.width,
      height: bboxHeight / rendererSize.height,
      area: mask.area
    };
    
    console.log(`Zone ${index} (${normalizedZone.groupName}): center=(${normalizedZone.centerX.toFixed(2)}, ${normalizedZone.centerY.toFixed(2)}), size=${normalizedZone.width.toFixed(2)}x${normalizedZone.height.toFixed(2)}`);
    
    return normalizedZone;
  });
  
  // Sample only a small subset of vertices (1% for ultra-fast testing)
  const sampleRate = Math.max(1, Math.floor(vertexCount / 10000)); // Max 10k vertices
  const actualVerticesProcessed = Math.ceil(vertexCount / sampleRate);
  
  console.log(`⚡ ULTRA FAST: Processing ${actualVerticesProcessed} vertices (${(actualVerticesProcessed/vertexCount*100).toFixed(1)}% sample)`);
  
  const worldPosition = new THREE.Vector3();
  const screenPosition = new THREE.Vector3();
  
  // Process sampled vertices
  for (let i = 0; i < vertexCount; i += sampleRate) {
    // Get world position
    worldPosition.fromBufferAttribute(positions, i);
    worldPosition.applyMatrix4(mesh.matrixWorld);
    
    // Project to normalized screen coordinates
    screenPosition.copy(worldPosition);
    screenPosition.project(camera);
    
    // Convert to 0-1 range
    const normalizedX = (screenPosition.x + 1) * 0.5;
    const normalizedY = (-screenPosition.y + 1) * 0.5;
    
    // Check if vertex is visible
    if (screenPosition.z < 1 && normalizedX >= 0 && normalizedX <= 1 && normalizedY >= 0 && normalizedY <= 1) {
      
      // Find closest zone
      let closestZone = maskZones[0];
      let minDistance = Infinity;
      
      for (const zone of maskZones) {
        const distance = Math.sqrt(
          Math.pow(normalizedX - zone.centerX, 2) + 
          Math.pow(normalizedY - zone.centerY, 2)
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          closestZone = zone;
        }
      }
      
      samToVertexMapping[closestZone.groupName].push(i);
    } else {
      // Invisible vertices go to main_body
      samToVertexMapping['main_body'].push(i);
    }
  }
  
  // Expand sampled vertices to nearby vertices (fill in the gaps)
  console.log('⚡ Expanding vertex assignments...');
  const expandedMapping: SAMToVertexMapping = {};
  
  groupNames.forEach(groupName => {
    expandedMapping[groupName] = [];
  });
  
  // For each sampled vertex, assign nearby vertices to the same group
  Object.entries(samToVertexMapping).forEach(([groupName, sampledVertices]) => {
    sampledVertices.forEach(sampledIndex => {
      // Assign a range of vertices around each sampled vertex
      const rangeStart = Math.max(0, sampledIndex - Math.floor(sampleRate / 2));
      const rangeEnd = Math.min(vertexCount, sampledIndex + Math.floor(sampleRate / 2));
      
      for (let j = rangeStart; j < rangeEnd; j++) {
        expandedMapping[groupName].push(j);
      }
    });
  });
  
  // Log results
  console.log('⚡ QUICK SAM mapping complete:');
  Object.entries(expandedMapping).forEach(([groupName, vertices]) => {
    const percentage = (vertices.length / vertexCount * 100).toFixed(1);
    console.log(`  ${groupName}: ${vertices.length} vertices (${percentage}%)`);
  });
  
  return expandedMapping;
};

/**
 * Creates simplified masking groups for quick testing
 */
export const createQuickSAMMaskingGroups = (samMasks: SAMMask[]): MaskingGroup[] => {
  console.log('⚡ Creating QUICK SAM masking groups...');
  
  const sortedMasks = [...samMasks].sort((a, b) => b.area - a.area);
  const groups: MaskingGroup[] = [];
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8'];
  const names = ['Main Region', 'Detail Region', 'Upper Region', 'Lower Region', 'Base Region'];
  const ids = ['main_body', 'details', 'upper_section', 'lower_section', 'base_support'];
  
  // Create groups for the largest masks
  for (let i = 0; i < Math.min(sortedMasks.length, 5); i++) {
    const mask = sortedMasks[i];
    groups.push({
      id: ids[i],
      name: `${names[i]} (${(mask.area/1000).toFixed(1)}k px)`,
      color: colors[i],
      visible: true
    });
  }
  
  console.log(`⚡ Created ${groups.length} quick SAM groups`);
  return groups;
};

/**
 * ULTRA FAST SAM test for quick iteration
 */
export const quickSAMTest = async (
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  mesh: THREE.Mesh,
  onMaskingUpdate: (mapping: SAMToVertexMapping, groups: MaskingGroup[]) => void
): Promise<void> => {
  console.log('⚡ QUICK SAM test (ultra-fast mode)...');
  
  try {
    // Position camera for optimal view
    console.log('⚡ Quick camera positioning...');
    camera.position.set(0, 10, 15);
    camera.lookAt(0, 6, 0);
    camera.updateMatrixWorld();
    
    // Force a render
    renderer.render(scene, camera);
    
    // Capture view (smaller image for faster processing)
    console.log('⚡ Quick view capture...');
    const colorPNG = renderer.domElement.toDataURL('image/png', 0.5); // Lower quality for speed
    const depthArray = new Float32Array(512 * 512).fill(0.5); // Smaller depth array
    
    const payload = {
      color_image: colorPNG,
      depth_array: Array.from(depthArray),
      camera_matrix: camera.matrixWorld.toArray(),
      projection_matrix: camera.projectionMatrix.toArray(),
      viewport_size: { width: 512, height: 512 } // Smaller viewport
    };
    
    console.log('⚡ Quick SAM backend request...');
    
    const response = await fetch('http://localhost:5000/segment-single-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      const result: SAMResponse = await response.json();
      console.log(`⚡ Quick SAM returned ${result.num_masks} masks`);
      
      // Use quick vertex mapping
      console.log('⚡ Starting quick vertex mapping...');
      const startTime = Date.now();
      const vertexMapping = quickMapSAMToVertices(result.masks, mesh, camera, renderer);
      const mappingTime = Date.now() - startTime;
      console.log(`⚡ Quick mapping completed in ${mappingTime}ms`);
      
      // Create quick masking groups
      const samGroups = createQuickSAMMaskingGroups(result.masks);
      
      // Update the application
      console.log('⚡ Applying quick SAM results...');
      onMaskingUpdate(vertexMapping, samGroups);
      
      console.log('⚡ QUICK SAM test completed successfully!');
    } else {
      console.error('❌ Quick SAM request failed:', response.statusText);
    }
  } catch (error) {
    console.error('❌ Quick SAM test failed:', error);
  }
};