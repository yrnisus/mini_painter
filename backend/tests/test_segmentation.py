"""Offline verification of the segmentation pipeline.

Run with:  venv/bin/python tests/test_segmentation.py

Checks:
  1. the backend load path preserves STL triangle order (the client
     depends on labels[i] matching file triangle i)
  2. the fused knight (single connected surface) separates into its
     semantic parts at the suggested granularity, scored against the
     construction-time ground truth
  3. the multi-part knight resolves components correctly
"""

import os
import struct
import sys
import time

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import segmenter  # noqa: E402
from app import load_stl  # noqa: E402

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def parse_binary_stl_centroids(path):
    with open(path, "rb") as f:
        data = f.read()
    (n,) = struct.unpack_from("<I", data, 80)
    tris = np.frombuffer(data, dtype=np.uint8, count=n * 50, offset=84)
    tris = tris.reshape(n, 50)[:, 12:48].copy().view("<f4").reshape(n, 3, 3)
    return tris.mean(axis=1)


def check_face_order(path):
    mesh = load_stl(open(path, "rb").read())
    file_centroids = parse_binary_stl_centroids(path)
    assert len(mesh.faces) == len(file_centroids), (
        f"face count changed on load: {len(mesh.faces)} vs {len(file_centroids)}"
    )
    err = np.abs(mesh.triangles_center - file_centroids).max()
    assert err < 1e-4, f"face order not preserved (max centroid error {err})"
    print(f"  [ok] face order preserved through load ({len(mesh.faces)} faces)")
    return mesh


def labels_at_cut(result, k):
    """Replay merges until k regions remain (mirrors the frontend logic)."""
    parent = list(range(result["n_patches"]))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    n_merges = max(0, result["n_patches"] - k)
    for a, b, _ in result["merges"][:n_merges]:
        parent[find(b)] = find(a)
    roots = np.array([find(p) for p in range(result["n_patches"])])
    return roots[result["labels"]]


def score(mesh, labels, gt_path):
    """Score with painting semantics: a part may be covered by several
    regions (both legs, blade vs pommel) -- what matters is that the regions
    claiming a part don't bleed across part boundaries (purity), cover it
    (recall), and aren't shattered into confetti (fragmentation)."""
    gt = np.load(gt_path)
    names = list(gt.keys())
    clouds = np.concatenate([gt[n] for n in names])
    owner = np.concatenate([[i] * len(gt[n]) for i, n in enumerate(names)])
    tree = cKDTree(clouds)
    _, nearest = tree.query(mesh.triangles_center, workers=-1)
    gt_of_face = owner[nearest]

    areas = mesh.area_faces
    regions = np.unique(labels)
    print(f"  regions found: {len(regions)}")

    # majority ground-truth part per region
    majority = {}
    for r in regions:
        in_r = labels == r
        part_area = np.zeros(len(names))
        np.add.at(part_area, gt_of_face[in_r], areas[in_r])
        majority[r] = int(np.argmax(part_area))

    ok = True
    for i, name in enumerate(names):
        part = gt_of_face == i
        part_area = areas[part].sum()
        mine = np.array([r for r in regions if majority[r] == i])
        if len(mine) == 0:
            print(f"  [POOR] {name:>7}: no region claims this part")
            ok = False
            continue
        in_mine = np.isin(labels, mine)
        recall = areas[part & in_mine].sum() / part_area
        purity = areas[part & in_mine].sum() / areas[in_mine].sum()
        frag = len(mine)
        good = recall > 0.75 and purity > 0.65 and frag <= 8
        if not good:
            ok = False
        print(
            f"  [{'ok' if good else 'POOR':>4}] {name:>7}: recall {recall:5.1%}  "
            f"purity {purity:5.1%}  regions {frag}"
        )
    return ok


def main():
    print("== face order preservation ==")
    fused_path = os.path.join(FIX, "knight_fused.stl")
    parts_path = os.path.join(FIX, "knight_parts.stl")
    mesh_fused = check_face_order(fused_path)
    mesh_parts = check_face_order(parts_path)

    print("\n== fused knight (single connected surface) ==")
    t0 = time.time()
    result = segmenter.segment(mesh_fused)
    print(f"  segmented in {time.time() - t0:.2f}s, "
          f"{result['n_patches']} patches, {result['n_components']} components, "
          f"suggested {result['suggested_regions']} regions")
    labels = labels_at_cut(result, result["suggested_regions"])
    ok_fused = score(mesh_fused, labels, os.path.join(FIX, "knight_groundtruth.npz"))


    print("\n== multi-part knight (concatenated components) ==")
    result_p = segmenter.segment(mesh_parts)
    print(f"  {result_p['n_components']} components detected")
    labels_p = labels_at_cut(result_p, result_p["suggested_regions"])
    ok_parts = score(mesh_parts, labels_p, os.path.join(FIX, "knight_groundtruth.npz"))

    print("\n== summary ==")
    print("fused:", "PASS" if ok_fused else "FAIL", "| parts:", "PASS" if ok_parts else "FAIL")
    sys.exit(0 if (ok_fused and ok_parts) else 1)


if __name__ == "__main__":
    main()
