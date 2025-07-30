import React, { useState, useCallback } from 'react';
import { Upload } from 'lucide-react';
import * as THREE from 'three';

// Import our modular components
import FileUpload from './components/FileUpload';
import ThreeScene from './components/ThreeScene';
import BackgroundPicker from './components/BackgroundPicker';
import ColorPicker from './components/ColorPicker';
import MaskingPanel from './components/MaskingPanel';
import ModelInfo from './components/ModelInfo';

// Import types and utilities
import { ModelData, PaintColors, MaskingGroup } from './types/index';
import { loadSTLFile } from './utils/stlLoader';
import { PAINT_COLORS, MASKING_GROUPS } from './utils/constants';

const App: React.FC = () => {
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [paintColors, setPaintColors] = useState<PaintColors>({});
  const [maskingGroups, setMaskingGroups] = useState<MaskingGroup[]>(MASKING_GROUPS);
  const [selectedGroup, setSelectedGroup] = useState<string>('armor');
  const [selectedColor, setSelectedColor] = useState<string>('#FF0000');
  const [backgroundColor, setBackgroundColor] = useState<number>(0x808080);

  const handleFileUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    try {
      let geometry: THREE.BufferGeometry;
      
      if (file.name.toLowerCase().endsWith('.stl')) {
        geometry = await loadSTLFile(file);
      } else {
        geometry = new THREE.BoxGeometry(2, 3, 1);
      }

      setModelData({
        name: file.name, 
        size: file.size, 
        type: file.type,
        uploadedAt: new Date(), 
        geometry: geometry
      });
      setPaintColors({});
      
    } catch (error) {
      alert(`Error loading ${file.name}. Showing placeholder instead.`);
      const fallbackGeometry = new THREE.CylinderGeometry(1, 1, 3, 16);
      setModelData({
        name: `${file.name} (placeholder)`, 
        size: file.size, 
        type: file.type,
        uploadedAt: new Date(), 
        geometry: fallbackGeometry
      });
      setPaintColors({});
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleGroupToggle = useCallback((groupId: string) => {
    setMaskingGroups(prev => 
      prev.map(group => 
        group.id === groupId ? { ...group, visible: !group.visible } : group
      )
    );
  }, []);

  const handleColorSelect = useCallback((color: string) => {
    setSelectedColor(color);
    setPaintColors(prev => ({ ...prev, [selectedGroup]: color }));
  }, [selectedGroup]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #E0E7FF 0%, #F3E8FF 50%, #FCE7F3 100%)',
      padding: '20px'
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{ 
            fontSize: '48px', fontWeight: '800', color: '#1F2937', marginBottom: '8px',
            textShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            3D Miniature Painter
          </h1>
          <p style={{ fontSize: '18px', color: '#6B7280', fontWeight: '500' }}>
            Upload your STL files and paint your 3D miniatures in real-time
          </p>
          <div style={{ marginTop: '20px', fontSize: '14px', color: '#6B7280' }}>
            WS: Toward/Away from camera • AD: Left/Right • EQ: Up/Down • Arrow Keys: Rotate model • Mouse: Orbit camera • Scroll: Zoom
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '40px' }}>
          <FileUpload onFileUpload={handleFileUpload} isLoading={isLoading} />
        </div>

        {modelData ? (
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '32px' }}>
            <div>
              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#1F2937', marginBottom: '20px' }}>
                  3D Preview: {modelData.name}
                </h2>
                
                <ThreeScene 
                  paintColors={paintColors} 
                  maskingGroups={maskingGroups} 
                  modelData={modelData} 
                  backgroundColor={backgroundColor} 
                />
              </div>
            </div>

            <div>
              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <MaskingPanel
                  groups={maskingGroups} 
                  onGroupToggle={handleGroupToggle}
                  selectedGroup={selectedGroup} 
                  onGroupSelect={setSelectedGroup}
                />
              </div>

              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <BackgroundPicker
                  selectedBackground={backgroundColor}
                  onBackgroundSelect={setBackgroundColor}
                />
              </div>

              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <ColorPicker
                  colors={PAINT_COLORS} 
                  selectedColor={selectedColor}
                  onColorSelect={handleColorSelect}
                  title={`Paint ${maskingGroups.find(g => g.id === selectedGroup)?.name || 'Selected Group'}`}
                />
              </div>

              <ModelInfo modelData={modelData} />
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', paddingTop: '60px' }}>
            <div style={{
              background: 'white', borderRadius: '16px', padding: '48px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', maxWidth: '500px', margin: '0 auto'
            }}>
              <div style={{ color: '#9CA3AF', marginBottom: '16px' }}>
                <Upload size={64} style={{ margin: '0 auto' }} />
              </div>
              <h3 style={{ fontSize: '24px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>
                No Model Uploaded
              </h3>
              <p style={{ color: '#6B7280', fontSize: '16px', marginBottom: '16px' }}>
                Upload an STL file to start painting your miniature
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;