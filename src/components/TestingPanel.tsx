import React from 'react';
import { MaskingGroup, PaintColors } from '../types';

interface TestingPanelProps {
  maskingGroups: MaskingGroup[];
  onQuickColorTest: () => void;
  modelData?: any; // For manual AI analysis
}

const TestingPanel: React.FC<TestingPanelProps> = ({
  maskingGroups,
  onQuickColorTest,
  modelData
}) => {
  const runManualAIAnalysis = async () => {
    if (!modelData) {
      console.log('❌ No model loaded for AI analysis');
      return;
    }

    console.log('🤖 Running manual AI analysis...');
    
    try {
      // Note: This would need the actual file object, not just model data
      // For now, just show that the functionality exists
      console.log('🤖 Manual AI analysis would run here');
      console.log('📁 Model data:', modelData);
      
      // TODO: Implement manual AI analysis when needed
      alert('Manual AI analysis not yet implemented. Use the original file upload for AI analysis.');
      
    } catch (error) {
      console.error('❌ Manual AI analysis failed:', error);
    }
  };

  return (
    <div style={{
      background: 'white', borderRadius: '16px', padding: '24px',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginBottom: '20px'
    }}>
      <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '16px' }}>
        🎯 Testing & Debug
      </h3>
      <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
        <button
          onClick={onQuickColorTest}
          style={{
            padding: '8px 16px',
            background: 'linear-gradient(to right, #FF6B6B, #4ECDC4)',
            color: 'white',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '500'
          }}
        >
          🌈 Quick Color Test
        </button>
        
        <button
          onClick={() => {
            console.log('⚡ Triggering QUICK SAM test...');
            if ((window as any).testSAMCapture) {
              (window as any).testSAMCapture();
            } else {
              console.log('❌ Quick SAM test not available');
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
          ⚡ Quick SAM Test (~30 seconds)
        </button>
        
        <button
          onClick={() => {
            console.log('🎭 Triggering enhanced SAM test...');
            if ((window as any).testSAMCaptureEnhanced) {
              (window as any).testSAMCaptureEnhanced();
            } else {
              console.log('❌ Enhanced SAM test not available');
            }
          }}
          style={{
            padding: '10px 20px',
            background: 'linear-gradient(to right, #8B5CF6, #7C3AED)',
            color: 'white',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '500'
          }}
        >
          🎭 Enhanced SAM Test (~10 mins)
        </button>
        
        <button
          onClick={() => {
            console.log('🚀 Triggering basic SAM test...');
            if ((window as any).testSAMCaptureBasic) {
              (window as any).testSAMCaptureBasic();
            } else {
              console.log('❌ Basic SAM test not available');
            }
          }}
          style={{
            padding: '8px 16px',
            background: 'linear-gradient(to right, #6B7280, #4B5563)',
            color: 'white',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '500'
          }}
        >
          Basic SAM Test (No Mapping)
        </button>

        {/* Manual AI Analysis Button */}
        <button
          onClick={runManualAIAnalysis}
          disabled={!modelData}
          style={{
            padding: '8px 16px',
            background: modelData 
              ? 'linear-gradient(to right, #F59E0B, #D97706)' 
              : '#9CA3AF',
            color: 'white',
            borderRadius: '6px',
            border: 'none',
            cursor: modelData ? 'pointer' : 'not-allowed',
            fontSize: '12px',
            fontWeight: '500'
          }}
        >
          🤖 Manual AI Analysis (Disabled)
        </button>
        
        <button
          onClick={async () => {
            console.log('🧪 Simple backend test...');
            try {
              const response = await fetch('http://localhost:5000/health');
              if (response.ok) {
                const result = await response.json();
                console.log('✅ Backend health check:', result);
                alert('✅ Backend is healthy and responding!');
              } else {
                console.error('❌ Backend health check failed:', response.statusText);
                alert('❌ Backend health check failed');
              }
            } catch (error) {
              console.error('❌ Backend connection error:', error);
              alert('❌ Backend connection error - make sure the Python server is running');
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
      <div style={{ marginTop: '12px', fontSize: '12px', color: '#6B7280', lineHeight: '1.4' }}>
        <div style={{ marginBottom: '8px', padding: '8px', backgroundColor: '#FEF3C7', borderRadius: '4px', border: '1px solid #F59E0B' }}>
          <strong>🚫 Auto AI-analysis disabled for clean SAM testing</strong>
        </div>
        <strong>⚡ Quick SAM:</strong> Fast geometric approximation (~30 seconds)<br/>
        <strong>🎭 Enhanced SAM:</strong> Pixel-perfect mapping (~10 minutes)<br/>
        <strong>Basic SAM:</strong> Just generates masks (no 3D mapping)<br/>
        <strong>🤖 Manual AI:</strong> Re-enable auto-analysis when ready
      </div>
    </div>
  );
};

export default TestingPanel;