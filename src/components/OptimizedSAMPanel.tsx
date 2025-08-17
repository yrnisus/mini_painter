// src/components/OptimizedSAMPanel.tsx
import React, { useState, useEffect } from 'react';
import { Brain, Zap, Target, Layers, Settings, CheckCircle, AlertCircle } from 'lucide-react';
import * as THREE from 'three';

interface OptimizedSAMPanelProps {
  modelData: any;
  onSAMResults: (result: any) => void;
  meshRef: React.RefObject<THREE.Mesh | null>;
  cameraRef: React.RefObject<THREE.PerspectiveCamera | null>;
  rendererRef: React.RefObject<THREE.WebGLRenderer | null>;
  sceneRef: React.RefObject<THREE.Scene | null>;
}

interface BackendStatus {
  connected: boolean;
  optimizedSAM: boolean;
  processing: boolean;
}

const OptimizedSAMPanel: React.FC<OptimizedSAMPanelProps> = ({
  modelData,
  onSAMResults,
  meshRef,
  cameraRef,
  rendererRef,
  sceneRef
}) => {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({
    connected: false,
    optimizedSAM: false,
    processing: false
  });
  const [miniatureType, setMiniatureType] = useState<'humanoid' | 'creature'>('humanoid');
  const [lastResults, setLastResults] = useState<any>(null);

  // Check backend status on mount
  useEffect(() => {
    checkBackendStatus();
  }, []);

  const checkBackendStatus = async () => {
    try {
      const response = await fetch('http://localhost:5000/health');
      if (response.ok) {
        setBackendStatus(prev => ({ ...prev, connected: true }));
        
        // Try to initialize optimized SAM
        const initResponse = await fetch('http://localhost:5000/init-optimized-sam', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model_type: 'vit_h', device: 'cpu' })
        });
        
        if (initResponse.ok) {
          setBackendStatus(prev => ({ ...prev, optimizedSAM: true }));
        }
      }
    } catch (error) {
      setBackendStatus(prev => ({ ...prev, connected: false, optimizedSAM: false }));
    }
  };

  const runOptimizedSAM = async () => {
    if (!modelData || !meshRef.current || !cameraRef.current || !rendererRef.current || !sceneRef.current) {
      alert('❌ Scene not ready. Please ensure a 3D model is loaded.');
      return;
    }

    setBackendStatus(prev => ({ ...prev, processing: true }));

    try {
      console.log('🚀 Running optimized SAM segmentation...');

      // Position camera for optimal view
      cameraRef.current.position.set(0, 8, 12);
      cameraRef.current.lookAt(0, 4, 0);
      cameraRef.current.updateMatrixWorld();
      rendererRef.current.render(sceneRef.current, cameraRef.current);

      // Capture image
      const colorImage = rendererRef.current.domElement.toDataURL('image/png');

      // Extract mesh vertices
      const geometry = meshRef.current.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      const vertices: number[][] = [];
      
      // Sample vertices for better performance (every 10th vertex)
      const sampleRate = Math.max(1, Math.floor(positions.count / 50000));
      for (let i = 0; i < positions.count; i += sampleRate) {
        vertices.push([
          positions.getX(i),
          positions.getY(i),
          positions.getZ(i)
        ]);
      }

      console.log(`📊 Processing ${vertices.length} vertices (sampled from ${positions.count})`);

      // Send to optimized backend
      const response = await fetch('http://localhost:5000/segment-optimized', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          color_image: colorImage,
          vertices: vertices,
          miniature_type: miniatureType,
          camera_matrix: cameraRef.current.matrixWorld.toArray(),
          projection_matrix: cameraRef.current.projectionMatrix.toArray(),
          viewport_size: { width: 1024, height: 1024 }
        })
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.success) {
          console.log(`✅ Optimized SAM success: ${result.num_regions} semantic regions`);
          console.log(`📊 Reduction: ${result.stats.original_masks} → ${result.stats.semantic_regions} (${result.stats.reduction_ratio.toFixed(1)}x improvement)`);
          
          // Convert to frontend format
          const formattedResult = {
            masks: result.regions.map((region: any, index: number) => ({
              mask_id: index,
              area: region.area,
              stability_score: region.confidence,
              vertices: region.vertices,
              semantic_type: region.semantic_type,
              semantic_name: region.name
            })),
            viewport_size: { width: 1024, height: 1024 },
            semantic_regions: true,
            optimized: true,
            stats: result.stats
          };

          setLastResults(result);
          onSAMResults(formattedResult);

          console.log('🎨 Semantic regions created:');
          result.regions.forEach((region: any) => {
            console.log(`   ${region.semantic_type}: ${region.name} (${region.vertices.length} vertices, ${region.confidence.toFixed(2)} confidence)`);
          });

        } else {
          throw new Error(result.error || 'Optimized SAM processing failed');
        }
      } else {
        throw new Error(`Backend error: ${response.statusText}`);
      }

    } catch (error) {
      console.error('❌ Optimized SAM failed:', error);
      
      // Fallback to mock semantic regions
      console.log('🔄 Creating fallback semantic regions...');
      const mockResult = createMockSemanticResult(meshRef.current);
      setLastResults(mockResult);
      onSAMResults(mockResult);
      
      alert(`⚠️ Optimized SAM failed, using fallback regions: ${error}`);
      
    } finally {
      setBackendStatus(prev => ({ ...prev, processing: false }));
    }
  };

  const createMockSemanticResult = (mesh: THREE.Mesh) => {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const vertexCount = geometry.attributes.position.count;
    
    const mockRegions = [
      { id: 'base', name: 'Base & Support', type: 'base', ratio: 0.15 },
      { id: 'legs', name: 'Legs & Lower Armor', type: 'legs', ratio: 0.25 },
      { id: 'torso', name: 'Torso & Main Armor', type: 'torso', ratio: 0.30 },
      { id: 'arms', name: 'Arms & Shoulders', type: 'arms', ratio: 0.15 },
      { id: 'head', name: 'Head & Helmet', type: 'head', ratio: 0.10 },
      { id: 'details', name: 'Weapons & Details', type: 'weapon', ratio: 0.05 }
    ];

    let currentIndex = 0;
    return {
      masks: mockRegions.map((region, index) => {
        const regionSize = Math.floor(vertexCount * region.ratio);
        const vertices = Array.from({length: regionSize}, (_, i) => currentIndex + i);
        currentIndex += regionSize;
        
        return {
          mask_id: index,
          area: regionSize,
          stability_score: 0.85 + Math.random() * 0.1,
          vertices: vertices,
          semantic_type: region.type,
          semantic_name: region.name
        };
      }),
      viewport_size: { width: 1024, height: 1024 },
      semantic_regions: true,
      optimized: true,
      fallback: true
    };
  };

  const StatusIndicator = ({ connected, optimized }: { connected: boolean; optimized: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
      {connected ? (
        <CheckCircle size={16} style={{ color: '#10B981' }} />
      ) : (
        <AlertCircle size={16} style={{ color: '#EF4444' }} />
      )}
      <span style={{ color: connected ? '#059669' : '#DC2626' }}>
        {connected ? (optimized ? 'Optimized SAM Ready' : 'Backend Connected') : 'Backend Offline'}
      </span>
    </div>
  );

  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      padding: '24px',
      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
      marginBottom: '20px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Brain size={24} style={{ color: '#3B82F6' }} />
        <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1F2937', margin: 0 }}>
          Optimized SAM Segmentation
        </h3>
      </div>

      <StatusIndicator connected={backendStatus.connected} optimized={backendStatus.optimizedSAM} />

      <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Miniature Type Selection */}
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
            Miniature Type
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setMiniatureType('humanoid')}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                border: '1px solid',
                cursor: 'pointer',
                backgroundColor: miniatureType === 'humanoid' ? '#DBEAFE' : '#F9FAFB',
                borderColor: miniatureType === 'humanoid' ? '#93C5FD' : '#D1D5DB',
                color: miniatureType === 'humanoid' ? '#1E40AF' : '#374151'
              }}
            >
              🧙‍♂️ Humanoid
            </button>
            <button
              onClick={() => setMiniatureType('creature')}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                border: '1px solid',
                cursor: 'pointer',
                backgroundColor: miniatureType === 'creature' ? '#DBEAFE' : '#F9FAFB',
                borderColor: miniatureType === 'creature' ? '#93C5FD' : '#D1D5DB',
                color: miniatureType === 'creature' ? '#1E40AF' : '#374151'
              }}
            >
              🐉 Creature
            </button>
          </div>
        </div>

        {/* Main Action Button */}
        <button
          onClick={runOptimizedSAM}
          disabled={!modelData || backendStatus.processing}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '12px 16px',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: '600',
            color: 'white',
            border: 'none',
            cursor: (!modelData || backendStatus.processing) ? 'not-allowed' : 'pointer',
            background: (!modelData || backendStatus.processing) 
              ? '#9CA3AF' 
              : backendStatus.optimizedSAM
              ? 'linear-gradient(to right, #10B981, #3B82F6)'
              : 'linear-gradient(to right, #F59E0B, #F97316)',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
          }}
        >
          {backendStatus.processing ? (
            <>
              <div style={{
                width: '20px',
                height: '20px',
                border: '2px solid white',
                borderTop: '2px solid transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              Processing...
            </>
          ) : (
            <>
              <Target size={20} />
              {backendStatus.optimizedSAM 
                ? 'Run Optimized SAM (8-12 regions)' 
                : 'Run SAM (fallback mode)'}
            </>
          )}
        </button>

        {/* Quick Actions */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={checkBackendStatus}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '8px 12px',
              backgroundColor: '#F3F4F6',
              color: '#374151',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            <Zap size={16} />
            Refresh Status
          </button>
          <button
            onClick={() => window.open('http://localhost:5000/health', '_blank')}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '8px 12px',
              backgroundColor: '#F3F4F6',
              color: '#374151',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            <Settings size={16} />
            Backend Health
          </button>
        </div>

        {/* Results Summary */}
        {lastResults && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            backgroundColor: '#ECFDF5',
            border: '1px solid #BBF7D0',
            borderRadius: '6px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <CheckCircle size={16} style={{ color: '#059669' }} />
              <span style={{ fontSize: '14px', fontWeight: '500', color: '#065F46' }}>
                Last Segmentation Results
              </span>
            </div>
            <div style={{ fontSize: '14px', color: '#047857', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div>🎯 Regions: {lastResults.num_regions || lastResults.masks?.length || 0}</div>
              {lastResults.stats && (
                <div>📊 Reduction: {lastResults.stats.original_masks} → {lastResults.stats.semantic_regions} masks</div>
              )}
              <div>🎨 Type: {miniatureType} miniature</div>
            </div>
          </div>
        )}

        {/* Information Panel */}
        <div style={{
          backgroundColor: '#EFF6FF',
          border: '1px solid #BFDBFE',
          borderRadius: '6px',
          padding: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <Layers size={16} style={{ color: '#2563EB', marginTop: '2px' }} />
            <div style={{ fontSize: '14px', color: '#1E40AF' }}>
              <div style={{ fontWeight: '500', marginBottom: '4px' }}>Optimized SAM Benefits:</div>
              <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', lineHeight: '1.5' }}>
                <li>8-12 meaningful regions instead of 171+ abstract ones</li>
                <li>Semantic grouping: armor, weapons, cape, etc.</li>
                <li>Intelligent region merging based on painting workflow</li>
                <li>Faster processing with better results</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

export default OptimizedSAMPanel;