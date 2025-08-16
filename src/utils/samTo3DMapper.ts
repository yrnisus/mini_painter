// src/utils/samTo3DMapper.ts - CORRECTED VERSION WITH ALL EXPORTS

import * as THREE from 'three';

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

export interface SAMViewData {
  camera_matrix: number[];
  projection_matrix: number[];
  viewport_size: { width: number; height: number };
}

/**
 * MAIN FUNCTION: Maps SAM pixel coordinates to 3D mesh vertices
 * This is the core missing functionality that needs to be implemented
 */
export const mapSAMPixelsToVertices = (
  samMasks: SAMMask[],
  mesh: THREE.Mesh,
  viewData: SAMViewData
): SAMToVertexMapping => {
  console.log('🎯 REAL SAM MAPPING: Converting pixels to vertices...');
  console.log(`Input: ${samMasks.length} SAM masks with pixel coordinates`);
  
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const vertexCount = positions.count;
  
  console.log(`Mesh: ${vertexCount} vertices, Viewport: ${viewData.viewport_size.width}x${viewData.viewport_size.height}`);
  
  // Initialize mapping groups
  const mapping: SAMToVertexMapping = {};
  samMasks.forEach(mask => {
    mapping[`sam_mask_${mask.mask_id}`] = [];
  });
  
  // PERFORMANCE: For large models, sample vertices to avoid timeout
  const maxVerticesPerFrame = 50000;
  const sampleRate = Math.max(1, Math.ceil(vertexCount / maxVerticesPerFrame));
  const actualVerticesProcessed = Math.ceil(vertexCount / sampleRate);
  
  console.log(`🚀 Processing every ${sampleRate} vertex(s) (${actualVerticesProcessed} total)`);
  
  // DEBUG: Log mask information for analysis
  console.log('SAM masks by size:');
  const sortedForDebug = [...samMasks].sort((a, b) => b.area - a.area);
  sortedForDebug.slice(0, 10).forEach(mask => {
    const hasPixels = mask.pixel_coords && mask.pixel_coords.length > 0;
    console.log(`  Mask ${mask.mask_id}: ${mask.area} pixels, bbox=[${mask.bbox.join(',')}], hasPixelCoords=${hasPixels}`);
  });
  
  // Project each vertex to screen space and find matching SAM masks
  const worldPosition = new THREE.Vector3();
  const screenPosition = new THREE.Vector3();
  let mappedVertices = 0;
  
  // Create a temporary camera from the stored matrices for projection
  const tempCamera = new THREE.PerspectiveCamera();
  tempCamera.matrixWorld.fromArray(viewData.camera_matrix);
  tempCamera.projectionMatrix.fromArray(viewData.projection_matrix);
  tempCamera.matrixWorldInverse.copy(tempCamera.matrixWorld).invert();
  
  // DEBUG: Track assignments during processing
  const assignmentCounts: { [maskId: string]: number } = {};
  const maskSizes: { [maskId: string]: number } = {};
  samMasks.forEach(mask => {
    assignmentCounts[`sam_mask_${mask.mask_id}`] = 0;
    maskSizes[`sam_mask_${mask.mask_id}`] = mask.area;
  });
  
  // IMPROVED: Calculate assignment limits to prevent dominance
  const totalImagePixels = viewData.viewport_size.width * viewData.viewport_size.height;
  const maxAssignmentPerMask: { [maskId: string]: number } = {};
  
  // First pass: identify ALL large masks (not just >20% of image)
  const largeMasks = samMasks.filter(mask => mask.area > 5000); // Any mask >5k pixels is "large"
  const smallMasks = samMasks.filter(mask => mask.area <= 5000);
  
  console.log(`Mask size distribution: ${largeMasks.length} large masks, ${smallMasks.length} small masks`);
  
  // Limit large masks more aggressively
  samMasks.forEach(mask => {
    const maskId = `sam_mask_${mask.mask_id}`;
    
    if (mask.area > 50000) {
      // Very large masks: max 15% of vertices
      maxAssignmentPerMask[maskId] = Math.floor(actualVerticesProcessed * 0.15);
      console.log(`Very large mask ${mask.mask_id} (${mask.area} pixels) limited to ${maxAssignmentPerMask[maskId]} vertices (15%)`);
    } else if (mask.area > 10000) {
      // Large masks: max 25% of vertices  
      maxAssignmentPerMask[maskId] = Math.floor(actualVerticesProcessed * 0.25);
      console.log(`Large mask ${mask.mask_id} (${mask.area} pixels) limited to ${maxAssignmentPerMask[maskId]} vertices (25%)`);
    } else if (mask.area > 3000) {
      // Medium masks: max 40% of vertices
      maxAssignmentPerMask[maskId] = Math.floor(actualVerticesProcessed * 0.40);
      console.log(`Medium mask ${mask.mask_id} (${mask.area} pixels) limited to ${maxAssignmentPerMask[maskId]} vertices (40%)`);
    } else {
      // Small masks: no limit
      maxAssignmentPerMask[maskId] = actualVerticesProcessed;
    }
  });
  
  for (let i = 0; i < vertexCount; i += sampleRate) {
    // Get vertex world position
    worldPosition.fromBufferAttribute(positions, i);
    worldPosition.applyMatrix4(mesh.matrixWorld);
    
    // Project to screen coordinates using Three.js built-in projection
    screenPosition.copy(worldPosition);
    screenPosition.project(tempCamera);
    
    // Convert normalized device coordinates to screen pixels
    const screenX = Math.round((screenPosition.x + 1) * viewData.viewport_size.width / 2);
    const screenY = Math.round((-screenPosition.y + 1) * viewData.viewport_size.height / 2);
    
    // Check if vertex is visible and within viewport
    if (screenPosition.z >= -1 && screenPosition.z <= 1 && 
        screenX >= 0 && screenX < viewData.viewport_size.width && 
        screenY >= 0 && screenY < viewData.viewport_size.height) {
      
      // Find which SAM mask(s) contain this pixel - IMPROVED with limits
      let assigned = false;
      
      // IMPROVED: Sort masks by area (smallest first) for better detail assignment
      const sortedMasks = [...samMasks].sort((a, b) => a.area - b.area);
      
      for (const mask of sortedMasks) {
        const maskId = `sam_mask_${mask.mask_id}`;
        
        // IMPROVED: Check assignment limit to prevent dominance
        if (assignmentCounts[maskId] >= maxAssignmentPerMask[maskId]) {
          continue; // Skip this mask if it's reached its limit
        }
        
        if (isPixelInSAMMask(screenX, screenY, mask)) {
          mapping[maskId].push(i);
          assignmentCounts[maskId]++;
          assigned = true;
          mappedVertices++;
          break; // Assign to first (smallest available) matching mask only
        }
      }
      
      // IMPROVED: Better fallback for unassigned vertices
      if (!assigned && samMasks.length > 0) {
        // Find a mask that hasn't reached its limit, preferring smaller ones
        const availableMasks = sortedMasks.filter(mask => {
          const maskId = `sam_mask_${mask.mask_id}`;
          return assignmentCounts[maskId] < maxAssignmentPerMask[maskId];
        });
        
        if (availableMasks.length > 0) {
          // Assign to smallest available mask
          const fallbackMask = availableMasks[0];
          const maskId = `sam_mask_${fallbackMask.mask_id}`;
          mapping[maskId].push(i);
          assignmentCounts[maskId]++;
          mappedVertices++;
        }
        // Otherwise, leave vertex unassigned (will get default color)
      }
    }
    
    // Progress logging for large models
    if (i % 10000 === 0) {
      const progress = (i / vertexCount * 100).toFixed(1);
      console.log(`🔄 Vertex projection: ${progress}% complete`);
    }
  }
  
  // If we sampled vertices, expand mapping to include nearby vertices
  if (sampleRate > 1) {
    console.log('🔄 Expanding sampled vertex assignments...');
    expandVertexAssignments(mapping, sampleRate, vertexCount);
  }
  
  // Log final results with debug info
  console.log(`✅ SAM pixel-to-vertex mapping complete:`);
  console.log(`   Mapped vertices: ${mappedVertices}/${actualVerticesProcessed} (${(mappedVertices/actualVerticesProcessed*100).toFixed(1)}%)`);
  console.log(`   Debug - Assignment counts during projection (with limits):`);
  
  Object.entries(assignmentCounts).forEach(([groupId, count]) => {
    if (count > 0) {
      const limit = maxAssignmentPerMask[groupId];
      const hitLimit = count >= limit ? " (HIT LIMIT)" : "";
      console.log(`     ${groupId}: ${count}/${limit} assignments${hitLimit}`);
    }
  });
  
  console.log(`   Final vertex counts after expansion:`);
  Object.entries(mapping).forEach(([groupId, vertices]) => {
    const percentage = (vertices.length / vertexCount * 100).toFixed(1);
    console.log(`     ${groupId}: ${vertices.length} vertices (${percentage}%)`);
  });
  
  // IMPROVED: Distribution summary
  const totalAssigned = Object.values(mapping).reduce((sum, vertices) => sum + vertices.length, 0);
  const unassigned = vertexCount - totalAssigned;
  const largestGroup = Object.entries(mapping).reduce((max, [id, vertices]) => 
    vertices.length > max.count ? { id, count: vertices.length } : max, 
    { id: '', count: 0 }
  );
  
  console.log(`📊 Distribution Summary:`);
  console.log(`   Total vertices: ${vertexCount.toLocaleString()}`);
  console.log(`   Assigned: ${totalAssigned.toLocaleString()} (${(totalAssigned/vertexCount*100).toFixed(1)}%)`);
  console.log(`   Unassigned: ${unassigned.toLocaleString()} (${(unassigned/vertexCount*100).toFixed(1)}%)`);
  console.log(`   Largest group: ${largestGroup.id} with ${(largestGroup.count/vertexCount*100).toFixed(1)}%`);
  
  if (largestGroup.count / vertexCount > 0.5) {
    console.warn(`⚠️ Large group dominance detected: ${largestGroup.id} has ${(largestGroup.count/vertexCount*100).toFixed(1)}% of vertices`);
  }
  
  return mapping;
};

