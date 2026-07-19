import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brush, Camera, Download, MousePointer, RotateCcw, Undo2, Upload } from 'lucide-react';

import BackgroundPicker from './components/BackgroundPicker';
import ColorPicker from './components/ColorPicker';
import FileUpload from './components/FileUpload';
import LayerPanel, { LayerRow } from './components/LayerPanel';
import ModelInfo from './components/ModelInfo';
import ThreeScene, { RegionRender, ThreeSceneHandle } from './components/ThreeScene';

import { FinishName, ModelData, PatchStyles, SegmentationData } from './types';
import { BACKGROUND_COLORS, PAINT_COLORS } from './utils/constants';
import {
  buildRegions,
  defaultStyles,
  requestSegmentation,
  rootsAtCut,
} from './utils/segmentation';
import { loadSTLFile } from './utils/stlLoader';

const UNPAINTED = '#b9b9b9';
const MAX_SLIDER_REGIONS = 60;
const UNDO_LIMIT = 50;

/** distinct muted colors so unpainted regions are visibly separate */
const autoTintColor = (i: number) => `hsl(${(i * 137.508) % 360}, 42%, 63%)`;

type SegStatus =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; seconds: number }
  | { kind: 'error'; message: string };

const App: React.FC = () => {
  const [modelData, setModelData] = useState<ModelData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [seg, setSeg] = useState<SegmentationData | null>(null);
  const [segStatus, setSegStatus] = useState<SegStatus>({ kind: 'idle' });
  const [styles, setStyles] = useState<PatchStyles | null>(null);
  const [regionCount, setRegionCount] = useState(12);
  const [names, setNames] = useState<Record<number, string>>({});
  const [selectedRegion, setSelectedRegion] = useState<number | null>(null);
  const [activeColor, setActiveColor] = useState<string>(PAINT_COLORS[0]);
  const [activeFinish, setActiveFinish] = useState<FinishName>('matte');
  const [mode, setMode] = useState<'paint' | 'inspect'>('paint');
  const [autoTint, setAutoTint] = useState(true);
  const [backgroundColor, setBackgroundColor] = useState<number>(
    BACKGROUND_COLORS[0].color
  );
  const undoStack = useRef<PatchStyles[]>([]);
  const sceneHandle = useRef<ThreeSceneHandle>(null);

  const handleFileUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    setSeg(null);
    setStyles(null);
    setNames({});
    setSelectedRegion(null);
    undoStack.current = [];
    try {
      const data = await loadSTLFile(file);
      setModelData(data);
    } catch (err) {
      alert(`Could not read ${file.name}: ${err}`);
      setIsLoading(false);
      return;
    }
    setIsLoading(false);

    setSegStatus({ kind: 'running' });
    try {
      const result = await requestSegmentation(file);
      setSeg(result);
      setStyles(defaultStyles(result.nPatches));
      setRegionCount(result.suggestedRegions);
      setSegStatus({ kind: 'done', seconds: result.elapsedSeconds });
    } catch (err: any) {
      setSegStatus({
        kind: 'error',
        message:
          err?.message === 'Failed to fetch'
            ? 'segmentation backend not reachable — run backend/start_backend.sh'
            : String(err?.message || err),
      });
    }
  }, []);

  const roots = useMemo(
    () => (seg ? rootsAtCut(seg, regionCount) : null),
    [seg, regionCount]
  );

  const triRegion = useMemo(() => {
    if (!seg || !roots) return null;
    const out = new Int32Array(seg.basePatch.length);
    for (let t = 0; t < seg.basePatch.length; t++) {
      out[t] = roots[seg.basePatch[t]];
    }
    return out;
  }, [seg, roots]);

  const regions = useMemo(
    () => (seg && roots && styles ? buildRegions(seg, roots, styles) : []),
    [seg, roots, styles]
  );

  const regionRenders: RegionRender[] = useMemo(
    () =>
      regions.map((r, i) => ({
        id: r.id,
        displayColor:
          r.color ?? (autoTint ? autoTintColor(i) : UNPAINTED),
        finish: r.finish,
        visible: r.visible,
      })),
    [regions, autoTint]
  );

  const layerRows: LayerRow[] = useMemo(() => {
    const total = modelData?.triCount || 1;
    return regions.map((r, i) => ({
      id: r.id,
      name: names[r.id] || `Region ${i + 1}`,
      swatch: r.color ?? (autoTint ? autoTintColor(i) : UNPAINTED),
      painted: r.color != null,
      finish: r.finish,
      visible: r.visible,
      pct: (100 * r.triCount) / total,
    }));
  }, [regions, names, autoTint, modelData]);

  const pushUndo = useCallback(() => {
    if (!styles) return;
    undoStack.current.push({
      color: [...styles.color],
      finish: [...styles.finish],
      visible: [...styles.visible],
    });
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
  }, [styles]);

  const applyToRegion = useCallback(
    (regionId: number, fn: (s: PatchStyles, patch: number) => void) => {
      const region = regions.find((r) => r.id === regionId);
      if (!region || !styles) return;
      const next: PatchStyles = {
        color: [...styles.color],
        finish: [...styles.finish],
        visible: [...styles.visible],
      };
      region.patches.forEach((p) => fn(next, p));
      setStyles(next);
    },
    [regions, styles]
  );

  const handlePickRegion = useCallback(
    (regionId: number | null) => {
      setSelectedRegion(regionId);
      if (regionId == null || mode !== 'paint') return;
      pushUndo();
      applyToRegion(regionId, (s, p) => {
        s.color[p] = activeColor;
        s.finish[p] = activeFinish;
      });
    },
    [mode, activeColor, activeFinish, pushUndo, applyToRegion]
  );

  const handleSelectRow = useCallback((id: number) => setSelectedRegion(id), []);

  const handleToggleVisible = useCallback(
    (id: number) => {
      const region = regions.find((r) => r.id === id);
      if (!region) return;
      const target = !region.visible;
      applyToRegion(id, (s, p) => {
        s.visible[p] = target;
      });
    },
    [regions, applyToRegion]
  );

  const handleFinishChange = useCallback(
    (id: number, finish: FinishName) => {
      pushUndo();
      applyToRegion(id, (s, p) => {
        s.finish[p] = finish;
      });
    },
    [pushUndo, applyToRegion]
  );

  const handleUndo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) setStyles(prev);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo]);

  const handleResetColors = useCallback(() => {
    if (!seg) return;
    pushUndo();
    setStyles(defaultStyles(seg.nPatches));
  }, [seg, pushUndo]);

  const handleScreenshot = useCallback(() => {
    const url = sceneHandle.current?.captureScreenshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${modelData?.name || 'mini'}-painted.png`;
    a.click();
  }, [modelData]);

  const handleExportScheme = useCallback(() => {
    if (!styles || !seg) return;
    const blob = new Blob(
      [JSON.stringify({
        version: 1,
        nPatches: seg.nPatches,
        regionCount,
        styles,
        names,
      })],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${modelData?.name || 'mini'}-scheme.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [styles, seg, regionCount, names, modelData]);

  const maxRegions = seg ? Math.min(seg.nPatches, MAX_SLIDER_REGIONS) : 1;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #E0E7FF 0%, #F3E8FF 50%, #FCE7F3 100%)',
        padding: '20px',
      }}
    >
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1
            style={{
              fontSize: '40px', fontWeight: 800, color: '#1F2937', marginBottom: '4px',
              textShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            3D Miniature Painter
          </h1>
          <p style={{ fontSize: '16px', color: '#6B7280', fontWeight: 500 }}>
            Upload an STL — it splits into paintable regions automatically
          </p>
        </div>

        <div
          style={{
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            gap: '16px', marginBottom: '20px', flexWrap: 'wrap',
          }}
        >
          <FileUpload onFileUpload={handleFileUpload} isLoading={isLoading} />
          {segStatus.kind === 'running' && (
            <span data-testid="seg-status" style={{ color: '#6B7280', fontSize: '14px' }}>
              ⏳ segmenting…
            </span>
          )}
          {segStatus.kind === 'done' && (
            <span data-testid="seg-status" style={{ color: '#059669', fontSize: '14px' }}>
              ✓ segmented in {segStatus.seconds}s
            </span>
          )}
          {segStatus.kind === 'error' && (
            <span data-testid="seg-status" style={{ color: '#DC2626', fontSize: '14px' }}>
              ⚠ {segStatus.message}
            </span>
          )}
        </div>

        {modelData ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: '24px' }}>
            <div>
              <div
                style={{
                  background: 'white', borderRadius: '16px', padding: '20px',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                }}
              >
                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px',
                  }}
                >
                  <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937' }}>
                    {modelData.name}
                  </h2>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <ToolButton
                      active={mode === 'paint'}
                      onClick={() => setMode('paint')}
                      title="click a part to paint it"
                    >
                      <Brush size={15} /> Paint
                    </ToolButton>
                    <ToolButton
                      active={mode === 'inspect'}
                      onClick={() => setMode('inspect')}
                      title="click a part to select without painting"
                    >
                      <MousePointer size={15} /> Inspect
                    </ToolButton>
                    <ToolButton onClick={handleUndo} title="undo (Ctrl+Z)">
                      <Undo2 size={15} />
                    </ToolButton>
                    <ToolButton onClick={handleResetColors} title="clear all paint">
                      <RotateCcw size={15} />
                    </ToolButton>
                    <ToolButton onClick={handleScreenshot} title="save PNG">
                      <Camera size={15} />
                    </ToolButton>
                    <ToolButton onClick={handleExportScheme} title="export paint scheme">
                      <Download size={15} />
                    </ToolButton>
                  </div>
                </div>
                <ThreeScene
                  ref={sceneHandle}
                  modelData={modelData}
                  triRegion={triRegion}
                  regions={regionRenders}
                  selectedRegion={selectedRegion}
                  backgroundColor={backgroundColor}
                  onPickRegion={handlePickRegion}
                />
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#9CA3AF' }}>
                  drag to orbit • scroll to zoom • {mode === 'paint'
                    ? 'click a part to paint it'
                    : 'click a part to select it'}
                  <label style={{ marginLeft: '16px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={autoTint}
                      onChange={(e) => setAutoTint(e.target.checked)}
                      style={{ marginRight: '4px' }}
                    />
                    tint unpainted regions
                  </label>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  background: 'white', borderRadius: '16px', padding: '20px',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                }}
              >
                <ColorPicker
                  colors={PAINT_COLORS}
                  selectedColor={activeColor}
                  onColorSelect={setActiveColor}
                  title="Paint color"
                />
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>
                    Finish:
                  </span>
                  {(['matte', 'satin', 'gloss', 'metallic'] as FinishName[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setActiveFinish(f)}
                      style={{
                        fontSize: '12px', padding: '4px 10px', borderRadius: '999px',
                        border: activeFinish === f ? '2px solid #3B82F6' : '1px solid #D1D5DB',
                        background: activeFinish === f ? '#EFF6FF' : 'white',
                        cursor: 'pointer', color: '#374151',
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {seg && styles && (
                <div
                  style={{
                    background: 'white', borderRadius: '16px', padding: '20px',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                  }}
                >
                  <LayerPanel
                    rows={layerRows}
                    selectedRegion={selectedRegion}
                    onSelect={handleSelectRow}
                    onToggleVisible={handleToggleVisible}
                    onFinishChange={handleFinishChange}
                    onRename={(id, name) => setNames((n) => ({ ...n, [id]: name }))}
                    regionCount={regionCount}
                    maxRegions={maxRegions}
                    onRegionCountChange={setRegionCount}
                    suggested={seg.suggestedRegions}
                  />
                </div>
              )}

              <div
                style={{
                  background: 'white', borderRadius: '16px', padding: '20px',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                }}
              >
                <BackgroundPicker
                  selectedBackground={backgroundColor}
                  onBackgroundSelect={setBackgroundColor}
                />
              </div>

              <ModelInfo modelData={modelData} />
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', paddingTop: '48px' }}>
            <div
              style={{
                background: 'white', borderRadius: '16px', padding: '48px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                maxWidth: '500px', margin: '0 auto',
              }}
            >
              <div style={{ color: '#9CA3AF', marginBottom: '16px' }}>
                <Upload size={64} style={{ margin: '0 auto' }} />
              </div>
              <h3 style={{ fontSize: '24px', fontWeight: 700, color: '#374151', marginBottom: '8px' }}>
                No Model Uploaded
              </h3>
              <p style={{ color: '#6B7280', fontSize: '16px' }}>
                Upload an STL file — it will be split into paintable regions
                (armor, weapons, cloth…) automatically
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ToolButton: React.FC<{
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ active, onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      display: 'flex', alignItems: 'center', gap: '4px',
      fontSize: '13px', padding: '6px 10px', borderRadius: '8px',
      border: active ? '2px solid #3B82F6' : '1px solid #D1D5DB',
      background: active ? '#EFF6FF' : 'white',
      cursor: 'pointer', color: '#374151',
    }}
  >
    {children}
  </button>
);

export default App;
