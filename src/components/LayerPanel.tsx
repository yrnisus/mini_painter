import React, { useState } from 'react';
import { Eye, EyeOff, Layers } from 'lucide-react';
import { FinishName } from '../types';

export interface LayerRow {
  id: number;
  name: string;
  swatch: string;      // resolved display color
  painted: boolean;
  finish: FinishName;
  visible: boolean;
  pct: number;
}

interface LayerPanelProps {
  rows: LayerRow[];
  selectedRegion: number | null;
  onSelect: (id: number) => void;
  onToggleVisible: (id: number) => void;
  onFinishChange: (id: number, finish: FinishName) => void;
  onRename: (id: number, name: string) => void;
  regionCount: number;
  maxRegions: number;
  onRegionCountChange: (n: number) => void;
  suggested: number;
}

const FINISHES: FinishName[] = ['matte', 'satin', 'gloss', 'metallic'];

const LayerPanel: React.FC<LayerPanelProps> = ({
  rows,
  selectedRegion,
  onSelect,
  onToggleVisible,
  onFinishChange,
  onRename,
  regionCount,
  maxRegions,
  onRegionCountChange,
  suggested,
}) => {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <div>
      <h3
        style={{
          fontSize: '18px', fontWeight: 700, color: '#1F2937',
          marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px',
        }}
      >
        <Layers size={20} />
        Regions ({rows.length})
      </h3>

      <div style={{ marginBottom: '14px' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: '12px', color: '#6B7280', marginBottom: '4px',
        }}>
          <span>Detail: {regionCount} regions</span>
          <button
            onClick={() => onRegionCountChange(suggested)}
            style={{
              background: 'none', border: 'none', color: '#3B82F6',
              cursor: 'pointer', fontSize: '12px', padding: 0,
            }}
          >
            reset to {suggested}
          </button>
        </div>
        <input
          type="range"
          min={1}
          max={maxRegions}
          value={regionCount}
          onChange={(e) => onRegionCountChange(parseInt(e.target.value, 10))}
          style={{ width: '100%' }}
          data-testid="granularity-slider"
        />
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: '11px', color: '#9CA3AF',
        }}>
          <span>coarse</span>
          <span>fine</span>
        </div>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: '6px',
        maxHeight: '360px', overflowY: 'auto', paddingRight: '4px',
      }}>
        {rows.map((row) => (
          <div
            key={row.id}
            onClick={() => onSelect(row.id)}
            data-testid={`layer-row-${row.id}`}
            style={{
              padding: '8px 10px',
              border: selectedRegion === row.id ? '2px solid #3B82F6' : '1px solid #E5E7EB',
              borderRadius: '8px',
              cursor: 'pointer',
              backgroundColor: selectedRegion === row.id ? '#EFF6FF' : '#FFFFFF',
              opacity: row.visible ? 1 : 0.45,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0,
                  backgroundColor: row.swatch,
                  border: row.painted ? '1px solid #9CA3AF' : '1px dashed #9CA3AF',
                }}
                title={row.painted ? row.swatch : 'unpainted'}
              />
              {editing === row.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    onRename(row.id, draft.trim() || row.name);
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    fontSize: '13px', flex: 1, minWidth: 0,
                    border: '1px solid #93C5FD', borderRadius: '4px', padding: '2px 4px',
                  }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditing(row.id);
                    setDraft(row.name);
                  }}
                  style={{
                    fontSize: '13px', fontWeight: 500, color: '#1F2937',
                    flex: 1, minWidth: 0, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                  title={`${row.name} — double-click to rename`}
                >
                  {row.name}
                </span>
              )}
              <span style={{ fontSize: '11px', color: '#9CA3AF', flexShrink: 0 }}>
                {row.pct >= 1 ? row.pct.toFixed(0) : '<1'}%
              </span>
              <select
                value={row.finish}
                onChange={(e) => onFinishChange(row.id, e.target.value as FinishName)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontSize: '11px', border: '1px solid #E5E7EB',
                  borderRadius: '4px', color: '#374151', flexShrink: 0,
                }}
              >
                {FINISHES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisible(row.id);
                }}
                style={{
                  padding: '2px', background: 'none', border: 'none',
                  cursor: 'pointer', color: '#6B7280', flexShrink: 0,
                }}
                title={row.visible ? 'hide' : 'show'}
              >
                {row.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LayerPanel;
