import * as THREE from 'three';
import { SAMResponse } from './samCaptureUtils';
import { MaskingGroup } from '../types';

export interface SAMMask {
  mask_id: number;
  pixel_coords: [number, number][];
  bbox: [number, number, number, number];
  area: number;
  stability_score: number;
  mask_array?: boolean[][];
}

export interface SAMToVertexMapping {
  [groupId: string]: number[]; // vertex indices
}

/**
 * Maps SAM pixel masks to 3D model vertices using screen projection (OPTIMIZED)
 */
export const mapSAMToVertices = (
  samMasks: SAMMask[],
  mesh: THREE.Mesh,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer
): SAMToVertexMapping => {
  console.log('🔗 Mapping SAM masks to 3D vertices...');
  console.log(`Processing ${samMasks.length} SAM masks`);
  
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const vertexCount = positions.count;
  
  // Get renderer size
  const rendererSize = new THREE.Vector2();
  renderer.getSize(rendererSize);
  console.log('Renderer size:', rendererSize);
  
  // Create mapping groups based on mask areas (larger masks = more important groups)
  const sortedMasks = [...samMasks].sort((a, b) => b.area - a.area);
  console.log('Sorted masks by area:', sortedMasks.slice(0, 5).map(m => `${m.mask_id}: ${m.area} pixels`));
  
  // Create group mapping based on mask importance
  const samToVertexMapping: SAMToVertexMapping = {};
  const groupNames = ['main_body', 'details', 'upper_section', 'lower_section', 'base_support'];
  
  // Initialize groups
  groupNames.forEach(groupName => {
    samToVertexMapping[groupName] = [];
  });
  
  // OPTIMIZATION: For huge models (>500k vertices), sample every Nth vertex
  const sampleRate = vertexCount > 500000 ? Math.ceil(vertexCount / 100000) : 1;
  const actualVerticesProcessed = Math.ceil(vertexCount / sampleRate);
  
  console.log(`🚀 OPTIMIZATION: Processing every ${sampleRate} vertex(s) (${actualVerticesProcessed} total)`);
  
  // Pre-create largest mask pixel lookup for fastest assignment
  const largestMask = sortedMasks[0];
  const largestMaskPixelSet = new Set(
    largestMask.pixel_coords?.map(([x, y]) => `${x},${y}`) || []
  );
  
  // Project vertices to screen space and check which SAM mask they belong to
  const worldPosition = new THREE.Vector3();
  const screenPosition = new THREE.Vector3();
  
  console.log(`Projecting ${actualVerticesProcessed} vertices to screen space...`);
  
  for (let i = 0; i < vertexCount; i += sampleRate) {
    // Get world position of vertex
    worldPosition.fromBufferAttribute(positions, i);
    worldPosition.applyMatrix4(mesh.matrixWorld);
    
    // Project to screen coordinates
    screenPosition.copy(worldPosition);
    screenPosition.project(camera);
    
    // Convert normalized device coordinates to screen pixels
    const screenX = Math.round((screenPosition.x + 1) * rendererSize.width / 2);
    const screenY = Math.round((-screenPosition.y + 1) * rendererSize.height / 2);
    
    // Check if vertex is visible (within screen bounds and not behind camera)
    if (screenPosition.z < 1 && screenX >= 0 && screenX < rendererSize.width && 
        screenY >= 0 && screenY < rendererSize.height) {
      
      // Find which SAM mask this pixel belongs to (check top 5 masks only)
      let assignedToGroup = false;
      
      // Quick check against largest mask first (most pixels likely belong here)
      if (largestMaskPixelSet.has(`${screenX},${screenY}`)) {
        samToVertexMapping['main_body'].push(i);
        assignedToGroup = true;
      } else {
        // Check other masks by bounding box first (faster)
        for (let maskIndex = 1; maskIndex < Math.min(sortedMasks.length, 5); maskIndex++) {
          const mask = sortedMasks[maskIndex];
          const groupName = groupNames[maskIndex];
          
          // Quick bounding box check first
          const [bboxX, bboxY, bboxWidth, bboxHeight] = mask.bbox;
          if (screenX >= bboxX && screenX < bboxX + bboxWidth && 
              screenY >= bboxY && screenY < bboxY + bboxHeight) {
            samToVertexMapping[groupName].push(i);
            assignedToGroup = true;
            break;
          }
        }
      }
      
      // If not assigned to any mask, assign to main_body
      if (!assignedToGroup) {
        samToVertexMapping['main_body'].push(i);
      }
    } else {
      // Vertices not visible on screen go to main_body
      samToVertexMapping['main_body'].push(i);
    }
    
    // Log progress more frequently for large models
    if (i % 100000 === 0) {
      const progress = (i / vertexCount * 100).toFixed(1);
      console.log(`🔄 Processed ${i}/${vertexCount} vertices (${progress}%)`);
    }
  }
  
  // If we sampled vertices, expand the mapping to include nearby vertices
  if (sampleRate > 1) {
    console.log('🔄 Expanding sampled vertex mapping...');
    const expandedMapping: SAMToVertexMapping = {};
    
    // Initialize expanded groups
    groupNames.forEach(groupName => {
      expandedMapping[groupName] = [];
    });
    
    // For each sampled vertex, assign nearby vertices to the same group
    Object.entries(samToVertexMapping).forEach(([groupName, sampledVertices]) => {
      sampledVertices.forEach(sampledIndex => {
        // Assign the sampled vertex and nearby vertices
        for (let offset = 0; offset < sampleRate && sampledIndex + offset < vertexCount; offset++) {
          expandedMapping[groupName].push(sampledIndex + offset);
        }
      });
    });
    
    // Use expanded mapping
    Object.assign(samToVertexMapping, expandedMapping);
  }
  
  // Log results
  console.log('🎭 SAM to vertex mapping complete:');
  Object.entries(samToVertexMapping).forEach(([groupName, vertices]) => {
    const percentage = (vertices.length / vertexCount * 100).toFixed(1);
    console.log(`  ${groupName}: ${vertices.length} vertices (${percentage}%)`);
  });
  
  return samToVertexMapping;
};

