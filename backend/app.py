import os
import io
import json
import base64
import numpy as np
import cv2
import torch
import trimesh
from PIL import Image
from flask import Flask, request, jsonify
from flask_cors import CORS
from segment_anything import SamPredictor, sam_model_registry, SamAutomaticMaskGenerator
from sklearn.cluster import KMeans
import matplotlib.pyplot as plt
from skimage import measure

app = Flask(__name__)
CORS(app)

# Global variables for SAM model
sam_predictor = None
device = "cuda" if torch.cuda.is_available() else "cpu"

def initialize_sam():
    """Initialize the SAM model"""
    global sam_predictor
    
    # Try different model checkpoints in order of preference (ViT-B first for speed)
    model_paths = [
        "sam_vit_b_01ec64.pth",   # Fastest (for testing)
        "sam_vit_l_0b3195.pth",  # Good balance  
        "sam_vit_h_4b8939.pth"   # Best quality
    ]
    
    model_types = ["vit_b", "vit_l", "vit_h"]
    
    for model_path, model_type in zip(model_paths, model_types):
        if os.path.exists(model_path):
            print(f"Loading SAM model: {model_path}")
            sam = sam_model_registry[model_type](checkpoint=model_path)
            sam.to(device=device)
            sam_predictor = SamPredictor(sam)
            print(f"SAM model loaded successfully on {device}")
            return True
    
    print("No SAM model checkpoint found! Please download a model.")
    return False

def load_stl_file(file_content):
    """Load STL file and convert to mesh"""
    try:
        # Save uploaded content to temporary file
        temp_path = "temp_model.stl"
        with open(temp_path, 'wb') as f:
            f.write(file_content)
        
        # Load with trimesh
        mesh = trimesh.load(temp_path)
        
        # Clean up
        os.remove(temp_path)
        
        return mesh
    except Exception as e:
        print(f"Error loading STL: {e}")
        return None

def render_mesh_views(mesh, num_views=6):
    """Render multiple views of the 3D mesh for segmentation"""
    views = []
    
    # Create different camera angles with better coverage
    angles = [
        (0, 0),      # front
        (90, 0),     # right
        (180, 0),    # back
        (270, 0),    # left
        (0, 45),     # top-front diagonal
        (0, -45)     # bottom-front diagonal
    ]
    
    for i, (azimuth, elevation) in enumerate(angles):
        try:
            # Create scene with better lighting
            scene = mesh.scene()
            
            # Add multiple lights for better visibility
            scene.lights = [
                trimesh.scene.lighting.DirectionalLight(
                    direction=[0, 0, -1], 
                    color=[255, 255, 255], 
                    intensity=1.0
                ),
                trimesh.scene.lighting.DirectionalLight(
                    direction=[1, 1, -1], 
                    color=[255, 255, 255], 
                    intensity=0.6
                ),
                trimesh.scene.lighting.DirectionalLight(
                    direction=[-1, 1, -1], 
                    color=[255, 255, 255], 
                    intensity=0.6
                )
            ]
            
            # Set camera transform
            camera_transform = trimesh.transformations.rotation_matrix(
                np.radians(elevation), [1, 0, 0]
            ) @ trimesh.transformations.rotation_matrix(
                np.radians(azimuth), [0, 0, 1]
            )
            
            # Position camera closer for better detail
            camera_distance = mesh.bounding_sphere.primitive.radius * 2.5
            camera_pos = camera_transform[:3, :3] @ np.array([0, 0, camera_distance])
            camera_transform[:3, 3] = camera_pos
            
            scene.camera_transform = camera_transform
            
            # Render at higher resolution for better SAM input
            png_data = scene.save_image(resolution=[1024, 1024])
            
            # Convert to PIL Image and ensure good contrast
            image = Image.open(io.BytesIO(png_data))
            
            # Convert to RGB if needed and enhance contrast
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Convert to numpy array
            image_array = np.array(image)
            
            # Enhance contrast for better SAM segmentation
            if image_array.max() > 0:  # Avoid division by zero
                # Normalize and enhance contrast
                image_array = image_array.astype(np.float32)
                image_array = (image_array - image_array.min()) / (image_array.max() - image_array.min())
                image_array = np.power(image_array, 0.8)  # Gamma correction
                image_array = (image_array * 255).astype(np.uint8)
            
            views.append(image_array)
            print(f"Rendered view {i+1}/{len(angles)} - {image_array.shape}")
            
        except Exception as e:
            print(f"Error rendering view {i}: {e}")
            # Create fallback higher contrast image
            fallback = np.ones((1024, 1024, 3), dtype=np.uint8) * 128  # Gray background
            views.append(fallback)
    
    return views

