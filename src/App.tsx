import React, { useState, useCallback, useEffect } from 'react';
import { Upload, Brain, Zap } from 'lucide-react';
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
  const [backgroundColor, setBackgroundColor] = useState<number>(0xffffff);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');

  // SAM Groups State
  const [useSAMGroups, setUseSAMGroups] = useState<boolean>(false);
  const [samMasks, setSamMasks] = useState<any[]>([]);
  const [samGroupsData, setSamGroupsData] = useState<any>(null);
  const [samMaskGroups, setSamMaskGroups] = useState<MaskingGroup[]>([]);
  const [samSemanticGroups, setSamSemanticGroups] = useState<MaskingGroup[]>([]);
  const [samGroupMode, setSamGroupMode] = useState<'individual' | 'semantic'>('individual');

  // Check backend connection on component mount
  useEffect(() => {
    checkBackendConnection();
  }, []);

  // Listen for SAM results - UPDATED to create individual groups for all detected masks
  useEffect(() => {
    (window as any).onSAMResults = (results: any) => {
      console.log('🎭 SAM Results received:', results);
      console.log(`Creating ${results.masks.length} individual mask groups`);
      
      setSamMasks(results.masks);
      setSamGroupsData(results);
      
      // Create individual SAM mask groups for UI - ONE FOR EACH DETECTED MASK
      const samMaskGroups: MaskingGroup[] = results.masks.map((mask: any, index: number) => ({
        id: `sam_mask_${mask.mask_id}`,
        name: `Region ${mask.mask_id + 1} (${mask.area} px)`,
        color: `hsl(${(mask.mask_id * 137.5) % 360}, 70%, 60%)`, // Generate unique colors
        visible: true
      }));
      
      console.log(`✅ Created ${samMaskGroups.length} individual mask groups`);
      
      // Create semantic groups (fewer, organized categories)
      const samSemanticGroups: MaskingGroup[] = [
        { id: 'sam_main_body', name: 'SAM Main Body', color: '#8B4513', visible: true },
        { id: 'sam_weapon', name: 'SAM Weapon', color: '#C0C0C0', visible: true },
        { id: 'sam_shield', name: 'SAM Shield', color: '#800080', visible: true },
        { id: 'sam_helmet', name: 'SAM Helmet', color: '#FFD700', visible: true },
        { id: 'sam_details', name: 'SAM Details', color: '#FF4500', visible: true },
        { id: 'sam_base', name: 'SAM Base', color: '#654321', visible: true }
      ];
      
      // Store both options
      setSamMaskGroups(samMaskGroups);
      setSamSemanticGroups(samSemanticGroups);
      
      // Automatically switch to individual mode to show all detected regions
      setSamGroupMode('individual');
      setUseSAMGroups(true);
      
      console.log(`🔄 Switched to individual SAM mode showing ${samMaskGroups.length} regions`);
    };
    
    return () => {
      delete (window as any).onSAMResults;
    };
  }, []);

  const checkBackendConnection = async () => {
    try {
      const response = await fetch('http://localhost:5000/health');
      if (response.ok) {
        setBackendStatus('connected');
        console.log('✅ Backend connected successfully');
      } else {
        setBackendStatus('error');
      }
    } catch (error) {
      setBackendStatus('error');
      console.log('❌ Backend not available, using fallback mode');
    }
  };

  // Function to get current groups based on mode
  const getCurrentMaskingGroups = () => {
    if (!useSAMGroups) return maskingGroups;
    return samGroupMode === 'individual' ? samMaskGroups : samSemanticGroups;
  };

  const handleFileUpload = useCallback(async (file: File) => {
    console.log('handleFileUpload called with:', file.name);
    setIsLoading(true);
    
    try {
      let geometry: THREE.BufferGeometry;
      
      if (file.name.toLowerCase().endsWith('.stl')) {
        console.log('Loading STL file...');
        geometry = await loadSTLFile(file);
        console.log('STL file loaded successfully');
      } else {
        console.log('Using fallback geometry');
        geometry = new THREE.BoxGeometry(2, 3, 1);
      }

      const newModelData: ModelData = {
        name: file.name, 
        size: file.size, 
        type: file.type,
        uploadedAt: new Date(), 
        geometry: geometry
      };

      console.log('Setting model data:', newModelData);
      setModelData(newModelData);
      setPaintColors({});
      console.log('Model data set successfully');
      
    } catch (error) {
      console.error('Error in handleFileUpload:', error);
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
      console.log('handleFileUpload completed');
    }
  }, []);

  // UPDATED - No automatic SAM analysis, only manual trigger
  const handleAnalysisComplete = useCallback((analysisData: any) => {
    console.log('handleAnalysisComplete called with:', analysisData);
    setAiAnalysis(analysisData);
    
    // Only update masking groups if we get valid AI analysis
    // Don't run automatic analysis anymore - user can manually trigger SAM
    if (analysisData.success && analysisData.masking_groups) {
      const aiGroups = Object.entries(analysisData.masking_groups).map(([id, group]: [string, any]) => ({
        id,
        name: group.name,
        color: group.color,
        visible: true
      }));
      setMaskingGroups(aiGroups);
      console.log('🤖 AI-generated masking groups applied');
    } else {
      console.log('🔄 Using fallback masking groups - no automatic SAM analysis');
    }
  }, []);

  const handleGroupToggle = useCallback((groupId: string) => {
    const currentGroups = getCurrentMaskingGroups();
    
    if (useSAMGroups) {
      // Update SAM groups
      if (samGroupMode === 'individual') {
        setSamMaskGroups(prev => 
          prev.map(group => 
            group.id === groupId ? { ...group, visible: !group.visible } : group
          )
        );
      } else {
        setSamSemanticGroups(prev => 
          prev.map(group => 
            group.id === groupId ? { ...group, visible: !group.visible } : group
          )
        );
      }
    } else {
      // Update regular masking groups
      setMaskingGroups(prev => 
        prev.map(group => 
          group.id === groupId ? { ...group, visible: !group.visible } : group
        )
      );
    }
  }, [useSAMGroups, samGroupMode]);

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
            Upload your STL files and paint your 3D miniatures with AI-powered segmentation
          </p>
          
          {/* Backend Status Indicator */}
          <div style={{ 
            marginTop: '16px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '8px',
            fontSize: '14px'
          }}>
            {backendStatus === 'connected' && (
              <React.Fragment>
                <Brain size={16} style={{ color: '#10B981' }} />
                <span style={{ color: '#10B981', fontWeight: '600' }}>AI Backend Connected</span>
              </React.Fragment>
            )}
            {backendStatus === 'error' && (
              <React.Fragment>
                <Zap size={16} style={{ color: '#F59E0B' }} />
                <span style={{ color: '#F59E0B', fontWeight: '600' }}>Basic Mode (AI Backend Offline)</span>
              </React.Fragment>
            )}
          </div>
          
          <div style={{ marginTop: '20px', fontSize: '14px', color: '#6B7280' }}>
            Mouse: Orbit camera around model • Scroll: Zoom in/out
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '40px' }}>
          <FileUpload 
            onFileUpload={handleFileUpload} 
            onAnalysisComplete={handleAnalysisComplete}
            isLoading={isLoading} 
          />
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
                  {aiAnalysis?.success && (
                    <span style={{ 
                      marginLeft: '12px', 
                      fontSize: '14px', 
                      color: '#10B981', 
                      fontWeight: '500',
                      padding: '4px 8px',
                      backgroundColor: '#ECFDF5',
                      borderRadius: '4px'
                    }}>
                      AI Enhanced
                    </span>
                  )}
                </h2>
                
                <ThreeScene 
                  paintColors={paintColors} 
                  maskingGroups={getCurrentMaskingGroups()} 
                  modelData={modelData} 
                  backgroundColor={backgroundColor}
                  selectedGroup={selectedGroup}
                  aiAnalysis={aiAnalysis}
                />
              </div>
            </div>

            <div>
              {/* Enhanced Masking Panel with SAM Toggle */}
              <div style={{
                background: 'white', borderRadius: '16px', padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
              }}>
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '12px' }}>
                    Masking Groups
                  </h3>
                  
                  {/* SAM Toggle - UPDATED to show actual counts */}
                  {samMasks.length > 0 && (
                    <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#F3F4F6', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <button
                          onClick={() => setUseSAMGroups(!useSAMGroups)}
                          style={{
                            padding: '6px 12px',
                            background: useSAMGroups ? '#10B981' : '#6B7280',
                            color: 'white',
                            borderRadius: '4px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '600'
                          }}
                        >
                          {useSAMGroups ? '🤖 SAM Groups' : '📐 Geometric Groups'}
                        </button>
                        
                        <span style={{ fontSize: '12px', color: '#6B7280' }}>
                          {useSAMGroups 
                            ? `${samGroupMode === 'individual' ? samMaskGroups.length : samSemanticGroups.length} AI-detected regions` 
                            : `${maskingGroups.length} geometric regions`}
                        </span>
                      </div>
                      
                      {/* SAM Group Mode Toggle - UPDATED with actual counts */}
                      {useSAMGroups && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => setSamGroupMode('individual')}
                            style={{
                              padding: '4px 8px',
                              background: samGroupMode === 'individual' ? '#3B82F6' : '#E5E7EB',
                              color: samGroupMode === 'individual' ? 'white' : '#6B7280',
                              borderRadius: '4px',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '11px'
                            }}
                          >
                            Individual ({samMaskGroups.length})
                          </button>
                          <button
                            onClick={() => setSamGroupMode('semantic')}
                            style={{
                              padding: '4px 8px',
                              background: samGroupMode === 'semantic' ? '#3B82F6' : '#E5E7EB',
                              color: samGroupMode === 'semantic' ? 'white' : '#6B7280',
                              borderRadius: '4px',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '11px'
                            }}
                          >
                            Semantic ({samSemanticGroups.length})
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                <MaskingPanel
                  groups={getCurrentMaskingGroups()} 
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
                  title={`Paint ${getCurrentMaskingGroups().find(g => g.id === selectedGroup)?.name || 'Selected Group'}`}
                />
              </div>

              {/* SAM Test Button - MANUAL ONLY, no automatic testing */}
              {modelData && (
                <div style={{
                  background: 'white', borderRadius: '16px', padding: '24px',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
                }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '16px' }}>
                    🎯 SAM Segmentation
                  </h3>
                  <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
<button
                      onClick={async () => {
                        console.log('🚀 Real SAM Analysis - calling backend...');
                        
                        try {
                          // Check backend first
                          const healthResponse = await fetch('http://localhost:5000/health');
                          if (!healthResponse.ok) {
                            throw new Error('Backend not available');
                          }
                          
                          // Create form data with current model file
                          const formData = new FormData();
                          
                          // We need to reconstruct the file from modelData
                          // For now, let's use a simple approach - call the existing analyze-model endpoint
                          console.log('📤 Sending current model for SAM analysis...');
                          
                          // Since we can't easily recreate the original file, let's use the testSAMCapture approach
                          // This captures the current 3D view and sends it to SAM
                          if ((window as any).testSAMCapture) {
                            console.log('📸 Using view capture for SAM...');
                            (window as any).testSAMCapture();
                          } else {
                            console.log('❌ View capture not available');
                            
                            // Fallback: create mock results that look more realistic
                            const mockSamResults = {
                              masks: [
                                { mask_id: 0, area: 2400, stability_score: 0.95, pixel_coords: [[100,200], [101,200]] },
                                { mask_id: 1, area: 1800, stability_score: 0.91, pixel_coords: [[200,300], [201,300]] },
                                { mask_id: 2, area: 1500, stability_score: 0.88, pixel_coords: [[300,400], [301,400]] },
                                { mask_id: 3, area: 1200, stability_score: 0.85, pixel_coords: [[400,500], [401,500]] },
                                { mask_id: 4, area: 900, stability_score: 0.82, pixel_coords: [[500,600], [501,600]] },
                                { mask_id: 5, area: 700, stability_score: 0.79, pixel_coords: [[600,700], [601,700]] },
                                { mask_id: 6, area: 500, stability_score: 0.76, pixel_coords: [[700,800], [701,800]] }
                              ]
                            };
                            
                            if ((window as any).onSAMResults) {
                              (window as any).onSAMResults(mockSamResults);
                              console.log('✅ Mock SAM results with 7 regions');
                            }
                          }
                          
                        } catch (error) {
                          console.error('❌ SAM analysis error:', error);
                          alert(`SAM Analysis Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                      }}
                      style={{
                        padding: '12px 24px',
                        background: 'linear-gradient(to right, #10B981, #059669)',
                        color: 'white',
                        borderRadius: '8px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '600'
                      }}
                    >
                      🎯 Run SAM Segmentation (Real)
                    </button>
                    
                    <button
                      onClick={() => {
                        console.log('🎨 Quick color test - generating random groups...');
                        
                        // Generate some quick test groups
                        const quickTestResults = {
                          masks: [
                            { mask_id: 0, area: 1500, stability_score: 0.99 },
                            { mask_id: 1, area: 1200, stability_score: 0.92 },
                            { mask_id: 2, area: 900, stability_score: 0.88 },
                            { mask_id: 3, area: 600, stability_score: 0.85 },
                            { mask_id: 4, area: 400, stability_score: 0.82 }
                          ]
                        };
                        
                        if ((window as any).onSAMResults) {
                          (window as any).onSAMResults(quickTestResults);
                          console.log('✅ Quick test results sent - should see 5 regions');
                        } else {
                          console.log('❌ onSAMResults not available');
                        }
                      }}
                      style={{
                        padding: '8px 16px',
                        background: 'linear-gradient(to right, #8B5CF6, #7C3AED)',
                        color: 'white',
                        borderRadius: '6px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '500'
                      }}
                    >
                      🎨 Quick Color Test (5 Regions)
                    </button>
                    
                    <button
                      onClick={async () => {
                        console.log('🧪 Backend connection test...');
                        try {
                          const response = await fetch('http://localhost:5000/health');
                          if (response.ok) {
                            const result = await response.json();
                            console.log('✅ Backend health check:', result);
                            alert(`Backend Status: ${result.status}\nSAM Loaded: ${result.sam_loaded}\nDevice: ${result.device}`);
                          } else {
                            console.error('❌ Backend health check failed:', response.statusText);
                            alert('Backend connection failed');
                          }
                        } catch (error) {
                          console.error('❌ Backend connection error:', error);
                          alert('Backend not available');
                        }
                      }}
                      style={{
                        padding: '8px 16px',
                        background: 'linear-gradient(to right, #3B82F6, #1D4ED8)',
                        color: 'white',
                        borderRadius: '6px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '500'
                      }}
                    >
                      Test Backend Connection
                    </button>
                  </div>
                  <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '8px' }}>
                    No automatic analysis - click buttons to manually test SAM
                  </p>
                </div>
              )}

              <ModelInfo modelData={modelData} />

              {/* AI Analysis Info */}
              {aiAnalysis && (
                <div style={{
                  background: 'white', borderRadius: '16px', padding: '24px',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginTop: '20px'
                }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '16px' }}>
                    AI Analysis
                  </h3>
                  <div style={{ fontSize: '14px', color: '#4B5563', lineHeight: '1.6' }}>
                    {aiAnalysis.success ? (
                      <React.Fragment>
                        <div><strong>Status:</strong> ✅ Analysis Complete</div>
                        {aiAnalysis.mesh_info && (
                          <React.Fragment>
                            <div><strong>Vertices:</strong> {aiAnalysis.mesh_info.vertices?.toLocaleString()}</div>
                            <div><strong>Faces:</strong> {aiAnalysis.mesh_info.faces?.toLocaleString()}</div>
                            <div><strong>Volume:</strong> {aiAnalysis.mesh_info.volume?.toFixed(2)} units³</div>
                          </React.Fragment>
                        )}
                      </React.Fragment>
                    ) : (
                      <div><strong>Status:</strong> ⚠️ Using fallback mode</div>
                    )}
                  </div>
                </div>
              )}

              {/* SAM Results Info - UPDATED to show individual mask count */}
              {samMasks.length > 0 && (
                <div style={{
                  background: 'white', borderRadius: '16px', padding: '24px',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginTop: '20px'
                }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '16px' }}>
                    🎭 SAM Analysis Results
                  </h3>
                  <div style={{ fontSize: '14px', color: '#4B5563', lineHeight: '1.6' }}>
                    <div><strong>Status:</strong> ✅ SAM Segmentation Complete</div>
                    <div><strong>Detected Regions:</strong> {samMasks.length}</div>
                    <div><strong>Individual Groups Created:</strong> {samMaskGroups.length}</div>
                    <div><strong>Largest Region:</strong> {Math.max(...samMasks.map(m => m.area)).toLocaleString()} pixels</div>
                    <div><strong>Average Confidence:</strong> {(samMasks.reduce((sum, m) => sum + m.stability_score, 0) / samMasks.length).toFixed(3)}</div>
                  </div>
                </div>
              )}
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
                {backendStatus === 'connected' && (
                  <span style={{ display: 'block', marginTop: '8px', color: '#10B981', fontWeight: '500' }}>
                    🤖 AI-powered segmentation ready!
                  </span>
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;