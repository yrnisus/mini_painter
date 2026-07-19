import React from 'react';

interface ColorPickerProps {
  colors: string[];
  selectedColor: string;
  onColorSelect: (color: string) => void;
  title: string;
}

const ColorPicker: React.FC<ColorPickerProps> = ({ 
  colors, 
  selectedColor, 
  onColorSelect, 
  title 
}) => (
  <div style={{ marginBottom: '20px' }}>
    <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
      {title}
    </h4>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
      {colors.map((color) => (
        <button
          key={color}
          onClick={() => onColorSelect(color)}
          style={{
            width: '36px', height: '36px', borderRadius: '50%',
            border: selectedColor === color ? '3px solid #1F2937' : '2px solid #D1D5DB',
            backgroundColor: color, cursor: 'pointer', transition: 'all 0.2s ease',
            boxShadow: selectedColor === color ? '0 4px 14px 0 rgba(0, 0, 0, 0.3)' : '0 2px 4px 0 rgba(0, 0, 0, 0.1)'
          }}
          title={color}
        />
      ))}
    </div>
    <label style={{
      display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px',
      fontSize: '12px', color: '#6B7280', cursor: 'pointer'
    }}>
      <input
        type="color"
        value={selectedColor}
        onChange={(e) => onColorSelect(e.target.value)}
        style={{ width: '36px', height: '28px', border: 'none', padding: 0, cursor: 'pointer' }}
      />
      custom color {selectedColor}
    </label>
  </div>
);

export default ColorPicker;