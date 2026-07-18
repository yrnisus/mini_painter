"""Build synthetic knight-like miniatures for testing segmentation.

Produces two STLs in tests/fixtures/:
  knight_fused.stl  - all parts boolean-unioned into ONE connected surface
                      (the hard case: no connectivity shortcut exists)
  knight_parts.stl  - same parts simply concatenated (multi-component case)

Each part is tagged so we can score segmentation against ground truth.
"""

import os

import numpy as np
import trimesh
from trimesh.creation import box, capsule, cylinder, icosphere
from trimesh.transformations import rotation_matrix as rot


def _move(mesh, x=0, y=0, z=0):
    mesh.apply_translation([x, y, z])
    return mesh


def build_parts():
    parts = {}

    parts["base"] = _move(cylinder(radius=9, height=2.4, sections=48), z=1.2)

    leg_l = _move(cylinder(radius=1.5, height=7, sections=24), x=-2, z=5.5)
    leg_r = _move(cylinder(radius=1.5, height=7, sections=24), x=2, z=5.5)
    parts["legs"] = leg_l + leg_r

    torso = capsule(radius=3.4, height=6.5, count=[24, 24])
    parts["torso"] = _move(torso, z=13.0)

    parts["head"] = _move(icosphere(subdivisions=3, radius=2.3), z=20.5)

    # right arm holding a sword
    arm_r = cylinder(radius=1.1, height=8, sections=20)
    arm_r.apply_transform(rot(np.radians(65), [0, 1, 0]))
    parts["arm_r"] = _move(arm_r, x=4.6, z=14.0)

    blade = box(extents=[0.7, 2.0, 14.0])
    guard = box(extents=[3.2, 3.2, 0.9])
    grip = _move(cylinder(radius=0.55, height=2.6, sections=16), z=-0.5)
    pommel = icosphere(subdivisions=2, radius=0.9)
    sword = trimesh.boolean.union(
        [_move(blade, z=8.0), _move(guard, z=0.6), grip, _move(pommel, z=-1.9)],
        engine="manifold",
    )
    parts["sword"] = _move(sword, x=7.6, z=12.5)

    # left arm holding a shield
    arm_l = cylinder(radius=1.1, height=7, sections=20)
    arm_l.apply_transform(rot(np.radians(-75), [0, 1, 0]))
    parts["arm_l"] = _move(arm_l, x=-4.4, z=14.0)

    shield = cylinder(radius=4.4, height=1.0, sections=40)
    shield.apply_transform(rot(np.radians(90), [0, 0, 1]))
    shield.apply_transform(rot(np.radians(90), [0, 1, 0]))
    parts["shield"] = _move(shield, x=-7.4, y=0, z=13.5)

    return parts


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "tests", "fixtures")
    os.makedirs(out_dir, exist_ok=True)

    parts = build_parts()

    concat = trimesh.util.concatenate(list(parts.values()))
    concat.export(os.path.join(out_dir, "knight_parts.stl"))

    fused = None
    for mesh in parts.values():
        fused = mesh if fused is None else trimesh.boolean.union(
            [fused, mesh], engine="manifold"
        )
    assert fused.body_count == 1, f"fused knight has {fused.body_count} bodies"
    # subdivide so the fused mesh has miniature-like density and the
    # segmenter can't rely on coarse primitive facets
    for _ in range(2):
        fused = fused.subdivide()
    fused.export(os.path.join(out_dir, "knight_fused.stl"))

    # ground truth for scoring: per-part surface point clouds
    np.savez(
        os.path.join(out_dir, "knight_groundtruth.npz"),
        **{name: mesh.sample(4000) for name, mesh in parts.items()},
    )
    print(f"fused: {len(fused.faces)} faces, parts: {len(concat.faces)} faces")
    print("wrote", out_dir)


if __name__ == "__main__":
    main()
