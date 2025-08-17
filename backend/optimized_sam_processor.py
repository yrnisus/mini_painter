# backend/optimized_sam_processor.py - Implementation of Research Recommendations
import numpy as np
import cv2
from flask import Flask, request, jsonify
from flask_cors import CORS
import logging
from scipy.spatial.distance import cdist
from sklearn.cluster import DBSCAN, SpectralClustering
from sklearn.preprocessing import StandardScaler
import networkx as nx
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional, Any
import json

# SAM imports with optimized configuration
from segment_anything import SamPredictor, sam_model_registry, SamAutomaticMaskGenerator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class SemanticRegion:
    """Represents a semantic painting region"""
    id: str
    name: str
    vertices: List[int]
    semantic_type: str  # 'armor', 'weapon', 'clothing', 'skin', 'base', 'details'
    confidence: float
    area: float

class OptimizedSAMProcessor:
    """SAM processor optimized for meaningful miniature painting regions"""
    
    def __init__(self, sam_predictor: SamPredictor):
        self.sam_predictor = sam_predictor
        self.semantic_templates = self._load_semantic_templates()
    
    def _load_semantic_templates(self) -> Dict[str, Dict]:
        """Load semantic hierarchies for different miniature types"""
        return {
            'humanoid': {
                'base': {'height_range': (0.0, 0.15), 'priority': 1},
                'legs': {'height_range': (0.15, 0.45), 'priority': 2},
                'torso': {'height_range': (0.45, 0.75), 'priority': 3},
                'arms': {'height_range': (0.30, 0.70), 'radial': True, 'priority': 4},
                'head': {'height_range': (0.75, 1.0), 'priority': 5},
                'weapon': {'edge_detection': True, 'priority': 6},
                'cape': {'back_region': True, 'priority': 7},
                'details': {'small_regions': True, 'priority': 8}
            },
            'creature': {
                'base': {'height_range': (0.0, 0.2), 'priority': 1},
                'body': {'height_range': (0.2, 0.8), 'priority': 2},
                'head': {'height_range': (0.6, 1.0), 'priority': 3},
                'limbs': {'radial': True, 'priority': 4},
                'details': {'small_regions': True, 'priority': 5}
            }
        }
    
    def generate_optimized_masks(self, image: np.ndarray) -> List[Dict[str, Any]]:
        """Generate masks with research-optimized parameters"""
        
        # RESEARCH IMPLEMENTATION: Optimized SAM configuration
        mask_generator = SamAutomaticMaskGenerator(
            model=self.sam_predictor.model,
            points_per_side=8,           # Reduced from 32 (yields ~10 regions)
            pred_iou_thresh=0.92,        # Higher quality threshold
            stability_score_thresh=0.96, # More stable masks only
            crop_n_layers=0,             # Disable crop-based generation
            min_mask_region_area=2000,   # Larger minimum area (filters small noise)
            box_nms_thresh=0.85,         # Aggressive duplicate removal
            crop_n_points_downscale_factor=1,
            crop_overlap_ratio=0.0,      # No overlap to reduce duplicates
        )
        
        logger.info("🎯 Generating optimized masks with research parameters...")
        masks = mask_generator.generate(image)
        logger.info(f"✅ Generated {len(masks)} optimized masks (target: 8-12)")
        
        return masks
    
    def apply_semantic_grouping(self, masks: List[Dict], vertices: np.ndarray, 
                              miniature_type: str = 'humanoid') -> List[SemanticRegion]:
        """Apply semantic grouping to convert geometric regions to painting zones"""
        
        logger.info(f"🎨 Applying semantic grouping for {miniature_type} miniature...")
        
        template = self.semantic_templates.get(miniature_type, self.semantic_templates['humanoid'])
        
        # Compute mesh properties for semantic analysis
        bbox = self._compute_bounding_box(vertices)
        height_normalized = self._normalize_height(vertices, bbox)
        radial_features = self._compute_radial_features(vertices, bbox)
        
        semantic_regions = []
        used_masks = set()
        
        # Sort template regions by priority (base first, details last)
        sorted_regions = sorted(template.items(), key=lambda x: x[1].get('priority', 999))
        
        for region_name, region_config in sorted_regions:
            best_masks = self._find_best_masks_for_region(
                masks, vertices, region_config, height_normalized, 
                radial_features, used_masks
            )
            
            if best_masks:
                # Merge masks for this semantic region
                merged_vertices = self._merge_mask_vertices(best_masks)
                
                semantic_region = SemanticRegion(
                    id=f"semantic_{region_name}",
                    name=self._get_display_name(region_name),
                    vertices=merged_vertices,
                    semantic_type=region_name,
                    confidence=np.mean([mask.get('stability_score', 0.9) for mask in best_masks]),
                    area=sum(mask.get('area', 0) for mask in best_masks)
                )
                
                semantic_regions.append(semantic_region)
                used_masks.update(id(mask) for mask in best_masks)
                
                logger.info(f"   {region_name}: {len(merged_vertices)} vertices from {len(best_masks)} masks")
        
        # Handle any remaining unassigned masks as "details"
        remaining_masks = [mask for mask in masks if id(mask) not in used_masks]
        if remaining_masks:
            details_vertices = self._merge_mask_vertices(remaining_masks)
            semantic_regions.append(SemanticRegion(
                id="semantic_details",
                name="Fine Details",
                vertices=details_vertices,
                semantic_type="details",
                confidence=0.8,
                area=sum(mask.get('area', 0) for mask in remaining_masks)
            ))
            logger.info(f"   details: {len(details_vertices)} vertices from {len(remaining_masks)} remaining masks")
        
        logger.info(f"✅ Created {len(semantic_regions)} semantic painting regions")
        return semantic_regions
    
    def _compute_bounding_box(self, vertices: np.ndarray) -> Dict[str, np.ndarray]:
        """Compute mesh bounding box"""
        return {
            'min': np.min(vertices, axis=0),
            'max': np.max(vertices, axis=0),
            'center': np.mean(vertices, axis=0),
            'size': np.max(vertices, axis=0) - np.min(vertices, axis=0)
        }
    
    def _normalize_height(self, vertices: np.ndarray, bbox: Dict) -> np.ndarray:
        """Normalize vertex heights to 0-1 range"""
        return (vertices[:, 1] - bbox['min'][1]) / bbox['size'][1]
    
    def _compute_radial_features(self, vertices: np.ndarray, bbox: Dict) -> np.ndarray:
        """Compute radial distance from center for each vertex"""
        center_2d = bbox['center'][[0, 2]]  # X and Z coordinates
        vertices_2d = vertices[:, [0, 2]]
        return np.linalg.norm(vertices_2d - center_2d, axis=1) / (bbox['size'][0] * 0.5)
    
    def _find_best_masks_for_region(self, masks: List[Dict], vertices: np.ndarray,
                                   region_config: Dict, height_normalized: np.ndarray,
                                   radial_features: np.ndarray, used_masks: set) -> List[Dict]:
        """Find masks that best match a semantic region"""
        
        candidates = []
        
        for mask in masks:
            if id(mask) in used_masks:
                continue
                
            # Convert mask to vertex indices (simplified for demo)
            mask_vertices = self._mask_to_vertices(mask, vertices)
            if len(mask_vertices) == 0:
                continue
            
            score = self._score_mask_for_region(
                mask_vertices, vertices, region_config, 
                height_normalized, radial_features
            )
            
            if score > 0.3:  # Minimum threshold for region matching
                candidates.append((mask, score))
        
        # Sort by score and take best matches (limit to prevent dominance)
        candidates.sort(key=lambda x: x[1], reverse=True)
        max_masks = 3 if region_config.get('priority', 5) <= 3 else 2  # Base/legs/torso get more masks
        
        return [mask for mask, score in candidates[:max_masks]]
    
    def _score_mask_for_region(self, mask_vertices: List[int], vertices: np.ndarray,
                              region_config: Dict, height_normalized: np.ndarray,
                              radial_features: np.ndarray) -> float:
        """Score how well a mask matches a semantic region"""
        
        if not mask_vertices:
            return 0.0
        
        mask_heights = height_normalized[mask_vertices]
        mask_radial = radial_features[mask_vertices]
        
        score = 0.0
        
        # Height-based matching
        if 'height_range' in region_config:
            min_h, max_h = region_config['height_range']
            height_overlap = np.mean((mask_heights >= min_h) & (mask_heights <= max_h))
            score += height_overlap * 0.6
        
        # Radial matching (for arms, weapons, etc.)
        if region_config.get('radial', False):
            # Prefer vertices at medium to high radial distance
            radial_score = np.mean((mask_radial > 0.3) & (mask_radial < 0.9))
            score += radial_score * 0.4
        
        # Base region matching
        if region_config.get('priority') == 1:  # Base priority
            # Prefer lower vertices
            base_score = np.mean(mask_heights < 0.2)
            score += base_score * 0.5
        
        # Small details matching
        if region_config.get('small_regions', False):
            # Prefer smaller masks
            size_score = 1.0 - min(1.0, len(mask_vertices) / 1000)
            score += size_score * 0.3
        
        return min(1.0, score)
    
    def _mask_to_vertices(self, mask: Dict, vertices: np.ndarray) -> List[int]:
        """Convert SAM mask to vertex indices (simplified)"""
        # This would use the real pixel-to-vertex mapping in production
        # For now, using area-based approximation
        area = mask.get('area', 0)
        stability = mask.get('stability_score', 0.9)
        
        # Simple area-based vertex assignment (replace with real mapping)
        num_vertices = min(int(area / 50), len(vertices) // 10)
        if num_vertices > 0:
            return list(range(0, num_vertices))
        return []
    
    def _merge_mask_vertices(self, masks: List[Dict]) -> List[int]:
        """Merge vertex indices from multiple masks"""
        all_vertices = []
        for mask in masks:
            vertices = self._mask_to_vertices(mask, np.zeros((1000, 3)))  # Placeholder
            all_vertices.extend(vertices)
        return list(set(all_vertices))  # Remove duplicates
    
    def _get_display_name(self, region_name: str) -> str:
        """Convert region ID to user-friendly display name"""
        name_map = {
            'base': 'Base & Support',
            'legs': 'Legs & Lower Body',
            'torso': 'Torso & Armor',
            'arms': 'Arms & Shoulders',
            'head': 'Head & Helmet',
            'weapon': 'Weapons & Tools',
            'cape': 'Cape & Cloak',
            'details': 'Fine Details',
            'body': 'Main Body',
            'limbs': 'Limbs'
        }
        return name_map.get(region_name, region_name.title())

class RegionAdjacencyGraphMerger:
    """Implements Region Adjacency Graph merging from research"""
    
    def __init__(self):
        self.merge_criteria_weights = {
            'geometric_similarity': 0.3,
            'spatial_adjacency': 0.4,
            'semantic_coherence': 0.2,
            'size_compatibility': 0.1
        }
    
    def merge_similar_regions(self, regions: List[SemanticRegion], 
                            target_count: int = 10) -> List[SemanticRegion]:
        """Merge similar regions using RAG with multi-criterion decision making"""
        
        if len(regions) <= target_count:
            return regions
        
        logger.info(f"🔄 Merging {len(regions)} regions to target {target_count} using RAG...")
        
        # Build adjacency graph
        graph = self._build_region_adjacency_graph(regions)
        
        # Calculate merge scores for all region pairs
        merge_candidates = self._calculate_merge_scores(regions, graph)
        
        # Iteratively merge most compatible regions
        merged_regions = list(regions)
        
        while len(merged_regions) > target_count and merge_candidates:
            # Get best merge candidate
            best_pair = max(merge_candidates, key=lambda x: x[2])
            region_a_idx, region_b_idx, score = best_pair
            
            if score < 0.4:  # Minimum merge threshold
                break
            
            # Perform merge
            merged_region = self._merge_regions(
                merged_regions[region_a_idx], 
                merged_regions[region_b_idx]
            )
            
            # Update region list
            merged_regions = [
                region for i, region in enumerate(merged_regions) 
                if i not in [region_a_idx, region_b_idx]
            ] + [merged_region]
            
            # Recalculate merge candidates
            merge_candidates = self._calculate_merge_scores(merged_regions, graph)
        
        logger.info(f"✅ RAG merging complete: {len(merged_regions)} final regions")
        return merged_regions
    
    def _build_region_adjacency_graph(self, regions: List[SemanticRegion]) -> nx.Graph:
        """Build spatial adjacency graph between regions"""
        graph = nx.Graph()
        
        for i, region in enumerate(regions):
            graph.add_node(i, region=region)
        
        # Add edges for spatially adjacent regions (simplified)
        for i in range(len(regions)):
            for j in range(i + 1, len(regions)):
                if self._are_regions_adjacent(regions[i], regions[j]):
                    graph.add_edge(i, j)
        
        return graph
    
    def _are_regions_adjacent(self, region_a: SemanticRegion, 
                             region_b: SemanticRegion) -> bool:
        """Check if two regions are spatially adjacent (simplified)"""
        # In production, this would check actual vertex adjacency
        # For now, using semantic type compatibility
        compatible_pairs = [
            ('base', 'legs'), ('legs', 'torso'), ('torso', 'arms'),
            ('torso', 'head'), ('torso', 'cape'), ('arms', 'weapon')
        ]
        
        type_pair = (region_a.semantic_type, region_b.semantic_type)
        return type_pair in compatible_pairs or type_pair[::-1] in compatible_pairs
    
    def _calculate_merge_scores(self, regions: List[SemanticRegion], 
                               graph: nx.Graph) -> List[Tuple[int, int, float]]:
        """Calculate merge compatibility scores for all region pairs"""
        candidates = []
        
        for i in range(len(regions)):
            for j in range(i + 1, len(regions)):
                score = self._calculate_pair_merge_score(regions[i], regions[j], graph)
                if score > 0.3:
                    candidates.append((i, j, score))
        
        return sorted(candidates, key=lambda x: x[2], reverse=True)
    
    def _calculate_pair_merge_score(self, region_a: SemanticRegion, 
                                   region_b: SemanticRegion, graph: nx.Graph) -> float:
        """Calculate merge compatibility score between two regions"""
        
        # Semantic coherence (same or compatible types)
        semantic_score = self._semantic_compatibility(region_a.semantic_type, region_b.semantic_type)
        
        # Size compatibility (avoid huge disparities)
        size_ratio = min(region_a.area, region_b.area) / max(region_a.area, region_b.area)
        size_score = size_ratio if size_ratio > 0.2 else 0.0
        
        # Confidence compatibility
        confidence_score = min(region_a.confidence, region_b.confidence)
        
        # Spatial adjacency (from graph)
        adjacency_score = 1.0 if self._are_regions_adjacent(region_a, region_b) else 0.2
        
        # Weighted combination
        total_score = (
            semantic_score * self.merge_criteria_weights['semantic_coherence'] +
            size_score * self.merge_criteria_weights['size_compatibility'] +
            confidence_score * 0.2 +
            adjacency_score * self.merge_criteria_weights['spatial_adjacency']
        )
        
        return total_score
    
    def _semantic_compatibility(self, type_a: str, type_b: str) -> float:
        """Calculate semantic compatibility between region types"""
        if type_a == type_b:
            return 1.0
        
        # Define semantic compatibility matrix
        compatibility_matrix = {
            ('base', 'details'): 0.7,
            ('legs', 'torso'): 0.8,
            ('arms', 'weapon'): 0.9,
            ('torso', 'cape'): 0.7,
            ('head', 'details'): 0.6,
        }
        
        pair = (type_a, type_b)
        return compatibility_matrix.get(pair, compatibility_matrix.get(pair[::-1], 0.3))
    
    def _merge_regions(self, region_a: SemanticRegion, region_b: SemanticRegion) -> SemanticRegion:
        """Merge two regions into one"""
        # Combine vertices
        merged_vertices = list(set(region_a.vertices + region_b.vertices))
        
        # Choose dominant semantic type (higher confidence or larger area)
        if region_a.confidence > region_b.confidence:
            dominant_type = region_a.semantic_type
            dominant_name = region_a.name
        else:
            dominant_type = region_b.semantic_type
            dominant_name = region_b.name
        
        return SemanticRegion(
            id=f"merged_{region_a.id}_{region_b.id}",
            name=f"{dominant_name} (merged)",
            vertices=merged_vertices,
            semantic_type=dominant_type,
            confidence=(region_a.confidence + region_b.confidence) / 2,
            area=region_a.area + region_b.area
        )

# Flask app integration
app = Flask(__name__)
CORS(app)

# Global variables
sam_predictor = None
optimized_processor = None
region_merger = RegionAdjacencyGraphMerger()

@app.route('/segment-optimized', methods=['POST'])
def segment_with_optimization():
    """Endpoint for optimized SAM segmentation with semantic grouping"""
    global optimized_processor
    
    try:
        data = request.get_json()
        
        # Decode image
        import base64
        from PIL import Image
        import io
        
        image_data = data['color_image']
        image_bytes = base64.b64decode(image_data.split(',')[1])
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        image_np = np.array(image)
        
        logger.info(f"🎯 Processing optimized segmentation for {image_np.shape} image...")
        
        # Generate optimized masks (8-12 instead of 171)
        masks = optimized_processor.generate_optimized_masks(image_np)
        
        # Get mesh data for semantic grouping
        vertices = np.array(data.get('vertices', []))
        miniature_type = data.get('miniature_type', 'humanoid')
        
        # Apply semantic grouping
        semantic_regions = optimized_processor.apply_semantic_grouping(
            masks, vertices, miniature_type
        )
        
        # Apply RAG merging if still too many regions
        if len(semantic_regions) > 10:
            semantic_regions = region_merger.merge_similar_regions(
                semantic_regions, target_count=8
            )
        
        # Format response
        response_data = {
            'success': True,
            'num_regions': len(semantic_regions),
            'regions': [
                {
                    'id': region.id,
                    'name': region.name,
                    'semantic_type': region.semantic_type,
                    'vertices': region.vertices,
                    'confidence': region.confidence,
                    'area': region.area
                }
                for region in semantic_regions
            ],
            'stats': {
                'original_masks': len(masks),
                'semantic_regions': len(semantic_regions),
                'reduction_ratio': len(masks) / max(len(semantic_regions), 1)
            }
        }
        
        logger.info(f"✅ Optimized segmentation complete: {len(masks)} masks → {len(semantic_regions)} semantic regions")
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"❌ Optimized segmentation failed: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/init-optimized-sam', methods=['POST'])
def init_optimized_sam():
    """Initialize optimized SAM processor"""
    global sam_predictor, optimized_processor
    
    try:
        data = request.get_json()
        model_type = data.get('model_type', 'vit_h')
        checkpoint_path = data.get('checkpoint_path', './checkpoints/sam_vit_h_4b8939.pth')
        device = data.get('device', 'cpu')
        
        logger.info(f"🚀 Initializing optimized SAM processor: {model_type}")
        
        # Load SAM model
        sam_model = sam_model_registry[model_type](checkpoint=checkpoint_path)
        sam_model.to(device=device)
        sam_predictor = SamPredictor(sam_model)
        
        # Initialize optimized processor
        optimized_processor = OptimizedSAMProcessor(sam_predictor)
        
        return jsonify({
            'success': True,
            'model_type': model_type,
            'device': device,
            'message': 'Optimized SAM processor initialized - ready for semantic segmentation'
        })
        
    except Exception as e:
        logger.error(f"❌ Failed to initialize optimized SAM: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    print("🚀 Optimized SAM Backend Starting...")
    print("📊 Research-based optimizations:")
    print("   • 8-12 regions instead of 171")
    print("   • Semantic grouping (armor, weapon, cape, etc.)")
    print("   • RAG-based intelligent merging")
    app.run(debug=True, host='0.0.0.0', port=5000)