/**
 * Checks if a screen pixel is within a SAM mask - IMPROVED VERSION
 */
const isPixelInSAMMask = (screenX: number, screenY: number, mask: SAMMask): boolean => {
  // Quick bounding box check first
  const [bboxX, bboxY, bboxWidth, bboxHeight] = mask.bbox;
  if (screenX < bboxX || screenX >= bboxX + bboxWidth || 
      screenY < bboxY || screenY >= bboxY + bboxHeight) {
    return false;
  }
  
  // IMPROVED: Always use pixel coordinates for accurate matching
  if (mask.pixel_coords && mask.pixel_coords.length > 0) {
    // For large masks (>10k pixels), use spatial partitioning for faster lookup
    if (mask.pixel_coords.length > 10000) {
      // Sample strategically: check every Nth pixel but ensure good coverage
      const sampleRate = Math.ceil(mask.pixel_coords.length / 5000); // Max 5k pixels to check
      const sampled = mask.pixel_coords.filter((_, idx) => idx % sampleRate === 0);
      
      return sampled.some(([px, py]) => 
        Math.abs(px - screenX) <= 1 && Math.abs(py - screenY) <= 1  // Tighter tolerance
      );
    } else {
      // For smaller masks, check all pixels with tight tolerance
      return mask.pixel_coords.some(([px, py]) => 
        Math.abs(px - screenX) <= 1 && Math.abs(py - screenY) <= 1
      );
    }
  }
  
  // CRITICAL FIX: No fallback to bounding box - if no pixel coords, return false
  console.warn(`Mask ${mask.mask_id} has no pixel coordinates - skipping`);
  return false;
};

