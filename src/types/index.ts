export type FinishName = 'matte' | 'satin' | 'gloss' | 'metallic';

export interface ModelData {
  name: string;
  size: number;
  uploadedAt: Date;
  /** raw triangle soup straight from the STL: 9 floats per triangle */
  positions: Float32Array;
  triCount: number;
}

export interface SegmentationData {
  /** finest-granularity patch id per triangle, in file triangle order */
  basePatch: Uint16Array | Uint32Array;
  /** ordered merges [into, from, cost]; replaying the first M leaves nPatches-M regions */
  merges: [number, number, number][];
  nPatches: number;
  nComponents: number;
  suggestedRegions: number;
  elapsedSeconds: number;
}

/** paint styling stored at base-patch granularity so it survives
 *  granularity changes without remapping */
export interface PatchStyles {
  color: (string | null)[];
  finish: FinishName[];
  visible: boolean[];
}

/** a region = a set of base patches at the current granularity cut */
export interface Region {
  id: number;          // root base-patch id (stable while the cut holds)
  patches: number[];
  triCount: number;
  color: string | null;
  finish: FinishName;
  visible: boolean;
}
