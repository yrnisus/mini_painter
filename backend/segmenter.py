"""Mesh segmentation for miniature painting.

Pipeline:
  1. (optional) decimate dense meshes to a working resolution
  2. over-segment into ~300 surface patches by crease-aware region growing
     (multi-source Dijkstra where walking across a concave crease is expensive
     -- the Katz-Tal "angular distance" idea)
  3. measure local shape thickness per face (SDF via ray casting) so a thin
     blade reads as different material than the thick torso it joins
  4. greedily merge adjacent patches, cheapest boundary first, recording the
     full merge sequence.  The client replays that sequence with a union-find
     to move a "granularity" slider instantly -- no server round trip.
  5. map patch labels back onto the original full-resolution faces

The output labels are indexed by face order as stored in the uploaded file,
which for STL matches triangle order, i.e. what a client-side STL parser sees.
"""

import heapq
import logging

import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

logger = logging.getLogger(__name__)

# Faces above this count get decimated for segmentation (labels are mapped
# back to full resolution afterwards).
DECIMATE_ABOVE = 90_000
DECIMATE_TARGET = 60_000

DEFAULT_PATCHES = 500

# Region-growing metric: cost of walking face-to-face is geodesic distance
# inflated by how sharp the crossing is.  For patch GROWTH all sharp edges
# are barriers (patch borders then snap onto them instead of straddling);
# for MERGE cost only concave creases stay expensive -- convex panel edges
# are cheap to merge across, concave part boundaries are not.
ANGULAR_WEIGHT = 12.0
CONVEX_DISCOUNT_GROW = 0.7
CONVEX_DISCOUNT_MERGE = 0.15

# Merge cost mixing: boundary sharpness vs thickness difference.
W_BOUNDARY = 1.0
W_THICKNESS = 1.6


def _decimate(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    import fast_simplification

    reduction = 1.0 - (DECIMATE_TARGET / len(mesh.faces))
    points, faces = fast_simplification.simplify(
        mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), reduction
    )
    dec = trimesh.Trimesh(vertices=points, faces=faces, process=False)
    logger.info("decimated %d -> %d faces for segmentation", len(mesh.faces), len(dec.faces))
    return dec


def _edge_costs(mesh: trimesh.Trimesh):
    """Per adjacency edge: (growth cost, merge cost) angular sharpness."""
    angles = mesh.face_adjacency_angles  # unsigned, radians
    convex = mesh.face_adjacency_convex
    ang = 1.0 - np.cos(angles)  # 0 flat .. 2 folded
    grow = ang * np.where(convex, CONVEX_DISCOUNT_GROW, 1.0)
    merge = ang * np.where(convex, CONVEX_DISCOUNT_MERGE, 1.0)
    return grow, merge


def _face_graph(mesh: trimesh.Trimesh, ang_cost: np.ndarray):
    """Sparse symmetric graph over faces for region growing."""
    adj = mesh.face_adjacency
    centroids = mesh.triangles_center
    geo = np.linalg.norm(centroids[adj[:, 0]] - centroids[adj[:, 1]], axis=1)
    scale = geo.mean() if len(geo) else 1.0
    w = (geo / scale) * (1.0 + ANGULAR_WEIGHT * ang_cost)
    n = len(mesh.faces)
    g = coo_matrix(
        (np.concatenate([w, w]),
         (np.concatenate([adj[:, 0], adj[:, 1]]),
          np.concatenate([adj[:, 1], adj[:, 0]]))),
        shape=(n, n),
    ).tocsr()
    return g


def _pick_seeds(mesh: trimesh.Trimesh, comp_labels: np.ndarray, n_patches: int):
    """Area-stratified farthest-point seeds per connected component."""
    centroids = mesh.triangles_center
    areas = mesh.area_faces
    total = areas.sum()
    seeds = []
    for comp in np.unique(comp_labels):
        idx = np.flatnonzero(comp_labels == comp)
        comp_area = areas[idx].sum()
        k = max(1, int(round(n_patches * comp_area / total)))
        k = min(k, len(idx))
        pts = centroids[idx]
        # farthest point sampling in euclidean space (cheap, good enough
        # for an over-segmentation that gets merged anyway)
        chosen = [int(np.argmax(np.linalg.norm(pts - pts.mean(axis=0), axis=1)))]
        dmin = np.linalg.norm(pts - pts[chosen[0]], axis=1)
        for _ in range(k - 1):
            nxt = int(np.argmax(dmin))
            chosen.append(nxt)
            dmin = np.minimum(dmin, np.linalg.norm(pts - pts[nxt], axis=1))
        seeds.extend(idx[chosen])
    return np.array(sorted(set(seeds)), dtype=np.int64)


