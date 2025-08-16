import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { PaintColors, MaskingGroup, ModelData } from '../types/index';

// Import our modular utilities
import { setupSAMTestFunctions } from '../utils/samCaptureUtils';
import { initializeScene, updateBackgroundColor, SceneRefs } from '../utils/sceneSetupUtils';
import { updateMeshModel, updateMeshColors, validateGeometry } from '../utils/modelLoaderUtils';
import { VertexMasking, AIAnalysis } from '../utils/maskingUtils';

interface ThreeSceneProps {
  paintColors: PaintColors;
  maskingGroups: MaskingGroup[];
  modelData: ModelData | null;
  backgroundColor: number;
  selectedGroup: string;
  aiAnalysis?: AIAnalysis;
  // NEW: Callback to pass refs back to parent component for SAM integration
  onRefsReady?: (mesh: THREE.Mesh | null, camera: THREE.PerspectiveCamera | null, renderer: THREE.WebGLRenderer | null) => void;
}

const ThreeScene: React.FC<ThreeSceneProps> = ({ 
  paintColors, 
  maskingGroups, 
  modelData, 
  backgroundColor,
  selectedGroup,
  aiAnalysis,
  onRefsReady // NEW: Ref callback prop
}) => {
  // DOM reference
  const mountRef = useRef<HTMLDivElement>(null);
  
  // Three.js object references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const animationIdRef = useRef<number | null>(null);
  
  // Application state references
  const vertexMaskingRef = useRef<VertexMasking | null>(null);
  const orbitCenterRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 6, 0));

  // Group scene refs for utilities
  const sceneRefs: SceneRefs = {
    sceneRef,
    rendererRef,
    cameraRef,
    meshRef,
    animationIdRef
  };

  // Scene initialization
  useEffect(() => {
    if (!mountRef.current) return;

    console.log('🎬 Initializing Three.js scene');
    
    const cleanup = initializeScene(
      mountRef.current,
      sceneRefs,
      orbitCenterRef.current
    );

    // Verify refs are set after initialization
    setTimeout(() => {
      console.log('🔍 Scene refs check after initialization:', {
        scene: !!sceneRef.current,
        camera: !!cameraRef.current,
        renderer: !!rendererRef.current,
        mesh: !!meshRef.current
      });
      
      // NEW: Notify parent that basic scene is ready (without mesh yet)
      if (onRefsReady && cameraRef.current && rendererRef.current) {
        console.log('🔗 Basic scene ready - notifying parent (mesh will come later)');
        onRefsReady(meshRef.current, cameraRef.current, rendererRef.current);
      }
    }, 100);

    return cleanup;
  }, [onRefsReady]);

  // NEW: Enhanced effect to notify parent when refs are ready
  useEffect(() => {
    if (onRefsReady && sceneRef.current && cameraRef.current && rendererRef.current) {
      console.log('🔗 Scene fully ready - notifying parent with current refs');
      onRefsReady(meshRef.current, cameraRef.current, rendererRef.current);
    }
  }, [modelData, onRefsReady]); // Trigger when model changes or callback changes

  // Setup SAM test functions when scene is ready
  useEffect(() => {
    const setupSAMWhenReady = () => {
      if (sceneRef.current && cameraRef.current && rendererRef.current) {
        console.log('🔧 Setting up SAM test functions - scene is ready');
        
        const cleanup = setupSAMTestFunctions(
          sceneRef, 
          cameraRef, 
          rendererRef, 
          meshRef
        );
        
        return cleanup;
      } else {
        console.log('⏳ Waiting for scene to be ready for SAM setup...');
        return null;
      }
    };

    // Try to setup immediately
    let cleanup = setupSAMWhenReady();
    
    // If not ready, try again after a delay
    if (!cleanup) {
      const timer = setTimeout(() => {
        cleanup = setupSAMWhenReady();
      }, 200);
      
      return () => {
        clearTimeout(timer);
        if (cleanup) cleanup();
      };
    }
    
    return cleanup || (() => {});
  }, [modelData]); // Re-setup when model changes

  // Background color updates  
  useEffect(() => {
    updateBackgroundColor(sceneRef.current, rendererRef.current, backgroundColor);
  }, [backgroundColor]);

  // ENHANCED: Model loading with ref notification
  useEffect(() => {
    if (!modelData?.geometry || !sceneRef.current) return;
    
    console.log('🎯 Loading model:', modelData.name);

    // Validate geometry before processing
    if (!validateGeometry(modelData.geometry)) {
      console.error('❌ Invalid geometry provided');
      return;
    }

    try {
      const { newMesh, masking, orbitCenter } = updateMeshModel(
        sceneRef.current,
        meshRef.current,
        modelData,
        maskingGroups,
        aiAnalysis
      );

      // Update references
      meshRef.current = newMesh;
      vertexMaskingRef.current = masking;
      orbitCenterRef.current = orbitCenter;

      console.log('✅ Model loaded successfully');
      console.log('🔍 Mesh ref updated:', !!meshRef.current);
      
      // NEW: Notify parent that mesh is now ready for 3D mapping
      if (onRefsReady && cameraRef.current && rendererRef.current) {
        console.log('🔗 Mesh loaded - notifying parent with updated refs for SAM integration');
        onRefsReady(meshRef.current, cameraRef.current, rendererRef.current);
      }

      // Force a render
      if (rendererRef.current && cameraRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    } catch (error) {
      console.error('❌ Error loading model:', error);
    }
  }, [modelData, maskingGroups, aiAnalysis, onRefsReady]); // Include onRefsReady in dependencies
  
  // Update vertex colors when paint colors or masking groups change
  useEffect(() => {
    if (meshRef.current && vertexMaskingRef.current) {
      console.log('🎨 Updating vertex colors');
      
      updateMeshColors(
        meshRef.current,
        vertexMaskingRef.current,
        maskingGroups,
        paintColors
      );
      
      // Force a render
      if (rendererRef.current && cameraRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    }
  }, [paintColors, maskingGroups]);

  // NEW: Debug effect to track ref changes
  useEffect(() => {
    console.log('🔍 ThreeScene ref status update:', {
      scene: !!sceneRef.current,
      camera: !!cameraRef.current,
      renderer: !!rendererRef.current,
      mesh: !!meshRef.current,
      modelLoaded: !!modelData,
      onRefsReady: !!onRefsReady
    });
  }, [sceneRef.current, cameraRef.current, rendererRef.current, meshRef.current, modelData, onRefsReady]);

  // Component render
  return (
    <div 
      ref={mountRef} 
      style={{
        width: '100%', 
        height: '600px',
        background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
        borderRadius: '12px', 
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4)',
        cursor: 'grab', 
        border: '1px solid #d1d5db', 
        position: 'relative', 
        overflow: 'visible'
      }}
      onMouseDown={(e) => { e.currentTarget.style.cursor = 'grabbing'; }}
      onMouseUp={(e) => { e.currentTarget.style.cursor = 'grab'; }}
    />
  );
};

export default ThreeScene;