/**
 * Checks if a pixel coordinate is within a SAM mask
 */
const isPixelInMask = (x: number, y: number, mask: SAMMask): boolean => {
  // Check bounding box first for quick elimination
  const [bboxX, bboxY, bboxWidth, bboxHeight] = mask.bbox;
  if (x < bboxX || x >= bboxX + bboxWidth || y < bboxY || y >= bboxY + bboxHeight) {
    return false;
  }
  
  // Check pixel coordinates (more accurate but slower)
  if (mask.pixel_coords) {
    return mask.pixel_coords.some(([px, py]) => 
      Math.abs(px - x) <= 1 && Math.abs(py - y) <= 1
    );
  }
  
  // Fallback to bounding box check
  return true;
};

/**
 * Creates masking groups from SAM masks
 */
export const createSAMMaskingGroups = (samMasks: SAMMask[]): MaskingGroup[] => {
  console.log('🎨 Creating masking groups from SAM masks...');
  
  // Sort masks by area (largest first)
  const sortedMasks = [...samMasks].sort((a, b) => b.area - a.area);
  
  const groups: MaskingGroup[] = [];
  const colors = ['#8B4513', '#C0C0C0', '#800080', '#FDBCB4', '#654321'];
  const names = ['Main Body', 'Details', 'Upper Section', 'Lower Section', 'Base & Support'];
  const ids = ['main_body', 'details', 'upper_section', 'lower_section', 'base_support'];
  
  // Create groups for the largest masks
  for (let i = 0; i < Math.min(sortedMasks.length, 5); i++) {
    const mask = sortedMasks[i];
    groups.push({
      id: ids[i],
      name: `${names[i]} (${mask.area} px)`,
      color: colors[i],
      visible: true
    });
  }
  
  console.log(`Created ${groups.length} SAM-based groups`);
  return groups;
};

/**
 * Updates existing SAM test function to apply results to the model
 */
export const enhancedSAMTest = async (
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  mesh: THREE.Mesh,
  onMaskingUpdate: (mapping: SAMToVertexMapping, groups: MaskingGroup[]) => void
): Promise<void> => {
  console.log('🚀 Enhanced SAM test with 3D mapping...');
  
  try {
    // Position camera for optimal view
    console.log('📍 Positioning camera for enhanced SAM test...');
    camera.position.set(0, 10, 15);
    camera.lookAt(0, 6, 0);
    camera.updateMatrixWorld();
    
    // Force a render
    console.log('🎨 Forcing render for enhanced SAM test...');
    renderer.render(scene, camera);
    
    // Capture view
    console.log('📸 Capturing view for enhanced SAM test...');
    const colorPNG = renderer.domElement.toDataURL('image/png');
    const depthArray = new Float32Array(1024 * 1024).fill(0.5);
    
    const payload = {
      color_image: colorPNG,
      depth_array: Array.from(depthArray),
      camera_matrix: camera.matrixWorld.toArray(),
      projection_matrix: camera.projectionMatrix.toArray(),
      viewport_size: { width: 1024, height: 1024 }
    };
    
    console.log('📤 Sending to SAM backend from enhanced test...');
    
    const response = await fetch('http://localhost:5000/segment-single-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      const result: SAMResponse = await response.json();
      console.log(`✅ Enhanced SAM returned ${result.num_masks} masks`);
      
      // Map SAM masks to 3D vertices
      console.log('🔗 Starting vertex mapping...');
      const vertexMapping = mapSAMToVertices(result.masks, mesh, camera, renderer);
      
      // Create masking groups
      console.log('🎨 Creating SAM-based masking groups...');
      const samGroups = createSAMMaskingGroups(result.masks);
      
      // Update the application
      console.log('📡 Calling onMaskingUpdate callback...');
      onMaskingUpdate(vertexMapping, samGroups);
      
      console.log('🎭 SAM masks successfully applied to 3D model!');
    } else {
      console.error('❌ Enhanced SAM request failed:', response.statusText);
    }
  } catch (error) {
    console.error('❌ Enhanced SAM test failed:', error);
  }
};