def _grow_patches(graph, seeds: np.ndarray, mesh: trimesh.Trimesh, relax: int = 2):
    """Assign every face to its nearest seed in the crease-aware metric,
    with a couple of Lloyd relaxation rounds (recenter seeds inside their
    patch, regrow) so patch borders on smooth featureless areas come out
    compact instead of ragged."""
    n_faces = len(mesh.faces)
    centroids = mesh.triangles_center

    def grow(seed_nodes):
        _, _, sources = dijkstra(
            graph, directed=False, indices=seed_nodes,
            min_only=True, return_predecessors=True,
        )
        seed_to_patch = {int(s): i for i, s in enumerate(seed_nodes)}
        labels = np.full(n_faces, -1, dtype=np.int64)
        reached = sources >= 0
        labels[reached] = [seed_to_patch[int(s)] for s in sources[reached]]
        labels[~reached] = 0  # isolated slivers: dump into patch 0
        return labels

    labels = grow(seeds)
    for _ in range(relax):
        new_seeds = []
        for p in range(len(seeds)):
            members = np.flatnonzero(labels == p)
            if len(members) == 0:
                continue
            center = centroids[members].mean(axis=0)
            best = members[np.argmin(
                np.linalg.norm(centroids[members] - center, axis=1)
            )]
            new_seeds.append(int(best))
        seeds = np.array(sorted(set(new_seeds)), dtype=np.int64)
        labels = grow(seeds)
    return labels


def _face_thickness(mesh: trimesh.Trimesh) -> np.ndarray:
    """Shape Diameter Function per face: cast a small cone of rays inward
    from each face centroid and take the median distance to the opposite
    surface.  The cone + median matters: a single ray along the normal
    reports a thin disc's side wall as the whole diameter, which then blocks
    perfectly good merges.  Requires an embree-backed intersector -- with
    the pure-python fallback this would take minutes, so skip instead
    (segmentation still works from crease information alone)."""
    n = len(mesh.faces)
    if not getattr(trimesh.ray, "has_embree", False):
        logger.warning("embree not available; skipping thickness feature")
        return np.ones(n)
    normals = mesh.face_normals
    # orthonormal tangent frame per face
    helper = np.where(
        np.abs(normals[:, 0:1]) < 0.9, [[1.0, 0, 0]], [[0, 1.0, 0]]
    )
    t1 = np.cross(normals, helper)
    t1 /= np.linalg.norm(t1, axis=1, keepdims=True)
    t2 = np.cross(normals, t1)

    spread = np.tan(np.radians(25))
    dirsets = [-normals]
    for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        d = -normals + spread * (a * t1 + b * t2)
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        dirsets.append(d)

    origins = mesh.triangles_center - normals * (mesh.scale * 1e-4)
    samples = np.full((len(dirsets), n), np.nan)
    try:
        for k, dirs in enumerate(dirsets):
            hits, ray_idx, _ = mesh.ray.intersects_location(
                origins, dirs, multiple_hits=False
            )
            if len(ray_idx):
                d = np.linalg.norm(hits - origins[ray_idx], axis=1)
                # cone rays measure a longer chord; project onto the normal
                cosang = -np.einsum("ij,ij->i", dirs[ray_idx], normals[ray_idx])
                samples[k, ray_idx] = d * np.clip(cosang, 0.3, 1.0)
    except BaseException as exc:  # pragma: no cover - ray backend quirks
        logger.warning("thickness estimation failed (%s); continuing without", exc)
        return np.ones(n)

    thickness = np.nanmedian(samples, axis=0)
    finite = np.isfinite(thickness)
    if finite.any():
        cap = np.nanpercentile(thickness[finite], 95)
        thickness = np.clip(thickness, None, cap)
        thickness[~finite] = np.nanmedian(thickness[finite])
    else:
        thickness = np.ones(n)
    return thickness


