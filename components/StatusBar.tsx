'use client';
import { useAppStore } from '@/store/useAppStore';

interface StatusBarProps {
  activeDocId: string | null;
  cursorPos: { x: number; y: number } | null;
}

export function StatusBar({ activeDocId, cursorPos }: StatusBarProps) {
  const { openDocuments, setZoom, activeTool, setActiveTool } = useAppStore();
  const doc = openDocuments.find((d) => d.id === activeDocId);

  const adjustZoom = (delta: number) => {
    if (!doc) return;
    const newZoom = Math.max(0.1, Math.min(10.0, Math.round((doc.zoom + delta) * 100) / 100));
    setZoom(doc.id, newZoom);
  };

  const handleFitWidth = () => {
    if (!doc) return;
    const canvasArea = document.querySelector('.canvas-area') as HTMLElement;
    const pageEl = canvasArea?.querySelector('.pdf-page-container') as HTMLElement;
    if (!canvasArea || !pageEl) return;
    const currentZoom = doc.zoom;
    const unscaledW = pageEl.clientWidth / currentZoom;
    const containerW = Math.max(200, canvasArea.clientWidth - 48);
    if (unscaledW > 0) {
      setZoom(doc.id, Math.round((containerW / unscaledW) * 100) / 100);
      canvasArea.scrollLeft = 0;
    }
  };

  const handleFitPage = () => {
    if (!doc) return;
    const canvasArea = document.querySelector('.canvas-area') as HTMLElement;
    const pageEl = canvasArea?.querySelector('.pdf-page-container') as HTMLElement;
    if (!canvasArea || !pageEl) return;
    const currentZoom = doc.zoom;
    const unscaledW = pageEl.clientWidth / currentZoom;
    const unscaledH = pageEl.clientHeight / currentZoom;
    const containerW = Math.max(200, canvasArea.clientWidth - 48);
    const containerH = Math.max(200, canvasArea.clientHeight - 48);
    if (unscaledW > 0 && unscaledH > 0) {
      const zoomW = containerW / unscaledW;
      const zoomH = containerH / unscaledH;
      setZoom(doc.id, Math.round(Math.min(zoomW, zoomH) * 100) / 100);
      canvasArea.scrollLeft = 0;
      canvasArea.scrollTop = 0;
    }
  };

  const currentZoomPct = doc ? Math.round(doc.zoom * 100) : 100;

  return (
    <div className="status-bar">
      <div className="status-item" style={{ marginRight: 4 }}>
        <span style={{ color: 'var(--text-secondary)', marginRight: 4 }}>Version:</span>
        <span style={{ fontWeight: 600, color: '#ffffff' }}>v1.0.0</span>
      </div>
      <div className="sep" />

      {doc && (
        <div className="status-item">
          <span>Seite <strong style={{ color: '#ffffff', fontWeight: 600 }}>{doc.currentPage}</strong> von <strong style={{ color: '#ffffff', fontWeight: 600 }}>{doc.pageCount || '?'}</strong></span>
        </div>
      )}

      {doc && (
        <div className="status-item" style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="hud-btn"
            style={{ width: 26, height: 22, padding: 0 }}
            onClick={() => adjustZoom(-0.25)}
            title="Verkleinern"
          >
            -
          </button>

          <div className="zoom-slider-container" style={{ display: 'flex', alignItems: 'center' }}>
            <input
              type="range"
              min="0.1"
              max="10.0"
              step="0.05"
              value={doc.zoom}
              onChange={(e) => setZoom(doc.id, parseFloat(e.target.value))}
              className="zoom-slider"
              title="Zoom-Regler (10% bis 1000%)"
            />
          </div>

          <button
            className="hud-btn"
            style={{ width: 26, height: 22, padding: 0 }}
            onClick={() => adjustZoom(0.25)}
            title="Vergrößern"
          >
            +
          </button>

          <select
            className="hud-select"
            style={{ fontSize: 11, padding: '2px 4px' }}
            value={currentZoomPct}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'fit-width') handleFitWidth();
              else if (val === 'fit-page') handleFitPage();
              else setZoom(doc.id, (parseInt(val) || 100) / 100);
            }}
            title="Zoom-Stufe wählen"
          >
            <option value="25">25%</option>
            <option value="50">50%</option>
            <option value="75">75%</option>
            <option value="100">100%</option>
            <option value="125">125%</option>
            <option value="150">150%</option>
            <option value="200">200%</option>
            <option value="300">300%</option>
            <option value="400">400%</option>
            <option value="500">500%</option>
            <option value="fit-width">Breite</option>
            <option value="fit-page">Seite</option>
            {!['25','50','75','100','125','150','200','300','400','500'].includes(String(currentZoomPct)) && (
              <option value={currentZoomPct}>{currentZoomPct}%</option>
            )}
          </select>

          <button
            className="hud-btn"
            style={{ height: 22, padding: '0 6px', fontSize: 11 }}
            onClick={() => setZoom(doc.id, 1.0)}
            title="100% Originalgröße"
          >
            100%
          </button>

          <button
            className="hud-btn"
            style={{ height: 22, padding: '0 6px', fontSize: 11 }}
            onClick={handleFitWidth}
            title="An Breite anpassen"
          >
            ↔ Breite
          </button>

          <button
            className="hud-btn"
            style={{ height: 22, padding: '0 6px', fontSize: 11 }}
            onClick={handleFitPage}
            title="An Seite anpassen"
          >
            ⛶ Seite
          </button>

          <button
            className={`hud-btn ${activeTool === 'zoom-area' ? 'active' : ''}`}
            style={{ height: 22, padding: '0 6px', fontSize: 11 }}
            onClick={() => setActiveTool(activeTool === 'zoom-area' ? 'cursor' : 'zoom-area')}
            title="Bereich-Zoom (Rechteck-Zoom)"
          >
            🔍 Bereich
          </button>
        </div>
      )}

      <div className="status-item">
        <span style={{ color: 'var(--text-secondary)', marginRight: 4 }}>Werkzeug:</span>
        <span style={{ fontWeight: 600, color: '#4f8ef7' }}>{translateTool(activeTool)}</span>
      </div>

      <div className="status-item" style={{ minWidth: 120 }}>
        {cursorPos ? (
          <span>
            <strong style={{ color: '#ffffff', fontWeight: 600 }}>{Math.round(cursorPos.x)}</strong>,{' '}
            <strong style={{ color: '#ffffff', fontWeight: 600 }}>{Math.round(cursorPos.y)}</strong> px
          </span>
        ) : (
          <span style={{ color: 'var(--text-secondary)' }}>—</span>
        )}
      </div>
      {doc && (
        <>
          <div className="sep" />
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{doc.fileName}</span>
        </>
      )}
    </div>
  );
}

function translateTool(tool: string): string {
  const tools: Record<string, string> = {
    'cursor': 'Auswahl',
    'cursor-lasso': 'Lasso-Auswahl',
    'hand': 'Hand / Pan',
    'highlight': 'Hervorheben',
    'freehand': 'Zeichnen',
    'callout': 'Callout',
    'text': 'Text',
    'measure-distance': 'Abstand',
    'measure-area': 'Fläche',
    'measure-magic-area': 'Auto-Raum',
    'measure-circle': 'Kreis-Fläche',
    'measure-spray-area': 'Spray-Raum',
    'measure-rough-area': 'Grob-Erkennung',
    'measure-calibrate': 'Kalibrieren',
    'zoom-area': 'Bereich-Zoom',
    'direct-edit': 'Direkt-Edit',
    'ocr-select': 'OCR Scannen',
    'eraser': 'Löschen',
    'fill-tool': 'Füllen',
    'rect-shape': 'Rechteck',
    'circle-shape': 'Kreis',
    'line-shape': 'Linie',
    'arrow-shape': 'Pfeil'
  };
  return tools[tool] || tool;
}
