import React from 'react';
import { Palette, Eye, EyeOff } from 'lucide-react';
import { MaskingGroup } from '../types';

interface MaskingPanelProps {
  groups: MaskingGroup[];
  onGroupToggle: (groupId: string) => void;
  selectedGroup: string;
  onGroupSelect: (groupId: string) => void;
}

const MaskingPanel: React.FC<MaskingPanelProps> = ({ 
  groups, 
  onGroupToggle, 
  selectedGroup, 
  onGroupSelect 
}) => (
  <div style={{ marginBottom: '20px' }}>
    <h3 style={{ 
      fontSize: '18px', fontWeight: '700', color: '#1F2937', marginBottom: '16px',
      display: 'flex', alignItems: 'center', gap: '8px'
    }}>
      <Palette size={20} />
      Masking Groups
    </h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {groups.map((group) => (
        <div
          key={group.id}
          onClick={() => onGroupSelect(group.id)}
          style={{
            padding: '12px',
            border: selectedGroup === group.id ? '2px solid #3B82F6' : '1px solid #E5E7EB',
            borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s ease',
            backgroundColor: selectedGroup === group.id ? '#EFF6FF' : '#FFFFFF'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '16px', height: '16px', borderRadius: '50%',
                backgroundColor: group.color, border: '1px solid #D1D5DB'
              }} />
              <span style={{ fontWeight: '500', fontSize: '14px', color: '#1F2937' }}>
                {group.name}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onGroupToggle(group.id);
              }}
              style={{
                padding: '4px', background: 'none', border: 'none',
                borderRadius: '4px', cursor: 'pointer', color: '#6B7280'
              }}
            >
              {group.visible ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default MaskingPanel;