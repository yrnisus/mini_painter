import { ModelData } from '../types';

/** Parse an STL file into a raw triangle soup (9 floats per triangle),
 *  keeping file triangle order -- the backend labels triangles by that
 *  same order, so it must never be shuffled. */
export async function loadSTLFile(file: File): Promise<ModelData> {
  const buffer = await file.arrayBuffer();
  const positions = isAscii(buffer) ? parseAscii(buffer) : parseBinary(buffer);
  if (positions.length === 0) throw new Error('no triangles found in STL');
  return {
    name: file.name,
    size: file.size,
    uploadedAt: new Date(),
    positions,
    triCount: positions.length / 9,
  };
}

function isAscii(buffer: ArrayBuffer): boolean {
  const head = new TextDecoder()
    .decode(new Uint8Array(buffer, 0, Math.min(512, buffer.byteLength)))
    .trimStart()
    .toLowerCase();
  // binary STLs may also start with "solid"; require an ascii facet keyword
  return head.startsWith('solid') && head.includes('facet');
}

function parseAscii(buffer: ArrayBuffer): Float32Array {
  const text = new TextDecoder().decode(buffer);
  const out: number[] = [];
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  return new Float32Array(out.slice(0, out.length - (out.length % 9)));
}

function parseBinary(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  const positions = new Float32Array(triCount * 9);
  let offset = 84;
  let w = 0;
  for (let i = 0; i < triCount; i++) {
    offset += 12; // skip facet normal
    for (let v = 0; v < 9; v++) {
      positions[w++] = view.getFloat32(offset, true);
      offset += 4;
    }
    offset += 2; // attribute byte count
  }
  return positions;
}

/** Area-weighted smooth vertex normals for a triangle soup.  Vertices are
 *  matched by exact position so shared edges shade smoothly even though the
 *  soup never shares vertices. */
export function computeSmoothNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  const acc = new Map<string, [number, number, number]>();
  const keys = new Array<string>(positions.length / 3);

  for (let t = 0; t < positions.length; t += 9) {
    const ax = positions[t], ay = positions[t + 1], az = positions[t + 2];
    const bx = positions[t + 3], by = positions[t + 4], bz = positions[t + 5];
    const cx = positions[t + 6], cy = positions[t + 7], cz = positions[t + 8];
    // cross(b-a, c-a): length is proportional to area (weighting)
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (let v = 0; v < 3; v++) {
      const i = t + v * 3;
      const key = `${positions[i]},${positions[i + 1]},${positions[i + 2]}`;
      keys[i / 3] = key;
      const slot = acc.get(key);
      if (slot) {
        slot[0] += nx;
        slot[1] += ny;
        slot[2] += nz;
      } else {
        acc.set(key, [nx, ny, nz]);
      }
    }
  }

  for (let v = 0; v < positions.length / 3; v++) {
    const [nx, ny, nz] = acc.get(keys[v])!;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    normals[v * 3] = nx / len;
    normals[v * 3 + 1] = ny / len;
    normals[v * 3 + 2] = nz / len;
  }
  return normals;
}
