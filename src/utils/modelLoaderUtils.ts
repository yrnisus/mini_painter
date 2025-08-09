import * as THREE from 'three';
import { ModelData, MaskingGroup } from '../types';
import { createGeometricMasking, applyVertexColors, VertexMasking, AIAnalysis } from './maskingUtils';

export interface ModelLoadResult {
  mesh: THREE.Mesh;
  masking: VertexMasking;
}

/**
 * Loads and processes a 3D model with masking and coloring
 */
export const loadAndProcessModel = (
  modelData: ModelData,
  maskingGroups: MaskingGroup[],
  aiAnalysis?: AIAnalysis
): ModelLoadResult => {
  // Clone and prepare geometry
  const geometry = modelData.geometry!.clone();
  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }
  
  // Create vertex masking
  const masking = createGeometricMasking(geometry, maskingGroups, aiAnalysis);
  
  // Apply initial vertex colors
  applyVertexColors(geometry, masking, maskingGroups, {});

  // Create material that uses vertex colors
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.1,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = true;
  mesh.frustumCulled = false;
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -Math.PI / 4;
  
  // Scale and position the mesh
  scaleAndPositionMesh(mesh, geometry);
  
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  return { mesh, masking };
};

/**
 * Scales and positions a mesh to fit nicely in the scene
 */
const scaleAndPositionMesh = (mesh: THREE.Mesh, geometry: THREE.BufferGeometry): THREE.Vector3 => {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  
  if (box) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = 15;
    const scale = maxDim > 0 ? targetSize / maxDim : 1;
    
    mesh.position.copy(center).multiplyScalar(-scale);
    mesh.scale.setScalar(scale);
    
    // Return the calculated orbit center
    const orbitCenter = mesh.position.clone();
    orbitCenter.y += 6;
    return orbitCenter;
  }
  
  return new THREE.Vector3(0, 6, 0);
};

/**
 * Updates existing mesh with new model data
 */
export const updateMeshModel = (
  scene: THREE.Scene,
  currentMesh: THREE.Mesh | null,
  modelData: ModelData,
  maskingGroups: MaskingGroup[],
  aiAnalysis?: AIAnalysis
): { newMesh: THREE.Mesh; masking: VertexMasking; orbitCenter: THREE.Vector3 } => {
  // Remove current mesh if it exists
  if (currentMesh) {
    scene.remove(currentMesh);
    if (currentMesh.geometry) currentMesh.geometry.dispose();
    if (currentMesh.material) (currentMesh.material as THREE.Material).dispose();
  }

  // Load and process new model
  const { mesh, masking } = loadAndProcessModel(modelData, maskingGroups, aiAnalysis);
  
  // Calculate orbit center
  const geometry = modelData.geometry!;
  const orbitCenter = scaleAndPositionMesh(mesh, geometry);
  
  // Add to scene
  scene.add(mesh);

  return { newMesh: mesh, masking, orbitCenter };
};

/**
 * Updates vertex colors on an existing mesh
 */
export const updateMeshColors = (
  mesh: THREE.Mesh,
  masking: VertexMasking,
  maskingGroups: MaskingGroup[],
  paintColors: { [key: string]: string }
): void => {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  applyVertexColors(geometry, masking, maskingGroups, paintColors);
  geometry.attributes.color.needsUpdate = true;
};

/**
 * Creates a simple fallback geometry when model loading fails
 */
export const createFallbackGeometry = (): THREE.BufferGeometry => {
  return new THREE.CylinderGeometry(1, 1, 3, 16);
};

/**
 * Validates if a geometry is suitable for processing
 */
export const validateGeometry = (geometry: THREE.BufferGeometry | undefined): boolean => {
  if (!geometry) return false;
  if (!geometry.attributes.position) return false;
  if (geometry.attributes.position.count === 0) return false;
  return true;
};