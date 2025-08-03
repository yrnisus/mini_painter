import * as THREE from 'three';

export const loadSTLFile = (file: File): Promise<THREE.BufferGeometry> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const geometry = parseSTL(arrayBuffer);
        if (!geometry || !geometry.attributes.position) {
          throw new Error('Invalid geometry generated');
        }
        resolve(geometry);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('File reading failed'));
    reader.readAsArrayBuffer(file);
  });
};

const parseSTL = (arrayBuffer: ArrayBuffer): THREE.BufferGeometry => {
  const header = new Uint8Array(arrayBuffer, 0, 5);
  let headerString = '';
  for (let i = 0; i < header.length; i++) {
    headerString += String.fromCharCode(header[i]);
  }
  
  if (headerString.toLowerCase() === 'solid') {
    return parseASCIISTL(arrayBuffer);
  } else {
    return parseBinarySTL(arrayBuffer);
  }
};

const parseASCIISTL = (arrayBuffer: ArrayBuffer): THREE.BufferGeometry => {
  const text = new TextDecoder().decode(arrayBuffer);
  const vertices: number[] = [];
  const normals: number[] = [];
  const lines = text.split('\n');
  let currentNormal = [0, 0, 0];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('facet normal')) {
      const parts = line.split(/\s+/);
      currentNormal = [parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0, parseFloat(parts[4]) || 0];
    } else if (line.startsWith('vertex')) {
      const parts = line.split(/\s+/);
      vertices.push(parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0);
      normals.push(currentNormal[0], currentNormal[1], currentNormal[2]);
    }
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
};

const parseBinarySTL = (arrayBuffer: ArrayBuffer): THREE.BufferGeometry => {
  const view = new DataView(arrayBuffer);
  const triangleCount = view.getUint32(80, true);
  const vertices: number[] = [];
  const normals: number[] = [];
  let offset = 84;
  
  for (let i = 0; i < triangleCount; i++) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;
    
    for (let j = 0; j < 3; j++) {
      vertices.push(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
      normals.push(nx, ny, nz);
      offset += 12;
    }
    offset += 2;
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
};