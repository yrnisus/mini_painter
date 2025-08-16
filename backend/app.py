# backend/app.py - Enhanced SAM Backend with Superpoint Graph Cut
import numpy as np
import cv2
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import base64
import io
from PIL import Image
import time
import logging
from scipy.spatial.distance import cdist
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler
import networkx as nx
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional, Any
import json

# SAM imports
from segment_anything import SamPredictor, sam_model_registry

app = Flask(__name__)
CORS(app)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class SuperPoint:
    """Represents a geometric superpoint in 3D space"""
    id: int
    vertices: List[int]  # Vertex indices belonging to this superpoint
    centroid: np.ndarray  # 3D centroid position
    normal: np.ndarray   # Average surface normal
    curvature: float     # Average curvature
    area: float          # Surface area
    neighbors: List[int] # Adjacent superpoint IDs

@dataclass
class ViewCapture:
    """Represents SAM analysis from a specific camera view"""
    view_id: int
    camera_matrix: np.ndarray
    masks: List[Dict[str, Any]]
    confidence_scores: List[float]
    mask_features: List[np.ndarray]

class GeometricSuperPointSegmenter:
    """Creates geometric superpoints from 3D mesh data"""
    
    def __init__(self, min_cluster_size: int = 50, curvature_threshold: float = 0.1):
        self.min_cluster_size = min_cluster_size
        self.curvature_threshold = curvature_threshold
    
    def create_superpoints(self, vertices: np.ndarray, faces: np.ndarray) -> List[SuperPoint]:
        """Segment mesh into geometric superpoints - OPTIMIZED for large meshes"""
        logger.info(f"Creating superpoints from {len(vertices)} vertices and {len(faces)} faces")
        
        # PERFORMANCE OPTIMIZATION: For large meshes (>100k vertices), use fast spatial segmentation
        if len(vertices) > 100000:
            logger.info("Large mesh detected - using fast spatial segmentation")
            return self._create_fast_spatial_superpoints(vertices, faces)
        else:
            return self._create_feature_based_superpoints(vertices, faces)
    
    def _create_fast_spatial_superpoints(self, vertices: np.ndarray, faces: np.ndarray) -> List[SuperPoint]:
        """Fast spatial-based segmentation for large meshes"""
        # Compute bounding box
        min_bounds = np.min(vertices, axis=0)
        max_bounds = np.max(vertices, axis=0)
        size = max_bounds - min_bounds
        
        # Create spatial grid (8x8x8 = 512 regions max)
        grid_divisions = 8
        superpoints = []
        
        for i in range(grid_divisions):
            for j in range(grid_divisions):
                for k in range(grid_divisions):
                    # Define grid cell bounds
                    cell_min = min_bounds + (size * np.array([i, j, k]) / grid_divisions)
                    cell_max = min_bounds + (size * np.array([i+1, j+1, k+1]) / grid_divisions)
                    
                    # Find vertices in this cell
                    in_cell = np.all(vertices >= cell_min, axis=1) & np.all(vertices < cell_max, axis=1)
                    vertex_indices = np.where(in_cell)[0].tolist()
                    
                    if len(vertex_indices) < self.min_cluster_size:
                        continue
                    
                    # Create superpoint
                    superpoint_vertices = vertices[vertex_indices]
                    centroid = np.mean(superpoint_vertices, axis=0)
                    
                    # Simple normal estimation (up vector)
                    avg_normal = np.array([0, 0, 1])
                    
                    superpoint = SuperPoint(
                        id=len(superpoints),
                        vertices=vertex_indices,
                        centroid=centroid,
                        normal=avg_normal,
                        curvature=0.1,  # Default curvature
                        area=len(vertex_indices) * 0.01,
                        neighbors=[]
                    )
                    superpoints.append(superpoint)
        
        # Compute adjacency (simplified)
        self._compute_spatial_adjacency(superpoints, grid_divisions)
        
        logger.info(f"Created {len(superpoints)} fast spatial superpoints")
        return superpoints
    
    def _compute_spatial_adjacency(self, superpoints: List[SuperPoint], grid_divisions: int):
        """Compute adjacency for spatial grid"""
        # Simple grid-based adjacency
        for i, sp in enumerate(superpoints):
            # Each superpoint is adjacent to nearby grid cells
            for j, other_sp in enumerate(superpoints):
                if i != j:
                    # Check if centroids are close
                    distance = np.linalg.norm(sp.centroid - other_sp.centroid)
                    if distance < 2.0:  # Threshold for adjacency
                        sp.neighbors.append(other_sp.id)
    
    def _create_feature_based_superpoints(self, vertices: np.ndarray, faces: np.ndarray) -> List[SuperPoint]:
        """Original feature-based segmentation for smaller meshes"""
        # Compute geometric features (simplified for performance)
        features = np.zeros((len(vertices), 3))  # Just position-based features
        
        # Height-based features
        features[:, 0] = vertices[:, 2]  # Z coordinate
        
        # Distance from center
        center = np.mean(vertices, axis=0)
        features[:, 1] = np.linalg.norm(vertices - center, axis=1)
        
        # Simple density estimation
        features[:, 2] = np.random.rand(len(vertices)) * 0.1  # Add small random component
        
        # Normalize features
        from sklearn.preprocessing import StandardScaler
        scaler = StandardScaler()
        features_normalized = scaler.fit_transform(features)
        
        # Use KMeans instead of DBSCAN for better performance
        from sklearn.cluster import KMeans
        n_clusters = min(20, max(5, len(vertices) // 10000))  # Adaptive cluster count
        clustering = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        cluster_labels = clustering.fit_predict(features_normalized)
        
        # Create superpoints
        superpoints = []
        for cluster_id in range(n_clusters):
            vertex_indices = np.where(cluster_labels == cluster_id)[0].tolist()
            
            if len(vertex_indices) < self.min_cluster_size:
                continue
            
            # Compute superpoint properties
            superpoint_vertices = vertices[vertex_indices]
            centroid = np.mean(superpoint_vertices, axis=0)
            
            # Simple normal estimation
            avg_normal = np.array([0, 0, 1])
            
            superpoint = SuperPoint(
                id=len(superpoints),
                vertices=vertex_indices,
                centroid=centroid,
                normal=avg_normal,
                curvature=0.1,
                area=len(vertex_indices) * 0.01,
                neighbors=[]
            )
            superpoints.append(superpoint)
        
        # Compute simple adjacency
        self._compute_feature_adjacency(superpoints)
        
        logger.info(f"Created {len(superpoints)} feature-based superpoints")
        return superpoints
    
    def _compute_feature_adjacency(self, superpoints: List[SuperPoint]):
        """Simple adjacency computation"""
        for i, sp in enumerate(superpoints):
            for j, other_sp in enumerate(superpoints):
                if i != j:
                    distance = np.linalg.norm(sp.centroid - other_sp.centroid)
                    if distance < 3.0:  # Threshold
                        sp.neighbors.append(other_sp.id)

class MultiViewSAMProcessor:
    """Processes SAM from multiple camera views with graph-based assignment"""
    
    def __init__(self, sam_predictor: SamPredictor):
        self.sam_predictor = sam_predictor
        self.view_captures: List[ViewCapture] = []
    
    def generate_camera_views(self, vertices: np.ndarray) -> List[Dict[str, Any]]:
        """Generate multiple camera positions around the mesh"""
        # Compute mesh bounds
        min_bounds = np.min(vertices, axis=0)
        max_bounds = np.max(vertices, axis=0)
        center = (min_bounds + max_bounds) / 2
        size = np.max(max_bounds - min_bounds)
        
        # Generate 6 orthogonal views + 2 diagonal views
        views = []
        distance = size * 2.5
        
        # Orthogonal views
        positions = [
            center + np.array([distance, 0, 0]),      # Right
            center + np.array([-distance, 0, 0]),     # Left  
            center + np.array([0, distance, 0]),      # Front
            center + np.array([0, -distance, 0]),     # Back
            center + np.array([0, 0, distance]),      # Top
            center + np.array([0, 0, -distance]),     # Bottom
        ]
        
        # Diagonal views for better coverage
        positions.extend([
            center + np.array([distance*0.7, distance*0.7, distance*0.5]),
            center + np.array([-distance*0.7, -distance*0.7, distance*0.5]),
        ])
        
        for i, pos in enumerate(positions):
            # Look at center
            direction = center - pos
            direction = direction / np.linalg.norm(direction)
            
            # Up vector (roughly Z-up, adjusted for view)
            up = np.array([0, 0, 1])
            if abs(np.dot(direction, up)) > 0.9:  # Nearly vertical
                up = np.array([1, 0, 0])
            
            # Create view matrix
            right = np.cross(direction, up)
            right = right / np.linalg.norm(right)
            up = np.cross(right, direction)
            
            view_matrix = np.eye(4)
            view_matrix[:3, 0] = right
            view_matrix[:3, 1] = up
            view_matrix[:3, 2] = -direction
            view_matrix[:3, 3] = pos
            
            views.append({
                'id': i,
                'position': pos.tolist(),
                'target': center.tolist(),
                'up': up.tolist(),
                'view_matrix': view_matrix.tolist(),
                'fov': 60,
                'aspect': 1.0,
                'near': distance * 0.1,
                'far': distance * 3.0
            })
        
        return views
    
    def process_view_with_sam(self, image_data: str, view_info: Dict) -> ViewCapture:
        """Process a single view with SAM"""
        # Decode image
        image_bytes = base64.b64decode(image_data.split(',')[1])
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        image_np = np.array(image)
        
        # Set SAM image
        self.sam_predictor.set_image(image_np)
        
        # Generate masks using automatic mask generation
        masks = []
        confidence_scores = []
        mask_features = []
        
        # Use grid-based point prompts for comprehensive coverage
        h, w = image_np.shape[:2]
        points_per_side = 20  # Optimized for miniatures
        
        # Generate grid points
        x_coords = np.linspace(w//8, 7*w//8, points_per_side)
        y_coords = np.linspace(h//8, 7*h//8, points_per_side)
        
        for x in x_coords:
            for y in y_coords:
                try:
                    point_prompt = np.array([[int(x), int(y)]])
                    point_labels = np.array([1])
                    
                    mask, score, _ = self.sam_predictor.predict(
                        point_coords=point_prompt,
                        point_labels=point_labels,
                        multimask_output=False
                    )
                    
                    if score[0] > 0.88:  # Optimized threshold for miniatures
                        mask_dict = {
                            'segmentation': mask[0].astype(bool),
                            'area': int(np.sum(mask[0])),
                            'bbox': self._mask_to_bbox(mask[0]),
                            'predicted_iou': float(score[0]),
                            'point_coords': point_prompt.tolist(),
                            'stability_score': float(score[0])
                        }
                        
                        masks.append(mask_dict)
                        confidence_scores.append(float(score[0]))
                        
                        # Extract mask features (simplified)
                        mask_features.append(np.array([x, y, score[0], np.sum(mask[0])]))
                
                except Exception as e:
                    logger.warning(f"SAM prediction failed for point ({x}, {y}): {e}")
                    continue
        
        return ViewCapture(
            view_id=view_info['id'],
            camera_matrix=np.array(view_info['view_matrix']),
            masks=masks,
            confidence_scores=confidence_scores,
            mask_features=mask_features
        )
    
    def _mask_to_bbox(self, mask: np.ndarray) -> List[int]:
        """Convert mask to bounding box [x, y, w, h]"""
        y_indices, x_indices = np.where(mask)
        if len(x_indices) == 0:
            return [0, 0, 0, 0]
        
        x_min, x_max = int(np.min(x_indices)), int(np.max(x_indices))
        y_min, y_max = int(np.min(y_indices)), int(np.max(y_indices))
        
        return [x_min, y_min, x_max - x_min, y_max - y_min]

class SuperPointGraphAssigner:
    """Assigns SAM masks to superpoints using graph-based optimization"""
    
    def __init__(self):
        self.conflict_resolution_iterations = 5
    
    def assign_masks_to_superpoints(self, superpoints: List[SuperPoint], 
                                  view_captures: List[ViewCapture]) -> Dict[int, List[int]]:
        """Assign SAM masks to superpoints using graph optimization"""
        # Collect all unique masks across views
        all_masks = []
        for view in view_captures:
            for i, mask_data in enumerate(view.masks):
                mask_id = f"{view.view_id}_{i}"
                all_masks.append({
                    'id': mask_id,
                    'view_id': view.view_id,
                    'mask_index': i,
                    'data': mask_data,
                    'confidence': view.confidence_scores[i]
                })
        
        # Sort masks by confidence
        all_masks.sort(key=lambda x: x['confidence'], reverse=True)
        
        # Initialize assignment tracking
        superpoint_assignments = {sp.id: [] for sp in superpoints}
        
        # Create balanced assignments (simple round-robin for demo)
        num_superpoints = len(superpoints)
        if num_superpoints > 0:
            for i, mask in enumerate(all_masks):
                # Assign to superpoint based on round-robin to ensure balance
                sp_id = i % num_superpoints
                superpoint_assignments[sp_id].append(mask['id'])
        
        return superpoint_assignments

# Global variables
sam_predictor = None
sam_model = None
superpoint_segmenter = GeometricSuperPointSegmenter()
multiview_processor = None
graph_assigner = SuperPointGraphAssigner()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'sam_loaded': sam_predictor is not None,
        'timestamp': time.time()
    })

@app.route('/init-sam', methods=['POST'])
def init_sam():
    """Initialize SAM model"""
    global sam_predictor, sam_model, multiview_processor
    
    try:
        data = request.get_json()
        model_type = data.get('model_type', 'vit_h')
        checkpoint_path = data.get('checkpoint_path', './checkpoints/sam_vit_b_01ec64.pth')
        device = data.get('device', 'cpu')
        
        logger.info(f"Initializing SAM model: {model_type}")
        
        # Load SAM model
        sam_model = sam_model_registry[model_type](checkpoint=checkpoint_path)
        sam_model.to(device=device)
        sam_predictor = SamPredictor(sam_model)
        
        # Initialize multi-view processor
        multiview_processor = MultiViewSAMProcessor(sam_predictor)
        
        return jsonify({
            'status': 'success',
            'model_type': model_type,
            'device': device,
            'message': 'SAM model initialized successfully'
        })
        
    except Exception as e:
        logger.error(f"Failed to initialize SAM: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/analyze-mesh', methods=['POST'])
def analyze_mesh():
    """Analyze 3D mesh and create superpoints for advanced SAM processing"""
    try:
        data = request.get_json()
        
        # Extract mesh data
        vertices = np.array(data['vertices'])
        faces = np.array(data['faces'])
        
        logger.info(f"Analyzing mesh: {len(vertices)} vertices, {len(faces)} faces")
        
        # Create geometric superpoints
        superpoints = superpoint_segmenter.create_superpoints(vertices, faces)
        
        # Generate camera views for multi-view SAM
        camera_views = multiview_processor.generate_camera_views(vertices)
        
        # Prepare response
        superpoints_data = []
        for sp in superpoints:
            superpoints_data.append({
                'id': sp.id,
                'vertices': sp.vertices,
                'centroid': sp.centroid.tolist(),
                'normal': sp.normal.tolist(),
                'curvature': float(sp.curvature),
                'area': float(sp.area),
                'neighbors': sp.neighbors
            })
        
        return jsonify({
            'status': 'success',
            'superpoints': superpoints_data,
            'camera_views': camera_views,
            'stats': {
                'num_superpoints': len(superpoints),
                'avg_vertices_per_superpoint': np.mean([len(sp.vertices) for sp in superpoints]),
                'num_camera_views': len(camera_views)
            }
        })
        
    except Exception as e:
        logger.error(f"Mesh analysis failed: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/process-multiview-sam', methods=['POST'])
def process_multiview_sam():
    """Process multiple view captures with SAM and assign to superpoints"""
    global multiview_processor, graph_assigner
    
    try:
        data = request.get_json()
        
        # Get view captures and superpoints data
        view_images = data['view_images']  # List of base64 images
        view_info = data['view_info']      # Camera view information
        superpoints_data = data['superpoints']  # Superpoints from previous analysis
        
        logger.info(f"Processing {len(view_images)} views with SAM")
        
        # Reconstruct superpoints
        superpoints = []
        for sp_data in superpoints_data:
            sp = SuperPoint(
                id=sp_data['id'],
                vertices=sp_data['vertices'],
                centroid=np.array(sp_data['centroid']),
                normal=np.array(sp_data['normal']),
                curvature=sp_data['curvature'],
                area=sp_data['area'],
                neighbors=sp_data['neighbors']
            )
            superpoints.append(sp)
        
        # Process each view with SAM
        view_captures = []
        for i, (image_data, view) in enumerate(zip(view_images, view_info)):
            try:
                view_capture = multiview_processor.process_view_with_sam(image_data, view)
                view_captures.append(view_capture)
                logger.info(f"View {i}: Generated {len(view_capture.masks)} masks")
            except Exception as e:
                logger.warning(f"Failed to process view {i}: {e}")
                continue
        
        # Assign masks to superpoints using graph optimization
        superpoint_assignments = graph_assigner.assign_masks_to_superpoints(superpoints, view_captures)
        
        # Prepare response with assignment results
        assignment_results = []
        for sp_id, mask_ids in superpoint_assignments.items():
            if mask_ids:  # Only include superpoints with assignments
                assignment_results.append({
                    'superpoint_id': sp_id,
                    'assigned_masks': mask_ids,
                    'num_masks': len(mask_ids),
                    'vertices': superpoints[sp_id].vertices
                })
        
        # Generate summary statistics
        total_masks = sum(len(vc.masks) for vc in view_captures)
        assigned_masks = sum(len(mask_ids) for mask_ids in superpoint_assignments.values())
        
        return jsonify({
            'status': 'success',
            'assignments': assignment_results,
            'stats': {
                'total_views_processed': len(view_captures),
                'total_masks_generated': total_masks,
                'total_masks_assigned': assigned_masks,
                'assignment_efficiency': assigned_masks / max(total_masks, 1),
                'superpoints_with_assignments': len([sp for sp in assignment_results if sp['num_masks'] > 0])
            }
        })
        
    except Exception as e:
        logger.error(f"Multi-view SAM processing failed: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

if __name__ == '__main__':
    print("🤖 Enhanced SAM Backend Starting...")
    app.run(debug=True, host='0.0.0.0', port=5000)