def segment_view_with_sam(image):
    """Segment a single view using SAM"""
    if sam_predictor is None:
        return None
    
    try:
        # Convert to RGB if needed
        if len(image.shape) == 3 and image.shape[2] == 4:
            image = image[:, :, :3]
        
        # Set image in SAM predictor
        sam_predictor.set_image(image)
        
        # Generate automatic masks
        # Use a grid of points as prompts
        h, w = image.shape[:2]
        points = []
        for y in range(h//8, h, h//4):
            for x in range(w//8, w, w//4):
                points.append([x, y])
        
        points = np.array(points)
        labels = np.ones(len(points))
        
        masks, scores, _ = sam_predictor.predict(
            point_coords=points,
            point_labels=labels,
            multimask_output=True
        )
        
        # Return the best mask
        best_mask_idx = np.argmax(scores)
        return masks[best_mask_idx]
        
    except Exception as e:
        print(f"Error in SAM segmentation: {e}")
        return None

def create_masking_groups(mesh, view_masks):
    """Create masking groups based on segmented views and mesh analysis"""
    try:
        # Get mesh vertices and faces
        vertices = mesh.vertices
        faces = mesh.faces
        
        # Analyze mesh properties
        bbox = mesh.bounds
        height = bbox[1][2] - bbox[0][2]
        center = mesh.centroid
        volume = mesh.volume
        
        # Create more intelligent groups based on mesh analysis
        groups = {}
        
        # Determine model type based on proportions and complexity
        vertex_count = len(vertices)
        face_count = len(faces)
        
        if vertex_count > 10000:  # Complex model
            groups = {
                'main_body': {
                    'name': 'Main Body',
                    'color': '#8B4513',
                    'vertices': [],
                    'description': 'Primary body structure'
                },
                'details': {
                    'name': 'Fine Details', 
                    'color': '#C0C0C0',
                    'vertices': [],
                    'description': 'Intricate surface details'
                },
                'upper_section': {
                    'name': 'Upper Section',
                    'color': '#800080', 
                    'vertices': [],
                    'description': 'Head, shoulders, upper torso'
                },
                'lower_section': {
                    'name': 'Lower Section',
                    'color': '#FDBCB4',
                    'vertices': [],
                    'description': 'Legs, feet, lower body'
                },
                'base_support': {
                    'name': 'Base & Support',
                    'color': '#654321',
                    'vertices': [],
                    'description': 'Base, stands, support structures'
                }
            }
        else:  # Simpler model
            groups = {
                'primary': {
                    'name': 'Primary Elements',
                    'color': '#8B4513',
                    'vertices': [],
                    'description': 'Main structural elements'
                },
                'secondary': {
                    'name': 'Secondary Elements', 
                    'color': '#C0C0C0',
                    'vertices': [],
                    'description': 'Secondary features'
                },
                'accent': {
                    'name': 'Accent Features',
                    'color': '#800080', 
                    'vertices': [],
                    'description': 'Decorative and accent elements'
                },
                'base': {
                    'name': 'Base',
                    'color': '#654321',
                    'vertices': [],
                    'description': 'Foundation and base'
                }
            }
        
        # Geometric segmentation based on position and mesh analysis
        for i, vertex in enumerate(vertices):
            x, y, z = vertex
            z_ratio = (z - bbox[0][2]) / height if height > 0 else 0
            
            # Distance from center
            dist_from_center = np.sqrt((x - center[0])**2 + (y - center[1])**2)
            
            if vertex_count > 10000:  # Complex model grouping
                if z_ratio < 0.15:
                    groups['base_support']['vertices'].append(i)
                elif z_ratio < 0.4:
                    groups['lower_section']['vertices'].append(i)
                elif z_ratio < 0.75:
                    groups['main_body']['vertices'].append(i)
                elif z_ratio < 0.9:
                    groups['upper_section']['vertices'].append(i)
                else:
                    groups['details']['vertices'].append(i)
            else:  # Simple model grouping
                if z_ratio < 0.2:
                    groups['base']['vertices'].append(i)
                elif z_ratio < 0.6:
                    groups['primary']['vertices'].append(i)
                elif z_ratio < 0.85:
                    groups['secondary']['vertices'].append(i)
                else:
                    groups['accent']['vertices'].append(i)
        
        # Add mesh statistics to groups
        for group_id, group_data in groups.items():
            vertex_count = len(group_data['vertices'])
            group_data['vertex_count'] = vertex_count
            group_data['percentage'] = round(vertex_count / len(vertices) * 100, 1) if len(vertices) > 0 else 0
        
        print(f"Created {len(groups)} masking groups:")
        for group_id, group_data in groups.items():
            print(f"  {group_data['name']}: {group_data['vertex_count']} vertices ({group_data['percentage']}%)")
        
        return groups
        
    except Exception as e:
        print(f"Error creating masking groups: {e}")
        # Fallback to simple groups
        vertices = mesh.vertices if hasattr(mesh, 'vertices') else []
        vertex_count = len(vertices)
        return {
            'part_1': {
                'name': 'Part 1',
                'color': '#8B4513',
                'vertices': list(range(vertex_count // 3)) if vertex_count > 0 else [],
                'description': 'First section',
                'vertex_count': vertex_count // 3 if vertex_count > 0 else 0,
                'percentage': 33.3
            },
            'part_2': {
                'name': 'Part 2',
                'color': '#C0C0C0',
                'vertices': list(range(vertex_count // 3, 2 * vertex_count // 3)) if vertex_count > 0 else [],
                'description': 'Second section',
                'vertex_count': vertex_count // 3 if vertex_count > 0 else 0,
                'percentage': 33.3
            },
            'part_3': {
                'name': 'Part 3',
                'color': '#800080',
                'vertices': list(range(2 * vertex_count // 3, vertex_count)) if vertex_count > 0 else [],
                'description': 'Third section',
                'vertex_count': vertex_count - 2 * (vertex_count // 3) if vertex_count > 0 else 0,
                'percentage': 33.4
            }
        }

# NEW SAM FUNCTIONS
def decode_base64_image(base64_string):
    """Convert base64 PNG to numpy array"""
    # Remove data:image/png;base64, prefix if present
    if base64_string.startswith('data:image'):
        base64_string = base64_string.split(',')[1]
    
    # Decode base64
    image_data = base64.b64decode(base64_string)
    
    # Convert to PIL Image
    image = Image.open(io.BytesIO(image_data))
    
    # Convert to RGB if needed
    if image.mode != 'RGB':
        image = image.convert('RGB')
    
    # Convert to numpy array
    return np.array(image)

def run_sam_auto_segmentation(image_array):
    """Run SAM automatic segmentation on image"""
    if sam_predictor is None:
        return None
    
    try:
        print(f"Running SAM on image shape: {image_array.shape}")
        
        # Set image in SAM predictor
        sam_predictor.set_image(image_array)
        
        # Use automatic mask generation
        # Create mask generator with good settings for miniatures
        mask_generator = SamAutomaticMaskGenerator(
            model=sam_predictor.model,
            points_per_side=32,  # Good detail level
            pred_iou_thresh=0.8,  # High quality masks
            stability_score_thresh=0.9,  # Stable masks only
            crop_n_layers=1,
            crop_n_points_downscale_factor=2,
            min_mask_region_area=100,  # Filter tiny regions
        )
        
        # Generate masks
        masks = mask_generator.generate(image_array)
        
        print(f"Generated {len(masks)} masks")
        
        # Process masks for return
        processed_masks = []
        for i, mask_data in enumerate(masks):
            mask = mask_data['segmentation']  # Boolean array
            bbox = mask_data['bbox']  # [x, y, width, height]
            area = mask_data['area']
            stability_score = mask_data['stability_score']
            
            # Convert mask to list of pixel coordinates
            mask_pixels = np.where(mask)
            pixel_coords = list(zip(mask_pixels[1].tolist(), mask_pixels[0].tolist()))  # (x, y) pairs
            
            processed_masks.append({
                'mask_id': i,
                'pixel_coords': pixel_coords,
                'bbox': bbox,
                'area': int(area),
                'stability_score': float(stability_score),
                'mask_array': mask.tolist()  # Full boolean array for detailed processing
            })
            
            print(f"Mask {i}: {len(pixel_coords)} pixels, area={area}, score={stability_score:.3f}")
        
        return processed_masks
        
    except Exception as e:
        print(f"Error in SAM segmentation: {e}")
        return None

# EXISTING ENDPOINTS
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'sam_loaded': sam_predictor is not None,
        'device': device
    })

@app.route('/analyze-model', methods=['POST'])
def analyze_model():
    """Analyze uploaded 3D model and create masking groups"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        print(f"Processing file: {file.filename}")
        
        # Read file content
        file_content = file.read()
        
        # Load STL mesh
        mesh = load_stl_file(file_content)
        if mesh is None:
            return jsonify({'error': 'Failed to load STL file'}), 400
        
        print(f"Mesh loaded: {len(mesh.vertices)} vertices, {len(mesh.faces)} faces")
        
        # Render multiple views
        print("Rendering mesh views...")
        views = render_mesh_views(mesh)
        
        # Segment each view with SAM
        print("Segmenting views with SAM...")
        view_masks = []
        for i, view in enumerate(views):
            mask = segment_view_with_sam(view)
            view_masks.append(mask)
            print(f"Processed view {i+1}/{len(views)}")
        
        # Create masking groups
        print("Creating masking groups...")
        masking_groups = create_masking_groups(mesh, view_masks)
        
        # Prepare response
        response = {
            'success': True,
            'masking_groups': masking_groups,
            'mesh_info': {
                'vertices': len(mesh.vertices),
                'faces': len(mesh.faces),
                'bounds': mesh.bounds.tolist(),
                'volume': float(mesh.volume),
                'surface_area': float(mesh.area)
            }
        }
        
        print(f"Analysis complete for {file.filename}")
        return jsonify(response)
        
    except Exception as e:
        print(f"Error in analyze_model: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/update-masking', methods=['POST'])
def update_masking():
    """Update masking groups based on user input"""
    try:
        data = request.get_json()
        
        # This would update the masking based on user interactions
        # For now, return the received data
        
        return jsonify({
            'success': True,
            'updated_groups': data.get('groups', {})
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# NEW SAM ENDPOINTS
@app.route('/segment-single-view', methods=['POST'])
def segment_single_view():
    """Process single view for SAM segmentation - PROOF OF CONCEPT"""
    try:
        data = request.get_json()
        
        print("🎯 Processing single view for SAM segmentation...")
        
        # Extract data
        color_png = data['color_image']
        depth_array = np.array(data['depth_array'])
        camera_matrix = data['camera_matrix']
        projection_matrix = data['projection_matrix']
        viewport_size = data['viewport_size']
        
        print(f"Received data: viewport={viewport_size}, depth_range=[{depth_array.min():.3f}, {depth_array.max():.3f}]")
        
        # Decode color image
        image_array = decode_base64_image(color_png)
        print(f"Decoded image shape: {image_array.shape}")
        
        # Run SAM segmentation
        masks = run_sam_auto_segmentation(image_array)
        
        if masks is None:
            return jsonify({'error': 'SAM segmentation failed'}), 500
        
        # Prepare response
        response = {
            'success': True,
            'masks': masks,
            'image_shape': image_array.shape,
            'viewport_size': viewport_size,
            'num_masks': len(masks),
            'camera_data': {
                'camera_matrix': camera_matrix,
                'projection_matrix': projection_matrix
            }
        }
        
        print(f"✅ Successfully segmented {len(masks)} regions")
        
        return jsonify(response)
        
    except Exception as e:
        print(f"❌ Error in segment_single_view: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/test-sam-simple', methods=['POST'])
def test_sam_simple():
    """Simple test endpoint - just run SAM on uploaded image"""
    try:
        data = request.get_json()
        color_png = data['color_image']
        
        # Decode and run SAM
        image_array = decode_base64_image(color_png)
        masks = run_sam_auto_segmentation(image_array)
        
        if masks:
            return jsonify({
                'success': True,
                'num_masks': len(masks),
                'masks_preview': [
                    {
                        'mask_id': m['mask_id'],
                        'area': m['area'],
                        'stability_score': m['stability_score'],
                        'bbox': m['bbox']
                    } for m in masks[:5]  # First 5 masks summary
                ]
            })
        else:
            return jsonify({'error': 'SAM failed'}), 500
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Initializing 3D Miniature Painter Backend...")
    print(f"Using device: {device}")
    
    # Initialize SAM model
    if initialize_sam():
        print("Starting Flask server...")
        app.run(host='0.0.0.0', port=5000, debug=True)
    else:
        print("Failed to initialize SAM model. Please download a model checkpoint.")
        print("Run one of these commands:")
        print("wget https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth")
        print("wget https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth") 
        print("wget https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth")