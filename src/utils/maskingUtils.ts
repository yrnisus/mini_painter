import * as THREE from 'three';
import { MaskingGroup, PaintColors } from '../types';

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

/**
 * Creates geometric masking based on mesh properties and AI analysis
 */
export const createGeometricMasking = (
  geometry: THREE.BufferGeometry,
  maskingGroups: MaskingGroup[],
  aiAnalysis?: AIAnalysis
): VertexMasking => {
  const positions = geometry.attributes.position;
  const vertexCount = positions.count;
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
  
  console.log(`Creating masking for ${vertexCount} vertices`);
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
 * Applies vertex colors based on masking groups and paint colors
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