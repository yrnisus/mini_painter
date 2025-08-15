import React from 'react';
import { SAMToVertexMapping } from '../utils/samTo3DMapper';

interface StatusInfoProps {
  aiAnalysis?: any;
  samMapping?: SAMToVertexMapping | null;
}

const StatusInfo: React.FC<StatusInfoProps> = ({ aiAnalysis, samMapping }) => {
  if (!aiAnalysis && !samMapping) return null;

  return (
    <div style={{
      background: 'white', borderRadius: '16px', padding: '24px',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', marginTop: '20px'
    }}>
      <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '16px' }}>
        AI Analysis & SAM Status
      </h3>
      <div style={{ fontSize: '14px', color: '#4B5563', lineHeight: '1.6' }}>
        {aiAnalysis?.success ? (
          <React.Fragment>
            <div><strong>AI Analysis:</strong> ✅ Complete</div>
            {aiAnalysis.mesh_info && (
              <React.Fragment>
                <div><strong>Vertices:</strong> {aiAnalysis.mesh_info.vertices?.toLocaleString()}</div>
                <div><strong>Faces:</strong> {aiAnalysis.mesh_info.faces?.toLocaleString()}</div>
                <div><strong>Volume:</strong> {aiAnalysis.mesh_info.volume?.toFixed(2)} units³</div>
              </React.Fragment>
            )}
            {aiAnalysis.masking_groups && (
              <div style={{ marginTop: '8px' }}>
                <strong>AI Groups:</strong> {Object.keys(aiAnalysis.masking_groups).join(', ')}
              </div>
            )}
          </React.Fragment>
        ) : (
          <div><strong>AI Analysis:</strong> ⚠️ Using fallback mode</div>
        )}
        
        {samMapping ? (
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #E5E7EB' }}>
            <div><strong>SAM Mapping:</strong> ✅ Active</div>
            <div><strong>SAM Groups:</strong> {Object.keys(samMapping).length}</div>
            <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
              Pixel-level masks mapped to 3D vertices
            </div>
          </div>
        ) : (
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #E5E7EB' }}>
            <div><strong>SAM Mapping:</strong> ⚪ Not Applied</div>
            <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
              Click "SAM → 3D Mapping" to apply pixel-level segmentation
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatusInfo;