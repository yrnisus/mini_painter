import * as THREE from 'three';
import { MaskingGroup, PaintColors } from '../types';
import { SAMToVertexMapping, SAMViewData } from './samTo3DMapper';

export interface VertexMasking {
  [groupId: string]: number[];
}

export interface AIAnalysis {
  success: boolean;
  masking_groups?: {
    [groupId: string]: {
      name: string;
      color: string;
      vertices: number[];
      description: string;
      vertex_count: number;
      percentage: number;
    };
  };
}

// Store SAM mapping globally when available
let globalSAMMapping: SAMToVertexMapping | null = null;
let globalSAMViewData: SAMViewData | null = null;

/**
 * Sets SAM mapping data for use in vertex masking
 */
export const setSAMMapping = (
  samMapping: SAMToVertexMapping, 
  viewData: SAMViewData
): void => {
  console.log('🎭 Setting global SAM mapping...');
  globalSAMMapping = samMapping;
  globalSAMViewData = viewData;
  
  const groupCount = Object.keys(samMapping).length;
  const totalVertices = Object.values(samMapping).reduce((sum, vertices) => sum + vertices.length, 0);
  console.log(`SAM mapping set: ${groupCount} groups, ${totalVertices} vertex assignments`);
};

/**
 * Clears SAM mapping (when switching back to geometric mode)
 */
export const clearSAMMapping = (): void => {
  console.log('🔄 Clearing SAM mapping - switching to geometric mode');
  globalSAMMapping = null;
  globalSAMViewData = null;
};

/**
 * Creates masking with SAM integration
 * Uses SAM pixel-to-vertex mapping when available, falls back to geometric
 */
export const createGeometricMasking = (
  geometry: THREE.BufferGeometry,
  maskingGroups: MaskingGroup[],
  aiAnalysis?: AIAnalysis
): VertexMasking => {
  const positions = geometry.attributes.position;
  const vertexCount = positions.count;
  
  console.log(`🎯 Creating masking for ${vertexCount} vertices`);
  console.log(`SAM mapping available: ${!!globalSAMMapping}`);
  console.log(`Masking groups: ${maskingGroups.map(g => g.id).join(', ')}`);
  
  // Use SAM mapping if available and groups match
  if (globalSAMMapping && usesSAMGroups(maskingGroups)) {
    console.log('🎭 Using SAM-based vertex mapping');
    return createSAMBasedMasking(globalSAMMapping, maskingGroups, vertexCount);
  }
  
  // Original geometric masking logic
  console.log('📐 Using geometric-based vertex mapping');
  
  const masking: VertexMasking = {};
  
  // Initialize masking groups
  maskingGroups.forEach(group => {
    masking[group.id] = [];
  });
  
  // Get bounding box and center
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  
  console.log(`Bounding box: min=${bbox.min.toArray()}, max=${bbox.max.toArray()}`);
  console.log(`Size: ${size.toArray()}, Center: ${center.toArray()}`);
  
  // Use AI analysis grouping if available
  if (aiAnalysis?.success && aiAnalysis.masking_groups) {
    return createAIInformedMasking(
      positions as THREE.BufferAttribute, 
      vertexCount, 
      bbox, 
      size, 
      center, 
      maskingGroups, 
      aiAnalysis.masking_groups,
      masking
    );
  } else {
    return createFallbackMasking(
      positions as THREE.BufferAttribute, 
      vertexCount, 
      bbox, 
      size, 
      maskingGroups, 
      masking
    );
  }
};

/**
 * Creates SAM-based masking using real pixel-to-vertex mapping
 */