def _merge_sequence(mesh, patch_of_face, ang_cost, thickness, comp_labels):
    """Greedy agglomerative merging.  Returns ordered [a, b, cost] triples,
    meaning patch b merges into patch a."""
    n_patches = int(patch_of_face.max()) + 1
    areas = np.zeros(n_patches)
    np.add.at(areas, patch_of_face, mesh.area_faces)
    total_area = areas.sum()
    # reference scale for the size factor: a few average patches.  Regions
    # smaller than this merge cheaply (noise absorption); anything bigger
    # pays full boundary cost, so thin-but-real structures like an arm or a
    # sword grip don't get swallowed just for being small.
    ref_area = 4.0 * total_area / max(n_patches, 1)

    thick = np.zeros(n_patches)
    wsum = np.zeros(n_patches)
    np.add.at(thick, patch_of_face, thickness * mesh.area_faces)
    np.add.at(wsum, patch_of_face, mesh.area_faces)
    thick = thick / np.maximum(wsum, 1e-12)

    # boundary sharpness between adjacent patches
    adj = mesh.face_adjacency
    pa, pb = patch_of_face[adj[:, 0]], patch_of_face[adj[:, 1]]
    cross = pa != pb
    boundary_sum: dict = {}
    boundary_cnt: dict = {}
    for a, b, c in zip(pa[cross], pb[cross], ang_cost[cross]):
        key = (min(a, b), max(a, b))
        boundary_sum[key] = boundary_sum.get(key, 0.0) + c
        boundary_cnt[key] = boundary_cnt.get(key, 0) + 1

    parent = list(range(n_patches))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def cost_of(a, b):
        key = (min(a, b), max(a, b))
        sharp = boundary_sum[key] / boundary_cnt[key]
        t = abs(thick[a] - thick[b]) / (max(thick[a], thick[b]) + 1e-12)
        size = np.clip(np.sqrt(min(areas[a], areas[b]) / ref_area), 0.05, 1.0)
        return (W_BOUNDARY * sharp + W_THICKNESS * t) * size

    heap = [(cost_of(a, b), a, b) for (a, b) in boundary_sum]
    heapq.heapify(heap)
    merges = []

    while heap:
        c, a, b = heapq.heappop(heap)
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        key = (min(ra, rb), max(ra, rb))
        if key not in boundary_sum:
            continue
        # lazy heap: re-check cost against current stats
        cur = cost_of(ra, rb)
        if cur > c * 1.001 + 1e-12:
            heapq.heappush(heap, (cur, ra, rb))
            continue
        # merge rb into ra
        parent[rb] = ra
        merges.append([int(ra), int(rb), float(cur)])
        # fold stats
        w = areas[ra] + areas[rb]
        thick[ra] = (thick[ra] * areas[ra] + thick[rb] * areas[rb]) / max(w, 1e-12)
        areas[ra] = w
        # rewire rb's boundaries to ra
        for key2 in [k for k in boundary_sum if rb in k]:
            other = key2[0] if key2[1] == rb else key2[1]
            s, n = boundary_sum.pop(key2), boundary_cnt.pop(key2)
            if other == ra:
                continue
            nk = (min(ra, other), max(ra, other))
            boundary_sum[nk] = boundary_sum.get(nk, 0.0) + s
            boundary_cnt[nk] = boundary_cnt.get(nk, 0) + n
            heapq.heappush(heap, (cost_of(*nk), *nk))

    # different connected components never share a boundary; chain the
    # remaining roots together (nearest centroids first) so the slider can
    # go all the way down to one region
    roots = sorted({find(i) for i in range(n_patches)})
    if len(roots) > 1:
        centroids = np.zeros((n_patches, 3))
        np.add.at(centroids, patch_of_face, mesh.triangles_center * mesh.area_faces[:, None])
        pending = {r: centroids[r] / max(areas[r], 1e-12) for r in roots}
        base_cost = merges[-1][2] if merges else 1.0
        while len(pending) > 1:
            keys = list(pending)
            pts = np.array([pending[k] for k in keys])
            tree = cKDTree(pts)
            d, j = tree.query(pts, k=2)
            i = int(np.argmin(d[:, 1]))
            a, b = keys[i], keys[int(j[i, 1])]
            ra, rb = find(a), find(b)
            parent[rb] = ra
            merges.append([int(ra), int(rb), float(base_cost * 2 + d[i, 1])])
            del pending[b]

    return merges


