import React from 'react';
import { ModelData } from '../types';

interface ModelInfoProps {
  modelData: ModelData;
}

const ModelInfo: React.FC<ModelInfoProps> = ({ modelData }) => (
  <div style={{
    background: 'white', borderRadius: '16px', padding: '24px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
  }}>
    <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '16px' }}>
      Model Info
    </h3>
    <div style={{ fontSize: '14px', color: '#4B5563', lineHeight: '1.6' }}>
      <div><strong>Name:</strong> {modelData.name}</div>
      <div><strong>Size:</strong> {(modelData.size / 1024 / 1024).toFixed(2)} MB</div>
      <div><strong>Type:</strong> {modelData.name.split('.').pop()?.toUpperCase()}</div>
      <div><strong>Uploaded:</strong> {modelData.uploadedAt.toLocaleString()}</div>
    </div>
  </div>
);

export default ModelInfo;