"""Flask API for the mini painter segmentation backend."""

import base64
import io
import logging
import time

import numpy as np
import trimesh
from flask import Flask, jsonify, request
from flask_cors import CORS

import segmenter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

MAX_UPLOAD_MB = 200
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024


def load_stl(data: bytes) -> trimesh.Trimesh:
    """Load an STL preserving file triangle order, then merge duplicate
    vertices so face adjacency exists.  The client indexes triangles in file
    order, so face order must never change here."""
    mesh = trimesh.load(io.BytesIO(data), file_type="stl", process=False)
    if isinstance(mesh, trimesh.Scene):
        mesh = mesh.to_mesh()
    mesh.merge_vertices()
    return mesh


def encode_labels(labels: np.ndarray) -> dict:
    if labels.max() < 2**16:
        arr = labels.astype("<u2")
        dtype = "u16"
    else:
        arr = labels.astype("<u4")
        dtype = "u32"
    return {
        "dtype": dtype,
        "count": int(len(labels)),
        "b64": base64.b64encode(arr.tobytes()).decode("ascii"),
    }


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "mini-painter-segmentation"})


@app.post("/api/segment")
def segment_route():
    file = request.files.get("file")
    if file is None:
        return jsonify({"error": "upload a file under the 'file' field"}), 400
    name = (file.filename or "model").lower()
    if not name.endswith(".stl"):
        return jsonify({"error": "only STL files are supported right now"}), 400

    data = file.read()
    t0 = time.time()
    try:
        mesh = load_stl(data)
    except Exception as exc:
        logger.exception("failed to load mesh")
        return jsonify({"error": f"could not read STL: {exc}"}), 400

    try:
        detail = int(request.form.get("patches", segmenter.DEFAULT_PATCHES))
        result = segmenter.segment(mesh, n_patches=detail)
    except Exception as exc:
        logger.exception("segmentation failed")
        return jsonify({"error": f"segmentation failed: {exc}"}), 500

    elapsed = time.time() - t0
    logger.info(
        "segmented %s: %d faces -> %d patches in %.2fs",
        name, len(mesh.faces), result["n_patches"], elapsed,
    )
    return jsonify({
        "labels": encode_labels(result["labels"]),
        "merges": result["merges"],
        "nPatches": result["n_patches"],
        "nComponents": result["n_components"],
        "suggestedRegions": result["suggested_regions"],
        "faces": int(len(mesh.faces)),
        "elapsedSeconds": round(elapsed, 2),
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
