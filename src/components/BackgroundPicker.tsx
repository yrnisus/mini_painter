import React from 'react';

const BACKGROUND_COLORS: { name: string; color: number }[] = [
  { name: 'White', color: 0xffffff },
  { name: 'Light Gray', color: 0x808080 },
  { name: 'Dark Gray', color: 0x404040 },
  { name: 'Black', color: 0x000000 },
  { name: 'Blue', color: 0x87ceeb }
];

interface BackgroundPickerProps {
  selectedBackground: number;
  onBackgroundSelect: (background: number) => void;
}

const BackgroundPicker: React.FC<BackgroundPickerProps> = ({ 
  selectedBackground, 
  onBackgroundSelect 
}) => (
  <div style={{ marginBottom: '20px' }}>
    <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
      Background Color
    </h4>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {BACKGROUND_COLORS.map((bg) => (
        <button
          key={bg.color}
          onClick={() => onBackgroundSelect(bg.color)}
          style={{
            padding: '8px 12px',
            border: selectedBackground === bg.color ? '2px solid #3B82F6' : '1px solid #E5E7EB',
            borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s ease',
            backgroundColor: selectedBackground === bg.color ? '#EFF6FF' : '#FFFFFF',
            display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px'
          }}
        >
          <div style={{
            width: '16px', height: '16px', borderRadius: '4px',
            backgroundColor: `#${bg.color.toString(16).padStart(6, '0')}`,
            border: '1px solid #D1D5DB'
          }} />
          {bg.name}
        </button>
      ))}
    </div>
  </div>
);

export default BackgroundPicker;