def _majority_smooth(mesh: trimesh.Trimesh, labels: np.ndarray, rounds: int = 3):
    """Speckle removal: a face whose two (or three) edge-neighbors agree on a
    different label adopts it.  Cleans up single-face slivers on boundaries."""
    adj = mesh.face_adjacency
    n = len(mesh.faces)
    neighbors = np.full((n, 3), -1, dtype=np.int64)
    counts = np.zeros(n, dtype=np.int64)
    for a, b in adj:
        if counts[a] < 3:
            neighbors[a, counts[a]] = b
            counts[a] += 1
        if counts[b] < 3:
            neighbors[b, counts[b]] = a
            counts[b] += 1

    out = labels
    for _ in range(rounds):
        n0 = np.where(neighbors[:, 0] >= 0, out[neighbors[:, 0]], -1)
        n1 = np.where(neighbors[:, 1] >= 0, out[neighbors[:, 1]], -1)
        n2 = np.where(neighbors[:, 2] >= 0, out[neighbors[:, 2]], -2)
        pair01 = (n0 == n1) & (n0 >= 0)
        pair12 = (n1 == n2) & (n1 >= 0)
        pair02 = (n0 == n2) & (n0 >= 0)
        majority = np.where(pair01, n0, np.where(pair12, n1, np.where(pair02, n0, out)))
        out = majority.astype(np.int64)
    return out


def _map_to_original(orig: trimesh.Trimesh, work: trimesh.Trimesh, labels: np.ndarray):
    """Carry per-face labels from the decimated mesh back to full resolution,
    then smooth out mapping speckle."""
    tree = cKDTree(work.triangles_center)
    _, nearest = tree.query(orig.triangles_center, k=1, workers=-1)
    return _majority_smooth(orig, labels[nearest])


def suggest_cut(merges, n_patches):
    """Pick a default region count: the biggest relative jump in merge cost
    over the last stretch of merges (elbow), clamped to a sane range."""
    if not merges:
        return 1
    costs = np.array([m[2] for m in merges])
    lo = max(0, len(costs) - 60)  # only look near the coarse end
    window = costs[lo:]
    if len(window) < 2:
        return max(1, n_patches - len(merges))
    jumps = window[1:] / np.maximum(window[:-1], 1e-9)
    best = int(np.argmax(jumps)) + lo + 1
    k = n_patches - best
    # painters prefer starting slightly over-segmented: regions are easy to
    # merge by painting them the same color, impossible to un-mix
    return int(np.clip(k, 12, 28))


def segment(mesh: trimesh.Trimesh, n_patches: int = DEFAULT_PATCHES) -> dict:
    orig = mesh
    n_patches = int(np.clip(n_patches, 24, 2000))
    work = _decimate(mesh) if len(mesh.faces) > DECIMATE_ABOVE else mesh

    ang_grow, ang_merge = _edge_costs(work)
    graph = _face_graph(work, ang_grow)
    n_comp, comp_labels = connected_components(graph, directed=False)
    logger.info("%d faces, %d connected components", len(work.faces), n_comp)

    seeds = _pick_seeds(work, comp_labels, n_patches)
    patch_of_face = _grow_patches(graph, seeds, work)
    patch_of_face = _majority_smooth(work, patch_of_face)

    thickness = _face_thickness(work)
    merges = _merge_sequence(work, patch_of_face, ang_merge, thickness, comp_labels)

    if work is not orig:
        labels = _map_to_original(orig, work, patch_of_face)
    else:
        labels = patch_of_face

    n_used = int(patch_of_face.max()) + 1
    return {
        "labels": labels,           # per original face, finest granularity
        "merges": merges,           # ordered [into, from, cost]
        "n_patches": n_used,
        "n_components": int(n_comp),
        "suggested_regions": suggest_cut(merges, n_used),
    }