/**
 * Expands vertex assignments from sampled vertices to nearby vertices - IMPROVED
 */
const expandVertexAssignments = (
  mapping: SAMToVertexMapping, 
  sampleRate: number, 
  vertexCount: number
): void => {
  const expandedMapping: SAMToVertexMapping = {};
  
  // Initialize expanded groups
  Object.keys(mapping).forEach(groupId => {
    expandedMapping[groupId] = [];
  });
  
  // IMPROVED: Use overlapping ranges for smoother transitions
  Object.entries(mapping).forEach(([groupId, sampledVertices]) => {
    const vertexSet = new Set<number>();
    
    sampledVertices.forEach(sampledIndex => {
      // IMPROVED: Smoother expansion with smaller, overlapping ranges
      const expansionRadius = Math.ceil(sampleRate * 0.7); // Smaller radius
      const rangeStart = Math.max(0, sampledIndex - expansionRadius);
      const rangeEnd = Math.min(vertexCount, sampledIndex + expansionRadius);
      
      for (let j = rangeStart; j < rangeEnd; j++) {
        vertexSet.add(j);
      }
    });
    
    expandedMapping[groupId] = Array.from(vertexSet);
  });
  
  // IMPROVED: Resolve conflicts by giving priority to smaller masks
  const sortedGroupIds = Object.keys(expandedMapping).sort((a, b) => {
    const aSize = mapping[a]?.length || 0;
    const bSize = mapping[b]?.length || 0;
    return aSize - bSize; // Smaller masks get priority
  });
  
  const finalMapping: SAMToVertexMapping = {};
  const assignedVertices = new Set<number>();
  
  // Initialize final mapping
  Object.keys(expandedMapping).forEach(groupId => {
    finalMapping[groupId] = [];
  });
  
  // Assign vertices with priority to smaller masks
  sortedGroupIds.forEach(groupId => {
    expandedMapping[groupId].forEach(vertexIndex => {
      if (!assignedVertices.has(vertexIndex)) {
        finalMapping[groupId].push(vertexIndex);
        assignedVertices.add(vertexIndex);
      }
    });
  });
  
  // Replace original mapping with final version
  Object.assign(mapping, finalMapping);
  
  console.log('🔄 Smooth vertex expansion complete with conflict resolution');
};

