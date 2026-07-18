"""Trace when each ground-truth part merges into another part's region."""
import os
import sys

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import segmenter
from app import load_stl

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

mesh = load_stl(open(os.path.join(FIX, "knight_fused.stl"), "rb").read())
gt = np.load(os.path.join(FIX, "knight_groundtruth.npz"))
names = list(gt.keys())
clouds = np.concatenate([gt[n] for n in names])
owner = np.concatenate([[i] * len(gt[n]) for i, n in enumerate(names)])
_, nearest = cKDTree(clouds).query(mesh.triangles_center, workers=-1)
gt_of_face = owner[nearest]

result = segmenter.segment(mesh)
labels = result["labels"]
areas = mesh.area_faces
n_patches = result["n_patches"]

# majority GT part and area per base patch
patch_part_area = np.zeros((n_patches, len(names)))
np.add.at(patch_part_area, (labels, gt_of_face), areas)
patch_area = patch_part_area.sum(axis=1)

# replay merges, tracking per-root part composition; report merges that fuse
# substantial amounts of two DIFFERENT parts
parent = list(range(n_patches))
comp = patch_part_area.copy()

def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x

total = areas.sum()
print("merges fusing >1.5% of mesh area from two different parts:")
for step, (a, b, cost) in enumerate(result["merges"]):
    ra, rb = find(a), find(b)
    pa, pb = comp[ra], comp[rb]
    ia, ib = int(np.argmax(pa)), int(np.argmax(pb))
    if ia != ib and min(pa.sum(), pb.sum()) > 0.015 * total:
        k_after = n_patches - step - 1
        print(
            f"  step {step:3d} (-> {k_after:3d} regions) cost {cost:.3f}: "
            f"{names[ia]:>7} ({pa.sum()/total:5.1%}) <- {names[ib]:>7} ({pb.sum()/total:5.1%})"
        )
    parent[rb] = ra
    comp[ra] = pa + pb
