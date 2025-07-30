import * as THREE from 'three';

export interface MaskingGroup {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

export interface ModelData {
  name: string;
  size: number;
  type: string;
  uploadedAt: Date;
  geometry?: THREE.BufferGeometry;
}

export interface PaintColors {
  [key: string]: string;
}