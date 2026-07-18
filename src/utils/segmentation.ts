import { FinishName, PatchStyles, Region, SegmentationData } from '../types';

const BACKEND = process.env.REACT_APP_BACKEND_URL || 'http://127.0.0.1:5000';

export async function requestSegmentation(file: File): Promise<SegmentationData> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BACKEND}/api/segment`, { method: 'POST', body: form });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).error || detail;
    } catch {}
    throw new Error(detail);
  }
  const json = await res.json();
  return {
    basePatch: decodeLabels(json.labels),
    merges: json.merges,
    nPatches: json.nPatches,
    nComponents: json.nComponents,
    suggestedRegions: json.suggestedRegions,
    elapsedSeconds: json.elapsedSeconds,
  };
}

function decodeLabels(labels: { dtype: string; count: number; b64: string }) {
  const raw = atob(labels.b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return labels.dtype === 'u16'
    ? new Uint16Array(bytes.buffer, 0, labels.count)
    : new Uint32Array(bytes.buffer, 0, labels.count);
}

/** Replay the first (nPatches - regionCount) merges; returns root patch id
 *  for every base patch.  This is what makes the granularity slider free. */
export function rootsAtCut(seg: SegmentationData, regionCount: number): Int32Array {
  const parent = new Int32Array(seg.nPatches);
  for (let i = 0; i < seg.nPatches; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const nxt = parent[x];
      parent[x] = r;
      x = nxt;
    }
    return r;
  };
  const nMerges = Math.min(
    Math.max(seg.nPatches - regionCount, 0),
    seg.merges.length
  );
  for (let m = 0; m < nMerges; m++) {
    const [into, from] = seg.merges[m];
    const ra = find(into);
    const rb = find(from);
    if (ra !== rb) parent[rb] = ra;
  }
  const roots = new Int32Array(seg.nPatches);
  for (let i = 0; i < seg.nPatches; i++) roots[i] = find(i);
  return roots;
}

export function defaultStyles(nPatches: number): PatchStyles {
  return {
    color: new Array(nPatches).fill(null),
    finish: new Array(nPatches).fill('matte' as FinishName),
    visible: new Array(nPatches).fill(true),
  };
}

/** Group base patches into displayable regions for the current cut.
 *  Region style is read from its dominant (most triangles) base patch. */
export function buildRegions(
  seg: SegmentationData,
  roots: Int32Array,
  styles: PatchStyles
): Region[] {
  const triPerPatch = new Int32Array(seg.nPatches);
  const bp = seg.basePatch;
  for (let t = 0; t < bp.length; t++) triPerPatch[bp[t]]++;

  const byRoot = new Map<number, number[]>();
  for (let p = 0; p < seg.nPatches; p++) {
    if (triPerPatch[p] === 0) continue;
    const r = roots[p];
    const list = byRoot.get(r);
    if (list) list.push(p);
    else byRoot.set(r, [p]);
  }

  const regions: Region[] = [];
  byRoot.forEach((patches, id) => {
    let triCount = 0;
    let dominant = patches[0];
    for (const p of patches) {
      triCount += triPerPatch[p];
      if (triPerPatch[p] > triPerPatch[dominant]) dominant = p;
    }
    regions.push({
      id,
      patches,
      triCount,
      color: styles.color[dominant],
      finish: styles.finish[dominant],
      visible: styles.visible[dominant],
    });
  });
  regions.sort((a, b) => b.triCount - a.triCount);
  return regions;
}

export async function backendHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