const createSAMBasedMasking = (
  samMapping: SAMToVertexMapping,
  maskingGroups: MaskingGroup[],
  vertexCount: number
): VertexMasking => {
  console.log('🎭 Creating SAM-based masking...');
  
  const masking: VertexMasking = {};
  
  // Initialize all groups
  maskingGroups.forEach(group => {
    masking[group.id] = [];
  });
  
  // Map SAM groups to masking groups
  Object.entries(samMapping).forEach(([samGroupId, vertexIndices]) => {
    // Find corresponding masking group
    const maskingGroup = maskingGroups.find(g => g.id === samGroupId);
    
    if (maskingGroup && vertexIndices.length > 0) {
      masking[maskingGroup.id] = [...vertexIndices]; // Copy vertex indices
      console.log(`🎭 SAM group ${samGroupId}: ${vertexIndices.length} vertices`);
    } else if (vertexIndices.length > 0) {
      console.log(`⚠️ SAM group ${samGroupId} not found in masking groups, skipping ${vertexIndices.length} vertices`);
    }
  });
  
  // Verify all vertices are assigned
  const totalAssigned = Object.values(masking).reduce((sum, vertices) => sum + vertices.length, 0);
  console.log(`🎭 SAM masking complete: ${totalAssigned}/${vertexCount} vertices assigned`);
  
  if (totalAssigned === 0) {
    console.error('❌ No vertices assigned from SAM mapping - falling back to geometric');
    // Return basic fallback masking
    const fallbackMasking: VertexMasking = {};
    maskingGroups.forEach((group, index) => {
      const startIdx = Math.floor(index * vertexCount / maskingGroups.length);
      const endIdx = Math.floor((index + 1) * vertexCount / maskingGroups.length);
      fallbackMasking[group.id] = Array.from({ length: endIdx - startIdx }, (_, i) => startIdx + i);
    });
    return fallbackMasking;
  }
  
  logMaskingResults(masking, vertexCount);
  return masking;
};

/**
 * Checks if masking groups are SAM-based (have sam_mask_ prefix)
 */
const usesSAMGroups = (maskingGroups: MaskingGroup[]): boolean => {
  return maskingGroups.some(group => group.id.startsWith('sam_mask_'));
};

/**
 * Creates AI-informed masking based on backend analysis
 */
const createAIInformedMasking = (
  positions: THREE.BufferAttribute,
  vertexCount: number,
  bbox: THREE.Box3,
  size: THREE.Vector3,
  center: THREE.Vector3,
  maskingGroups: MaskingGroup[],
  aiGroups: any,
  masking: VertexMasking
): VertexMasking => {
  console.log('🤖 Using AI-based geometric segmentation with', Object.keys(aiGroups).length, 'groups');
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

  logMaskingResults(masking, vertexCount);
  return masking;
};

/**
 * Creates fallback geometric masking when AI analysis is not available
 */
const createFallbackMasking = (
  positions: THREE.BufferAttribute,
  vertexCount: number,
  bbox: THREE.Box3,
  size: THREE.Vector3,
  maskingGroups: MaskingGroup[],
  masking: VertexMasking
): VertexMasking => {
  console.log('📐 Using fallback geometric segmentation');
  
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

  logMaskingResults(masking, vertexCount);
  return masking;
};

/**
 * Logs the results of vertex masking
 */
const logMaskingResults = (masking: VertexMasking, vertexCount: number): void => {
  const assignments = Object.entries(masking).map(([groupId, vertices]) => 
    `${groupId}: ${vertices.length} vertices (${(vertices.length / vertexCount * 100).toFixed(1)}%)`
  );
  console.log('Vertex masking created:', assignments);
};

/**
 * Applies vertex colors based on masking groups and paint colors - IMPROVED
 */
export const applyVertexColors = (
  geometry: THREE.BufferGeometry, 
  masking: VertexMasking,
  maskingGroups: MaskingGroup[],
  paintColors: PaintColors
): THREE.BufferGeometry => {
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const vertexCount = positions.count;
  const colors = new Float32Array(vertexCount * 3);
  
  // IMPROVED: Better default color (light gray instead of dark gray)
  const defaultColor = new THREE.Color(0xCCCCCC); // Lighter default
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