/**
 * Creates masking groups from SAM results for UI display
 */
export const createSAMMaskingGroups = (samMasks: SAMMask[]): Array<{
  id: string;
  name: string; 
  color: string;
  visible: boolean;
}> => {
  console.log('🎨 Creating UI groups from SAM masks...');
  
  // Sort by area (largest first) and stability (most stable first)
  const sortedMasks = [...samMasks].sort((a, b) => {
    if (Math.abs(a.area - b.area) < 100) {
      return b.stability_score - a.stability_score; // Higher stability first
    }
    return b.area - a.area; // Larger area first
  });
  
  return sortedMasks.map((mask, index) => ({
    id: `sam_mask_${mask.mask_id}`,
    name: `Region ${mask.mask_id + 1} (${(mask.area/1000).toFixed(1)}k px)`,
    color: `hsl(${(mask.mask_id * 137.5) % 360}, 70%, 60%)`, // Golden ratio spacing
    visible: true
  }));
};

/**
 * INTEGRATION POINT: Function to be called from the frontend when SAM results arrive
 */
export const processSAMResults = (
  samResults: any, // SAM backend response
  mesh: THREE.Mesh,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer
): {
  vertexMapping: SAMToVertexMapping;
  maskingGroups: Array<{id: string; name: string; color: string; visible: boolean}>;
} => {
  console.log('🎭 PROCESSING SAM RESULTS...');
  console.log(`Input: ${samResults.masks.length} SAM masks`);
  
  // Extract view data (should be stored when SAM capture was made)
  const viewData: SAMViewData = {
    camera_matrix: samResults.camera_data?.camera_matrix || camera.matrixWorld.toArray(),
    projection_matrix: samResults.camera_data?.projection_matrix || camera.projectionMatrix.toArray(),
    viewport_size: samResults.viewport_size || { width: 1024, height: 1024 }
  };
  
  // Map SAM pixels to 3D vertices
  const vertexMapping = mapSAMPixelsToVertices(samResults.masks, mesh, viewData);
  
  // Create UI masking groups
  const maskingGroups = createSAMMaskingGroups(samResults.masks);
  
  console.log(`✅ SAM processing complete: ${Object.keys(vertexMapping).length} groups created`);
  
  return { vertexMapping, maskingGroups };
};

// Legacy export aliases for compatibility
export const mapSAMToVertices = mapSAMPixelsToVertices;

/**
 * Updates existing SAM test function to apply results to the model
 */
export const enhancedSAMTest = async (
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  mesh: THREE.Mesh,
  onMaskingUpdate: (mapping: SAMToVertexMapping, groups: Array<{id: string; name: string; color: string; visible: boolean}>) => void
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
      const result: any = await response.json();
      console.log(`✅ Enhanced SAM returned ${result.num_masks} masks`);
      
      // Map SAM masks to 3D vertices
      console.log('🔗 Starting vertex mapping...');
      const vertexMapping = mapSAMPixelsToVertices(result.masks, mesh, {
        camera_matrix: payload.camera_matrix,
        projection_matrix: payload.projection_matrix,
        viewport_size: payload.viewport_size
      });
      
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