'use client';
import React, { useCallback, useRef, useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAppStore } from '@/store/useAppStore';
import type {
  Annotation, Point, ToolType,
  HighlightAnnotation, FreehandAnnotation,
  CalloutAnnotation, TextAnnotation,
  MeasureDistanceAnnotation, MeasureAreaAnnotation, MeasureCircleAnnotation
} from '@/types';
import { MdChatBubbleOutline, MdMinimize, MdRefresh, MdDelete, MdContentCopy } from 'react-icons/md';
import { ColorPicker } from '@/components/ColorPicker';
import { detectRoomPolygon, detectRoomPolygonHinted, preloadCV } from '@/lib/roomDetection';

interface AnnotationCanvasProps {
  docId: string;
  page: number;
  width: number;
  height: number;
  pdfScale: number;
  onCalibrate?: (start: Point, end: Point) => void;
}

function svgPt(e: React.PointerEvent<SVGSVGElement>, svg: SVGSVGElement): Point {
  const rect = svg.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function dist(a: Point, b: Point) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function polyArea(pts: Point[]) {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area / 2);
}

export function AnnotationCanvas({
  docId, page, width, height, pdfScale, onCalibrate,
}: AnnotationCanvasProps) {
  const {
    activeTool, setActiveTool, setZoom, openDocuments, addAnnotation, addAnnotations, updateAnnotation,
    deleteAnnotation, selectAnnotation, selectAnnotations, deleteSelectedAnnotation, activeColor, activeFillColor, setActiveFillColor, strokeWidth, ocrTransparencyEnabled,
    ocrFontSize, ocrTextColor, ocrBgColor,
  } = useAppStore();

  const doc = openDocuments.find((d) => d.id === docId);
  const annotations: Annotation[] = doc?.annotations[page] ?? [];

  const svgRef = useRef<SVGSVGElement>(null);
  const annotationClickedRef = useRef(false);
  const drawing = useRef<{
    id: string;
    type: ToolType;
    start?: Point;
    points?: Point[];
    end?: Point;
    phase?: number;
  } | null>(null);
  const dragRef = useRef<{ id: string, type: 'rect' | 'point' | 'area-point' | 'dist-point', startPt?: Point, originalRect?: any, pointIndex?: number } | null>(null);
  const selectionRect = useRef<{ start: Point; end: Point } | null>(null);
  const zoomRect = useRef<{ start: Point; end: Point } | null>(null);
  const sprayPoints = useRef<Point[]>([]);
  const roughPoints = useRef<Point[]>([]);
  const lassoPoints = useRef<Point[]>([]);
  const [contextMenu, setContextMenu] = useState<{ annId: string; x: number; y: number } | null>(null);
  const { setHoveredPoint } = useAppStore();
  const [, setTick] = useState(0);

  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrArea, setOcrArea] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const runOCR = async (x: number, y: number, w: number, h: number) => {
    setOcrScanning(true);
    setOcrProgress(0);
    setOcrArea({ x, y, w, h });

    try {
      console.log('📦 Lade Tesseract.js in AnnotationCanvas...');
      const TesseractModule = await import('tesseract.js');
      const Tesseract = (TesseractModule as any).default || TesseractModule;
      
      const svg = svgRef.current;
      const container = svg?.closest('.pdf-page-container');
      const pdfCanvas = container?.querySelector('canvas') as HTMLCanvasElement;
      if (!pdfCanvas) {
        throw new Error('PDF-Seite nicht gefunden');
      }

      // Bestimme den Skalierungsfaktor des Original-Canvas (DPR)
      const rect = pdfCanvas.getBoundingClientRect();
      const canvasDpr = pdfCanvas.width / rect.width;

      // Crop coordinates in screen pixels
      const zoom = doc?.zoom ?? 1.0;
      const screenX = x * zoom;
      const screenY = y * zoom;
      const screenW = w * zoom;
      const screenH = h * zoom;

      // Berücksichtige den DPI-Scale für bessere Erkennung
      const ocrDpr = 3.0;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = screenW * ocrDpr;
      tempCanvas.height = screenH * ocrDpr;
      const tempCtx = tempCanvas.getContext('2d');

      if (tempCtx) {
        tempCtx.fillStyle = 'white';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.scale(ocrDpr, ocrDpr);

        tempCtx.drawImage(
          pdfCanvas,
          screenX * canvasDpr, screenY * canvasDpr,
          screenW * canvasDpr, screenH * canvasDpr,
          0, 0, screenW, screenH
        );
      }

      const result = await Tesseract.recognize(
        tempCanvas,
        'deu+eng',
        {
          logger: (m: any) => {
            if (m.status === 'recognizing text') {
              setOcrProgress(Math.round(m.progress * 100));
            }
          }
        }
      );

      const data = result.data as any;
      const lines = data.lines || [];

      let reconstructedText = "";
      let lastLineBottom = -1;

      lines.forEach((line: any) => {
        const lineText = line.text.replace(/\s+$/g, "");
        if (!lineText.trim()) return;

        const currentLineTop = line.bbox.y0 / ocrDpr;
        const currentLineHeight = (line.bbox.y1 - line.bbox.y0) / ocrDpr;

        if (lastLineBottom !== -1) {
          const gap = currentLineTop - lastLineBottom;
          if (gap > currentLineHeight * 0.80) {
            const numNewLines = Math.max(1, Math.round(gap / (currentLineHeight * 0.9)));
            for (let i = 0; i < numNewLines; i++) {
              reconstructedText += "\n";
            }
          }
        }

        reconstructedText += lineText + "\n";
        lastLineBottom = line.bbox.y1 / ocrDpr;
      });

      let finalAreaText = reconstructedText.trim();
      if (!finalAreaText) {
        finalAreaText = (data.text || "").trim();
      }

      if (!finalAreaText) {
        throw new Error("Kein Text erkannt");
      }

      // Add text annotation to the store for this specific page!
      const annotationId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      const textAnnotation = {
        id: annotationId,
        type: 'text' as const,
        page: page,
        color: ocrTextColor,
        fillColor: ocrBgColor,
        opacity: 1,
        createdAt: Date.now(),
        position: { x, y },
        text: finalAreaText,
        fontSize: ocrFontSize,
        isOcr: true,
        width: w,
        height: Math.max(80, h),
        selected: true
      };

      addAnnotation(docId, page, textAnnotation);
      selectAnnotation(docId, page, annotationId);
      setActiveTool('cursor');

    } catch (error: any) {
      console.error('❌ OCR Fehler:', error);
      alert("OCR fehlgeschlagen: " + (error.message || "Unbekannter Fehler"));
      setActiveTool('cursor');
    } finally {
      setOcrScanning(false);
      setOcrArea(null);
      drawing.current = null;
      rerender();
    }
  };

  const finishAreaMeasurement = useCallback(() => {
    if (activeTool === 'measure-area') {
      const d = drawing.current;
      if (d?.points && d.points.length >= 3) {
        // remove the preview point
        const finalPts = d.points.slice(0, -1);
        const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
        const areaPx = polyArea(finalPts);
        const realArea = areaPx / (scale.pixelsPerUnit ** 2);
        addAnnotation(docId, page, {
          id: d.id, type: 'measure-area', page, color: '#1a73e8', opacity: 1,
          createdAt: Date.now(), points: finalPts,
          displayValue: realArea.toFixed(2), unit: scale.unit,
        } as MeasureAreaAnnotation);
        selectAnnotation(docId, page, d.id);
        drawing.current = null;
        setActiveTool('hand');
        rerender();
      }
    }
  }, [activeTool, addAnnotation, docId, doc, page, rerender, setActiveTool, selectAnnotation]);

  const finishDistanceMeasurement = useCallback(() => {
    if (activeTool === 'measure-distance') {
      const d = drawing.current;
      if (d?.points && d.points.length >= 2) {
        // remove the preview point
        const finalPts = d.points.slice(0, -1);
        const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
        let totalPx = 0;
        for (let i = 0; i < finalPts.length - 1; i++) {
          totalPx += dist(finalPts[i], finalPts[i + 1]);
        }
        const realDist = totalPx / scale.pixelsPerUnit;
        addAnnotation(docId, page, {
          id: d.id, type: 'measure-distance', page, color: '#1a73e8', opacity: 1,
          createdAt: Date.now(), points: finalPts,
          displayValue: realDist.toFixed(2), unit: scale.unit,
        } as MeasureDistanceAnnotation);
        selectAnnotation(docId, page, d.id);
        drawing.current = null;
        setActiveTool('hand');
        rerender();
      }
    }
  }, [activeTool, addAnnotation, docId, doc, page, rerender, setActiveTool, selectAnnotation]);

  const handleSvgKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    if (e.key === 'Enter') {
      finishAreaMeasurement();
      finishDistanceMeasurement();
      return;
    }
    if (e.key === 'Escape') {
      if (drawing.current) {
        if (activeTool === 'measure-area' && (drawing.current.points?.length || 0) >= 3) {
          finishAreaMeasurement();
        } else if (activeTool === 'measure-distance' && (drawing.current.points?.length || 0) >= 2) {
          finishDistanceMeasurement();
        } else {
          drawing.current = null;
          rerender();
        }
      }
      return;
    }
  }, [activeTool, finishAreaMeasurement, finishDistanceMeasurement, rerender]);

  const { magZoom } = useAppStore();
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [rawPointerPos, setRawPointerPos] = useState<{ x: number, y: number } | null>(null);
  const [localPointerPos, setLocalPointerPos] = useState<{ x: number, y: number } | null>(null);

  const handleGlobalKeyUp = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === 'l') {
      setShowMagnifier(false);
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (['TEXTAREA', 'INPUT'].includes((document.activeElement as any)?.tagName)) return;

      if (e.key.toLowerCase() === 'l') {
        setShowMagnifier(true);
      }

      if (e.key === '+') {
        if (drawing.current && (activeTool === 'measure-distance' || activeTool === 'measure-area')) {
          const pts = drawing.current.points!;
          const last = pts[pts.length - 1];
          pts.push({ ...last });
          rerender();
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace' || e.key === '-' || e.key === '_') {
        // Point deletion is now handled globally in useKeyboardShortcuts.ts
        // But we still handle "undo" during ACTIVE drawing here
        if (drawing.current && (activeTool === 'measure-distance' || activeTool === 'measure-area')) {
          if ((drawing.current.points?.length || 0) > 2) {
            drawing.current.points!.splice(-2, 1);
            rerender();
            return;
          }
        }
      }
      if (e.key === 'Escape') {
        if (drawing.current) {
          if (activeTool === 'measure-area' && (drawing.current.points?.length || 0) >= 3) {
            finishAreaMeasurement();
          } else if (activeTool === 'measure-distance' && (drawing.current.points?.length || 0) >= 2) {
            finishDistanceMeasurement();
          } else {
            drawing.current = null;
            rerender();
          }
        } else {
          selectAnnotation(docId, page, null);
          if (activeTool === 'cursor' || activeTool === 'cursor-lasso' || activeTool === 'direct-edit') {
            setActiveTool('hand');
          }
          lassoPoints.current = [];
          rerender();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('keyup', handleGlobalKeyUp);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('keyup', handleGlobalKeyUp);
    };
  }, [docId, page, annotations, activeTool, selectAnnotation, setActiveTool, deleteSelectedAnnotation, finishAreaMeasurement, finishDistanceMeasurement, rerender]);

  useEffect(() => {
    const handleClick = (e: PointerEvent) => {
      if (e.button === 2) return;
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', handleClick);
    return () => window.removeEventListener('pointerdown', handleClick);
  }, []);

  const [isDraggingMenuState, setIsDraggingMenuState] = useState(false);
  const menuDragging = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);

  const handleMenuDragStart = (e: React.PointerEvent) => {
    if (!contextMenu) return;
    e.stopPropagation();
    menuDragging.current = { startX: e.clientX, startY: e.clientY, initialX: contextMenu.x, initialY: contextMenu.y };
    setIsDraggingMenuState(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleMenuDragMove = (e: React.PointerEvent) => {
    if (!menuDragging.current || !contextMenu) return;
    const dx = e.clientX - menuDragging.current.startX;
    const dy = e.clientY - menuDragging.current.startY;
    setContextMenu({ ...contextMenu, x: menuDragging.current.initialX + dx, y: menuDragging.current.initialY + dy });
  };

  const handleMenuDragEnd = (e: React.PointerEvent) => {
    menuDragging.current = null;
    setIsDraggingMenuState(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const pointInPolygon = (pt: Point, polygon: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if (((yi > pt.y) !== (yj > pt.y)) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  useEffect(() => {
    const handleAbort = () => {
      drawing.current = null;
      rerender();
    };
    window.addEventListener('abort-annotation', handleAbort);
    drawing.current = null; // Clean up when tool changes
    rerender();
    return () => window.removeEventListener('abort-annotation', handleAbort);
  }, [activeTool, rerender]);

  const getAnnotationBounds = (ann: Annotation): { x: number; y: number; w: number; h: number } | null => {
    const a = ann as any;
    if (a.start && a.end) {
      return { x: Math.min(a.start.x, a.end.x), y: Math.min(a.start.y, a.end.y), w: Math.abs(a.end.x - a.start.x), h: Math.abs(a.end.y - a.start.y) };
    }
    if (a.rect) return { x: a.rect.x, y: a.rect.y, w: a.rect.width, h: a.rect.height };
    if (a.position) return { x: a.position.x, y: a.position.y, w: a.width || 100, h: a.height || 40 };
    if (a.points && a.points.length > 0) {
      const xs = a.points.map((p: Point) => p.x);
      const ys = a.points.map((p: Point) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    return null;
  };

  // ─── Render saved annotations ───
  const renderAnnotations = () =>
    annotations.map((ann) => {
      switch (ann.type) {
        case 'highlight':
          return (
            <rect
              key={ann.id}
              x={ann.rect.x * pdfScale} y={ann.rect.y * pdfScale}
              width={ann.rect.width * pdfScale} height={ann.rect.height * pdfScale}
              fill={ann.color} fillOpacity={ann.opacity}
              stroke={ann.selected ? '#4f8ef7' : 'none'}
              strokeWidth={ann.selected ? 2 : 0}
              style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, ann.id); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, ann.id); }
              }}
              tabIndex={0}
            />
          );

        case 'freehand':
          return (
            <polyline
              key={ann.id}
              points={ann.points.map((p) => `${p.x * pdfScale},${p.y * pdfScale}`).join(' ')}
              fill="none"
              stroke={ann.selected ? '#4f8ef7' : ann.color}
              strokeWidth={ann.selected ? ann.strokeWidth + 2 : ann.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={ann.opacity}
              data-ann-id={ann.id}
              style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, ann.id); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, ann.id); }
              }}
              tabIndex={0}
            />
          );

        case 'callout': {
          const { rect, tailPoint, color, opacity, selected, id, hidden } = ann;
          const isVisible = doc?.annotationsVisible !== false && !hidden;

          if (!isVisible) {
            return (
              <g
                key={id}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  updateAnnotation(docId, page, { ...ann, hidden: false });
                }}
              >
                <circle cx={tailPoint.x * pdfScale} cy={tailPoint.y * pdfScale} r={12} fill="#FFEB3B" stroke="#b0a010" strokeWidth={1} />
                <MdChatBubbleOutline color="#b0a010" size={16} style={{ position: 'absolute', transform: `translate(${tailPoint.x * pdfScale - 8}px, ${tailPoint.y * pdfScale - 8}px)` }} />
              </g>
            );
          }

          return (
            <g key={id}>
              <line
                x1={(rect.x + rect.width / 2) * pdfScale} y1={(rect.y + rect.height / 2) * pdfScale}
                x2={tailPoint.x * pdfScale} y2={tailPoint.y * pdfScale}
                stroke={color} strokeWidth={1.5} strokeOpacity={opacity}
              />
              <rect
                x={rect.x * pdfScale} y={rect.y * pdfScale}
                width={rect.width * pdfScale} height={rect.height * pdfScale}
                fill="rgba(255,250,200,0.97)"
                stroke={selected ? '#4f8ef7' : color}
                strokeWidth={selected ? 2 : 1.5}
                rx={4}
                data-ann-id={id}
                style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
                onPointerDown={(e: any) => {
                  e.stopPropagation();
                  if (activeTool === 'eraser') deleteAnnotation(docId, page, id);
                  else if (activeTool === 'cursor' || activeTool === 'direct-edit') {
                    selectAnnotation(docId, page, id);
                    const svg = svgRef.current;
                    if (svg) {
                      (svg as SVGSVGElement).setPointerCapture(e.pointerId);
                      dragRef.current = { id, type: 'rect', startPt: svgPt(e, svg), originalRect: { ...rect } };
                    }
                  }
                }}
                tabIndex={0}
              />
              <foreignObject x={(rect.x + 1) * pdfScale} y={(rect.y + 1) * pdfScale} width={(rect.width - 2) * pdfScale} height={(rect.height - 2) * pdfScale}>
                <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateAnnotation(docId, page, { ...ann, hidden: true });
                    }}
                    style={{
                      position: 'absolute', top: 2, right: 2,
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#666'
                    }}
                    title="Minimieren"
                  >
                    <MdMinimize size={14} />
                  </button>
                  <textarea
                    value={ann.text}
                    onChange={(e) => updateAnnotation(docId, page, { ...ann, text: e.target.value })}
                    placeholder="Text eingeben…"
                    style={{
                      width: '100%', height: '100%',
                      background: 'transparent', border: 'none', outline: 'none',
                      resize: 'none', fontSize: ann.fontSize, color: '#1a1a1a',
                      paddingTop: 16, paddingLeft: 6, paddingRight: 6, paddingBottom: 6,
                      fontFamily: 'inherit', overflow: 'hidden',
                      cursor: 'text',
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onFocus={() => { if (!ann.selected) selectAnnotation(docId, page, id); }}
                    onBlur={() => { /* removed aggressive auto-delete */ }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') {
                        e.currentTarget.blur();
                        selectAnnotation(docId, page, null);
                      }
                    }}
                  />
                </div>
              </foreignObject>
            </g>
          );
        }

        case 'text':
          return (
            <foreignObject key={ann.id} x={0} y={0} width="100%" height="100%" pointerEvents="none">
              <TextAnnotationComponent
                ann={ann as TextAnnotation}
                docId={docId}
                page={page}
                ocrTransparencyEnabled={ocrTransparencyEnabled}
                svgRef={svgRef}
                pdfScale={pdfScale}
              />
            </foreignObject>
          );

        case 'measure-distance': {
          const { points, displayValue, unit, color, id, selected } = ann as MeasureDistanceAnnotation;
          if (!points || points.length < 2) return null;

          const renderPoints = points.map(p => ({ x: p.x * pdfScale, y: p.y * pdfScale }));
          const pstr = renderPoints.map(p => `${p.x},${p.y}`).join(' ');

          return (
            <g key={id}>
              {/* PERMANENT hit-area for selection */}
              <polyline points={pstr} fill="none" stroke="transparent" strokeWidth={15}
                style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
                onPointerDown={(e) => {
                  if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                  else if (['cursor', 'direct-edit', 'hand'].includes(activeTool as string)) {
                    e.stopPropagation();
                    selectAnnotation(docId, page, id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  selectAnnotation(docId, page, id);
                  setContextMenu({ annId: id, x: e.clientX, y: e.clientY });
                }}
              />

              {/* Clickable segments for point insertion - ONLY when selected */}
              {selected && renderPoints.map((p, i) => {
                if (i === renderPoints.length - 1) return null;
                const next = renderPoints[i + 1];
                return (
                  <line key={`hit-${i}`} x1={p.x} y1={p.y} x2={next.x} y2={next.y}
                    stroke="transparent" strokeWidth={20}
                    style={{ cursor: 'copy' }}
                    onPointerDown={(e) => {
                      if (['cursor', 'direct-edit', 'hand'].includes(activeTool as string)) {
                        e.stopPropagation();
                        const svg = svgRef.current!;
                        const clickPt = svgPt(e as any, svg);
                        const normClickPt = { x: clickPt.x / pdfScale, y: clickPt.y / pdfScale };
                        const newPts = [...points];
                        newPts.splice(i + 1, 0, normClickPt);

                        // Recalculate total distance
                        const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
                        let totalPx = 0;
                        for (let j = 0; j < newPts.length - 1; j++) {
                          totalPx += dist(newPts[j], newPts[j + 1]);
                        }

                        updateAnnotation(docId, page, {
                          ...(ann as any),
                          points: newPts,
                          displayValue: (totalPx / scale.pixelsPerUnit).toFixed(2)
                        } as any);
                        selectAnnotation(docId, page, id);
                      }
                    }}
                  />
                );
              })}

              <polyline points={pstr} fill="none" pointerEvents="none"
                stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? 3 : 2} strokeDasharray="5 3" />

              {renderPoints.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={selected ? 6 : 4} fill={selected ? '#fff' : color}
                  stroke={selected ? '#4f8ef7' : 'none'} strokeWidth={selected ? 2 : 0}
                  style={{ cursor: selected ? 'move' : 'pointer' }}
                  onPointerEnter={() => selected && setHoveredPoint({ docId, page, annId: id, index: i })}
                  onPointerLeave={() => setHoveredPoint(null)}
                  onMouseDown={(e: any) => e.stopPropagation()}
                  onPointerDown={(e: any) => {
                    e.stopPropagation();
                    if (e.altKey) {
                      const newPts = [...points];
                      if (newPts.length > 2) {
                        newPts.splice(i, 1);
                        const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
                        let totalPx = 0;
                        for (let j = 0; j < newPts.length - 1; j++) {
                          totalPx += dist(newPts[j], newPts[j + 1]);
                        }
                        updateAnnotation(docId, page, { ...(ann as any), points: newPts, displayValue: (totalPx / scale.pixelsPerUnit).toFixed(2) } as any);
                      }
                      return;
                    }
                    selectAnnotation(docId, page, id);
                    const svg = svgRef.current;
                    if (svg && (activeTool === 'cursor' || activeTool === 'direct-edit' || activeTool === 'hand')) {
                      (svg as SVGSVGElement).setPointerCapture(e.pointerId);
                      dragRef.current = { id, type: 'dist-point', pointIndex: i };
                    }
                  }}
                />
              ))}
              <text x={renderPoints[renderPoints.length - 1].x} y={renderPoints[renderPoints.length - 1].y - 10} textAnchor="middle" className="measure-label" style={{ pointerEvents: 'none' }}>
                {displayValue} {unit}
              </text>
            </g>
          );
        }

        case 'measure-area': {
          const { points, displayValue, unit, color, id, selected } = ann as MeasureAreaAnnotation;
          if (points.length < 2) return null;
          const pstr = points.map((p) => `${p.x * pdfScale},${p.y * pdfScale}`).join(' ');
          return (
            <g key={id}>
              {/* Transparent background for selection */}
              <polygon points={pstr} fill="transparent" stroke="none"
                style={{ cursor: activeTool === 'hand' ? 'grab' : 'pointer' }}
                onPointerDown={(e) => {
                  if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                  else if (activeTool === 'fill-tool') { e.stopPropagation(); updateAnnotation(docId, page, { ...ann, fillColor: activeFillColor } as any); }
                  else if (['cursor', 'direct-edit', 'hand'].includes(activeTool as string)) { e.stopPropagation(); selectAnnotation(docId, page, id); }
                }}
              />

              {/* Clickable segments for point insertion - ONLY when selected */}
              {selected && points.map((p, i) => {
                const next = points[(i + 1) % points.length];
                return (
                  <line key={`hit-${i}`} x1={p.x * pdfScale} y1={p.y * pdfScale} x2={next.x * pdfScale} y2={next.y * pdfScale}
                    stroke="transparent" strokeWidth={20}
                    style={{ cursor: 'copy' }}
                    onPointerDown={(e) => {
                      if (['cursor', 'direct-edit', 'hand'].includes(activeTool as string)) {
                        e.stopPropagation();
                        const svg = svgRef.current!;
                        const clickPt = svgPt(e as any, svg);
                        const normClickPt = { x: clickPt.x / pdfScale, y: clickPt.y / pdfScale };
                        const newPts = [...points];
                        newPts.splice(i + 1, 0, normClickPt);

                        const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
                        const areaPx = polyArea(newPts);
                        const areaReal = areaPx / (scale.pixelsPerUnit ** 2);

                        updateAnnotation(docId, page, {
                          ...(ann as any),
                          points: newPts,
                          displayValue: areaReal.toFixed(2)
                        } as any);
                        selectAnnotation(docId, page, id);
                      }
                    }}
                  />
                );
              })}

              <polygon points={pstr} fill={ann.fillColor || color} fillOpacity={ann.fillColor ? 0.6 : 0.15}
                data-ann-id={id}
                onContextMenu={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  selectAnnotation(docId, page, id);
                  setContextMenu({ annId: id, x: e.clientX, y: e.clientY });
                }}
                stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? 3 : 2} pointerEvents="none" />

              {points.map((p, i) => (
                <circle key={i} cx={p.x * pdfScale} cy={p.y * pdfScale} r={selected ? 5 : 3} fill={selected ? '#fff' : color}
                  stroke={selected ? '#4f8ef7' : 'none'} strokeWidth={selected ? 2 : 0}
                  style={{ cursor: selected ? 'move' : 'pointer' }}
                  onPointerEnter={() => selected && setHoveredPoint({ docId, page, annId: id, index: i })}
                  onPointerLeave={() => setHoveredPoint(null)}
                  onMouseDown={(e: any) => e.stopPropagation()}
                  onPointerDown={(e: any) => {
                    e.stopPropagation();
                    if (e.altKey) {
                      const newPts = [...points];
                      if (newPts.length > 2) {
                        newPts.splice(i, 1);
                        const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
                        const areaPx = polyArea(newPts);
                        updateAnnotation(docId, page, { ...(ann as any), points: newPts, displayValue: (areaPx / (scale.pixelsPerUnit ** 2)).toFixed(2) } as any);
                      }
                      return;
                    }
                    selectAnnotation(docId, page, id);
                    const svg = svgRef.current;
                    if (svg && (activeTool === 'cursor' || activeTool === 'direct-edit' || activeTool === 'hand')) {
                      (svg as SVGSVGElement).setPointerCapture(e.pointerId);
                      dragRef.current = { id, type: 'area-point', pointIndex: i };
                    }
                  }}
                />
              ))}
              <text x={points.reduce((s, p) => s + p.x, 0) / points.length * pdfScale} y={points.reduce((s, p) => s + p.y, 0) / points.length * pdfScale} textAnchor="middle" className="measure-label" style={{ pointerEvents: 'none' }}>
                {displayValue} {unit}²
              </text>
            </g>
          );
        }

        case 'measure-circle': {
          const { center, radius, displayValue, unit, color, id, selected } = ann as MeasureCircleAnnotation;
          const cx = center.x * pdfScale;
          const cy = center.y * pdfScale;
          const r = radius * pdfScale;
          return (
            <g key={id}>
              <circle cx={cx} cy={cy} r={r} fill={ann.fillColor || color} fillOpacity={ann.fillColor ? 0.6 : 0.1}
                stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? 3 : 2}
                style={{ cursor: activeTool === 'hand' ? 'grab' : 'pointer' }}
                onPointerDown={(e) => {
                  if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                  else if (activeTool === 'fill-tool') { e.stopPropagation(); updateAnnotation(docId, page, { ...ann, fillColor: activeFillColor } as any); }
                  else if (['cursor', 'direct-edit', 'hand'].includes(activeTool as string)) { e.stopPropagation(); selectAnnotation(docId, page, id); }
                }}
                onContextMenu={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  selectAnnotation(docId, page, id);
                  setContextMenu({ annId: id, x: e.clientX, y: e.clientY });
                }}
              />
              <text x={cx} y={cy} textAnchor="middle" className="measure-label" style={{ pointerEvents: 'none' }}>
                {displayValue} {unit}²
              </text>
            </g>
          );
        }

        case 'rect-shape': {
          const { start, end, color, fillColor, id, selected } = ann as any;
          const x = Math.min(start.x, end.x) * pdfScale;
          const y = Math.min(start.y, end.y) * pdfScale;
          const w = Math.abs(end.x - start.x) * pdfScale;
          const h = Math.abs(end.y - start.y) * pdfScale;
          return (
            <rect key={id} data-ann-id={id} x={x} y={y} width={w} height={h}
              fill={fillColor || 'transparent'} stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? 3 : 2}
              style={{ cursor: activeTool === 'eraser' ? 'help' : activeTool === 'fill-tool' ? 'crosshair' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                else if (activeTool === 'fill-tool') { e.stopPropagation(); updateAnnotation(docId, page, { ...ann, fillColor: activeFillColor } as any); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, id); }
              }}
            />
          );
        }

        case 'circle-shape': {
          const { start, end, color, fillColor, id, selected } = ann as any;
          const rx = Math.abs(end.x - start.x) / 2 * pdfScale;
          const ry = Math.abs(end.y - start.y) / 2 * pdfScale;
          const cx = (start.x + end.x) / 2 * pdfScale;
          const cy = (start.y + end.y) / 2 * pdfScale;
          return (
            <ellipse key={id} data-ann-id={id} cx={cx} cy={cy} rx={rx} ry={ry}
              fill={fillColor || 'transparent'} stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? 3 : 2}
              style={{ cursor: activeTool === 'eraser' ? 'help' : activeTool === 'fill-tool' ? 'crosshair' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                else if (activeTool === 'fill-tool') { e.stopPropagation(); updateAnnotation(docId, page, { ...ann, fillColor: activeFillColor } as any); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, id); }
              }}
            />
          );
        }

        case 'line-shape': {
          const { start, end, color, strokeWidth, id, selected } = ann as any;
          return (
            <line key={id} data-ann-id={id} x1={start.x * pdfScale} y1={start.y * pdfScale} x2={end.x * pdfScale} y2={end.y * pdfScale}
              stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth}
              strokeLinecap="round"
              style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, id); }
              }}
            />
          );
        }

        case 'arrow-shape': {
          const { start, end, color, strokeWidth, id, selected } = ann as any;
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const size = 12;
          const p1 = { x: end.x - size * Math.cos(angle - Math.PI / 6), y: end.y - size * Math.sin(angle - Math.PI / 6) };
          const p2 = { x: end.x - size * Math.cos(angle + Math.PI / 6), y: end.y - size * Math.sin(angle + Math.PI / 6) };
          return (
            <g key={id} data-ann-id={id} style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, id); }
              }}>
              <line x1={start.x * pdfScale} y1={start.y * pdfScale} x2={end.x * pdfScale} y2={end.y * pdfScale}
                stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeLinecap="round" />
              <polyline points={`${p1.x * pdfScale},${p1.y * pdfScale} ${end.x * pdfScale},${end.y * pdfScale} ${p2.x * pdfScale},${p2.y * pdfScale}`}
                fill="none" stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        }

        case 'double-arrow-shape': {
          const { start, end, color, strokeWidth, id, selected } = ann as any;
          const s = { x: start.x * pdfScale, y: start.y * pdfScale };
          const e = { x: end.x * pdfScale, y: end.y * pdfScale };
          const angle = Math.atan2(e.y - s.y, e.x - s.x);
          const size = 12;
          const p1 = { x: e.x - size * Math.cos(angle - Math.PI / 6), y: e.y - size * Math.sin(angle - Math.PI / 6) };
          const p2 = { x: e.x - size * Math.cos(angle + Math.PI / 6), y: e.y - size * Math.sin(angle + Math.PI / 6) };
          const p3 = { x: s.x + size * Math.cos(angle - Math.PI / 6), y: s.y + size * Math.sin(angle - Math.PI / 6) };
          const p4 = { x: s.x + size * Math.cos(angle + Math.PI / 6), y: s.y + size * Math.sin(angle + Math.PI / 6) };
          return (
            <g key={id} data-ann-id={id} style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, id); }
              }}>
              <line x1={s.x} y1={s.y} x2={e.x} y2={e.y}
                stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeLinecap="round" />
              <polyline points={`${p1.x},${p1.y} ${e.x},${e.y} ${p2.x},${p2.y}`}
                fill="none" stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={`${p3.x},${p3.y} ${s.x},${s.y} ${p4.x},${p4.y}`}
                fill="none" stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        }

        case 'arrow-dashed': {
          const { start, end, color, strokeWidth, id, selected } = ann as any;
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const size = 12;
          const p1 = { x: end.x - size * Math.cos(angle - Math.PI / 6), y: end.y - size * Math.sin(angle - Math.PI / 6) };
          const p2 = { x: end.x - size * Math.cos(angle + Math.PI / 6), y: end.y - size * Math.sin(angle + Math.PI / 6) };
          return (
            <g key={id} data-ann-id={id} style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, id); }
              }}>
              <line x1={start.x * pdfScale} y1={start.y * pdfScale} x2={end.x * pdfScale} y2={end.y * pdfScale}
                stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeDasharray="8 4" strokeLinecap="round" />
              <polyline points={`${p1.x * pdfScale},${p1.y * pdfScale} ${end.x * pdfScale},${end.y * pdfScale} ${p2.x * pdfScale},${p2.y * pdfScale}`}
                fill="none" stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        }

        case 'arrow-filled': {
          const { start, end, color, strokeWidth, id, selected } = ann as any;
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const size = 16;
          const p1 = { x: end.x - size * Math.cos(angle - Math.PI / 6), y: end.y - size * Math.sin(angle - Math.PI / 6) };
          const p2 = { x: end.x - size * Math.cos(angle + Math.PI / 6), y: end.y - size * Math.sin(angle + Math.PI / 6) };
          return (
            <g key={id} data-ann-id={id} style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, id); }
              }}>
              <line x1={start.x * pdfScale} y1={start.y * pdfScale} x2={end.x * pdfScale} y2={end.y * pdfScale}
                stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(6, strokeWidth + 4) : Math.max(4, strokeWidth + 2)} strokeLinecap="round" />
              <polygon points={`${p1.x * pdfScale},${p1.y * pdfScale} ${end.x * pdfScale},${end.y * pdfScale} ${p2.x * pdfScale},${p2.y * pdfScale}`}
                fill={selected ? '#4f8ef7' : color} />
            </g>
          );
        }

        case 'arrow-measurement': {
          const { start, end, color, strokeWidth, id, selected } = ann as any;
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const size = 12;
          const perp = angle + Math.PI / 2;
          const s1 = { x: start.x + 8 * Math.cos(perp), y: start.y + 8 * Math.sin(perp) };
          const s2 = { x: start.x - 8 * Math.cos(perp), y: start.y - 8 * Math.sin(perp) };
          const e1 = { x: end.x + 8 * Math.cos(perp), y: end.y + 8 * Math.sin(perp) };
          const e2 = { x: end.x - 8 * Math.cos(perp), y: end.y - 8 * Math.sin(perp) };
          const p1 = { x: end.x - size * Math.cos(angle - Math.PI / 6), y: end.y - size * Math.sin(angle - Math.PI / 6) };
          const p2 = { x: end.x - size * Math.cos(angle + Math.PI / 6), y: end.y - size * Math.sin(angle + Math.PI / 6) };
          return (
            <g key={id} data-ann-id={id} style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, id); }
              }}>
              <line x1={start.x * pdfScale} y1={start.y * pdfScale} x2={end.x * pdfScale} y2={end.y * pdfScale}
                stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} />
              <line x1={s1.x * pdfScale} y1={s1.y * pdfScale} x2={s2.x * pdfScale} y2={s2.y * pdfScale} stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? 3 : 2} />
              <line x1={e1.x * pdfScale} y1={e1.y * pdfScale} x2={e2.x * pdfScale} y2={e2.y * pdfScale} stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? 3 : 2} />
              <polyline points={`${p1.x * pdfScale},${p1.y * pdfScale} ${end.x * pdfScale},${end.y * pdfScale} ${p2.x * pdfScale},${p2.y * pdfScale}`}
                fill="none" stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        }

        case 'arrow-zigzag': {
          const { start, end, color, strokeWidth, id, selected } = ann as any;
          const midX = (start.x + end.x) / 2;
          const lastSegAngle = Math.atan2(0, end.x - midX);
          const size = 12;
          const p1 = { x: end.x - size * Math.cos(lastSegAngle - Math.PI / 6), y: end.y - size * Math.sin(lastSegAngle - Math.PI / 6) };
          const p2 = { x: end.x - size * Math.cos(lastSegAngle + Math.PI / 6), y: end.y - size * Math.sin(lastSegAngle + Math.PI / 6) };
          return (
            <g key={id} data-ann-id={id} style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, id); }
              }}>
              <polyline points={`${start.x * pdfScale},${start.y * pdfScale} ${midX * pdfScale},${start.y * pdfScale} ${midX * pdfScale},${end.y * pdfScale} ${end.x * pdfScale},${end.y * pdfScale}`}
                fill="none" stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={`${p1.x * pdfScale},${p1.y * pdfScale} ${end.x * pdfScale},${end.y * pdfScale} ${p2.x * pdfScale},${p2.y * pdfScale}`}
                fill="none" stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        }

        case 'arrow-curved': {
          const { start, end, color, strokeWidth, id, selected } = ann as any;
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const dist = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
          const cp = {
            x: (start.x + end.x) / 2 + Math.sin(angle) * (dist / 4),
            y: (start.y + end.y) / 2 - Math.cos(angle) * (dist / 4)
          };
          const headAngle = Math.atan2(end.y - cp.y, end.x - cp.x);
          const size = 12;
          const p1 = { x: end.x - size * Math.cos(headAngle - Math.PI / 6), y: end.y - size * Math.sin(headAngle - Math.PI / 6) };
          const p2 = { x: end.x - size * Math.cos(headAngle + Math.PI / 6), y: end.y - size * Math.sin(headAngle + Math.PI / 6) };
          return (
            <g key={id} data-ann-id={id} style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                else if (activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, id); }
              }}>
              <path d={`M ${start.x * pdfScale} ${start.y * pdfScale} Q ${cp.x * pdfScale} ${cp.y * pdfScale} ${end.x * pdfScale} ${end.y * pdfScale}`}
                fill="none" stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeLinecap="round" />
              <polyline points={`${p1.x * pdfScale},${p1.y * pdfScale} ${end.x * pdfScale},${end.y * pdfScale} ${p2.x * pdfScale},${p2.y * pdfScale}`}
                fill="none" stroke={selected ? '#4f8ef7' : color} strokeWidth={selected ? Math.max(4, strokeWidth + 2) : strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        }

        case 'arrow-block': {
          const {
            start, end, color, fillColor, id, selected, doubleSided,
            textContent, textColor, textAlign,
            headLength, headWidth, shaftWidth, fontSize
          } = ann as any;
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const len = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
          const hLen = headLength ?? Math.min(len * 0.4, 30);
          const sT = shaftWidth ?? 10;
          const hW = headWidth ?? 25;
          const fS = fontSize ?? 14;
          const actualFill = fillColor || color;

          let pathD = `M 0 ${-sT / 2} L ${len - hLen} ${-sT / 2} L ${len - hLen} ${-hW / 2} L ${len} 0 L ${len - hLen} ${hW / 2} L ${len - hLen} ${sT / 2} L 0 ${sT / 2} Z`;

          if (doubleSided) {
            pathD = `M ${hLen} ${-sT / 2} L ${len - hLen} ${-sT / 2} L ${len - hLen} ${-hW / 2} L ${len} 0 L ${len - hLen} ${hW / 2} L ${len - hLen} ${sT / 2} L ${hLen} ${sT / 2} L ${hLen} ${hW / 2} L 0 0 L ${hLen} ${-hW / 2} Z`;
          }

          let textX = len / 2;
          if (textAlign === 'left') textX = hLen + 10;
          if (textAlign === 'right') textX = len - hLen - 10;

          return (
            <g key={id} data-ann-id={id} transform={`translate(${start.x * pdfScale},${start.y * pdfScale}) rotate(${angle * 180 / Math.PI})`}
              style={{ cursor: activeTool === 'eraser' ? 'help' : 'pointer' }}
              onPointerDown={(e) => {
                if (activeTool === 'eraser') { e.stopPropagation(); deleteAnnotation(docId, page, id); }
                else if (e.button === 2 || activeTool === 'cursor' || activeTool === 'direct-edit') { e.stopPropagation(); selectAnnotation(docId, page, id); }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (activeTool !== 'cursor' && activeTool !== 'direct-edit') {
                  setActiveTool('cursor');
                }
                selectAnnotation(docId, page, id);
                setContextMenu({ annId: id, x: e.clientX, y: e.clientY });
              }}
            >
              <path
                d={pathD}
                fill={selected ? '#4f8ef7' : actualFill} stroke={selected ? 'white' : 'none'} strokeWidth={1} />

              {textContent && (
                <text
                  x={textX}
                  y={0}
                  fill={textColor || (actualFill === '#1a1a1a' ? '#ffffff' : '#1a1a1a')}
                  fontSize={fS}
                  fontWeight="bold"
                  textAnchor={textAlign === 'left' ? 'start' : textAlign === 'right' ? 'end' : 'middle'}
                  dominantBaseline="middle"
                  style={{ pointerEvents: 'none' }}
                >
                  {textContent}
                </text>
              )}
            </g>
          );
        }

        default:
          return null;
      }
    });

  // ─── Live drawing shapes ───
  const renderLive = () => {
    const d = drawing.current;
    if (!d) return null;
    const s = d.start ? { x: d.start.x * pdfScale, y: d.start.y * pdfScale } : null;
    const e = d.end ? { x: d.end.x * pdfScale, y: d.end.y * pdfScale } : null;
    const p = d.points ? d.points.map(pt => ({ x: pt.x * pdfScale, y: pt.y * pdfScale })) : [];

    if (d.type === 'ocr-select' && s && e) {
      const x = Math.min(s.x, e.x);
      const y = Math.min(s.y, e.y);
      const w = Math.abs(e.x - s.x);
      const h = Math.abs(e.y - s.y);
      return <rect x={x} y={y} width={w} height={h} fill="rgba(79, 142, 247, 0.15)" stroke="#4f8ef7" strokeWidth={2} strokeDasharray="4 2" />;
    }
    if (d.type === 'highlight' && s && e) {
      const x = Math.min(s.x, e.x);
      const y = Math.min(s.y, e.y);
      const w = Math.abs(e.x - s.x);
      const h = Math.abs(e.y - s.y);
      return <rect x={x} y={y} width={w} height={h} fill={activeColor} fillOpacity={0.35} />;
    }
    if (d.type === 'freehand' && p && p.length > 1) {
      return (
        <polyline
          points={p.map((pt) => `${pt.x},${pt.y}`).join(' ')}
          fill="none" stroke={activeColor} strokeWidth={strokeWidth}
          strokeLinecap="round" strokeLinejoin="round"
        />
      );
    }
    if (d.type === 'rect-shape' && s && e) {
      const x = Math.min(s.x, e.x);
      const y = Math.min(s.y, e.y);
      const w = Math.abs(e.x - s.x);
      const h = Math.abs(e.y - s.y);
      return <rect x={x} y={y} width={w} height={h} fill={activeFillColor} fillOpacity={0.3} stroke={activeColor} strokeWidth={2} strokeDasharray="4 2" />;
    }
    if (d.type === 'circle-shape' && s && e) {
      const rx = Math.abs(e.x - s.x) / 2;
      const ry = Math.abs(e.y - s.y) / 2;
      const cx = (s.x + e.x) / 2;
      const cy = (s.y + e.y) / 2;
      return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={activeFillColor} fillOpacity={0.3} stroke={activeColor} strokeWidth={2} strokeDasharray="4 2" />;
    }
    if (d.type === 'line-shape' && s && e) {
      return <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={activeColor} strokeWidth={2} strokeDasharray="4 2" />;
    }
    if (d.type === 'arrow-shape' && s && e) {
      const angle = Math.atan2(e.y - s.y, e.x - s.x);
      const size = 12;
      const p1 = { x: e.x - size * Math.cos(angle - Math.PI / 6), y: e.y - size * Math.sin(angle - Math.PI / 6) };
      const p2 = { x: e.x - size * Math.cos(angle + Math.PI / 6), y: e.y - size * Math.sin(angle + Math.PI / 6) };
      return (
        <g>
          <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={activeColor} strokeWidth={2} strokeDasharray="4 2" />
          <polyline points={`${p1.x},${p1.y} ${e.x},${e.y} ${p2.x},${p2.y}`} fill="none" stroke={activeColor} strokeWidth={2} />
        </g>
      );
    }
    if (d.type === 'double-arrow-shape' && s && e) {
      const angle = Math.atan2(e.y - s.y, e.x - s.x);
      const size = 12;
      const p1 = { x: e.x - size * Math.cos(angle - Math.PI / 6), y: e.y - size * Math.sin(angle - Math.PI / 6) };
      const p2 = { x: e.x - size * Math.cos(angle + Math.PI / 6), y: e.y - size * Math.sin(angle + Math.PI / 6) };
      const p3 = { x: s.x + size * Math.cos(angle - Math.PI / 6), y: s.y + size * Math.sin(angle - Math.PI / 6) };
      const p4 = { x: s.x + size * Math.cos(angle + Math.PI / 6), y: s.y + size * Math.sin(angle + Math.PI / 6) };
      return (
        <g>
          <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={activeColor} strokeWidth={2} strokeDasharray="4 2" />
          <polyline points={`${p1.x},${p1.y} ${e.x},${e.y} ${p2.x},${p2.y}`} fill="none" stroke={activeColor} strokeWidth={2} />
          <polyline points={`${p3.x},${p3.y} ${s.x},${s.y} ${p4.x},${p4.y}`} fill="none" stroke={activeColor} strokeWidth={2} />
        </g>
      );
    }
    if (d.type === 'arrow-dashed' && s && e) {
      const angle = Math.atan2(e.y - s.y, e.x - s.x);
      const size = 12;
      const p1 = { x: e.x - size * Math.cos(angle - Math.PI / 6), y: e.y - size * Math.sin(angle - Math.PI / 6) };
      const p2 = { x: e.x - size * Math.cos(angle + Math.PI / 6), y: e.y - size * Math.sin(angle + Math.PI / 6) };
      return (
        <g>
          <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={activeColor} strokeWidth={2} strokeDasharray="8 4" />
          <polyline points={`${p1.x},${p1.y} ${e.x},${e.y} ${p2.x},${p2.y}`} fill="none" stroke={activeColor} strokeWidth={2} />
        </g>
      );
    }
    if (d.type === 'arrow-filled' && s && e) {
      const angle = Math.atan2(e.y - s.y, e.x - s.x);
      const size = 16;
      const p1 = { x: e.x - size * Math.cos(angle - Math.PI / 6), y: e.y - size * Math.sin(angle - Math.PI / 6) };
      const p2 = { x: e.x - size * Math.cos(angle + Math.PI / 6), y: e.y - size * Math.sin(angle + Math.PI / 6) };
      return (
        <g>
          <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={activeColor} strokeWidth={4} />
          <polygon points={`${p1.x},${p1.y} ${e.x},${e.y} ${p2.x},${p2.y}`} fill={activeColor} />
        </g>
      );
    }
    if (d.type === 'arrow-measurement' && s && e) {
      const angle = Math.atan2(e.y - s.y, e.x - s.x);
      const size = 12;
      const perp = angle + Math.PI / 2;
      const s1 = { x: s.x + 8 * Math.cos(perp), y: s.y + 8 * Math.sin(perp) };
      const s2 = { x: s.x - 8 * Math.cos(perp), y: s.y - 8 * Math.sin(perp) };
      const e1 = { x: e.x + 8 * Math.cos(perp), y: e.y + 8 * Math.sin(perp) };
      const e2 = { x: e.x - 8 * Math.cos(perp), y: e.y - 8 * Math.sin(perp) };
      const p1 = { x: e.x - size * Math.cos(angle - Math.PI / 6), y: e.y - size * Math.sin(angle - Math.PI / 6) };
      const p2 = { x: e.x - size * Math.cos(angle + Math.PI / 6), y: e.y - size * Math.sin(angle + Math.PI / 6) };
      return (
        <g>
          <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={activeColor} strokeWidth={2} strokeDasharray="4 2" />
          <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={activeColor} strokeWidth={2} />
          <line x1={e1.x} y1={e1.y} x2={e2.x} y2={e2.y} stroke={activeColor} strokeWidth={2} />
          <polyline points={`${p1.x},${p1.y} ${e.x},${e.y} ${p2.x},${p2.y}`} fill="none" stroke={activeColor} strokeWidth={2} />
        </g>
      );
    }
    if (d.type === 'arrow-zigzag' && s && e) {
      const midX = (s.x + e.x) / 2;
      const lastSegAngle = Math.atan2(0, e.x - midX);
      const size = 12;
      const p1 = { x: e.x - size * Math.cos(lastSegAngle - Math.PI / 6), y: e.y - size * Math.sin(lastSegAngle - Math.PI / 6) };
      const p2 = { x: e.x - size * Math.cos(lastSegAngle + Math.PI / 6), y: e.y - size * Math.sin(lastSegAngle + Math.PI / 6) };
      return (
        <g>
          <polyline points={`${s.x},${s.y} ${midX},${s.y} ${midX},${e.y} ${e.x},${e.y}`}
            fill="none" stroke={activeColor} strokeWidth={2} strokeDasharray="4 2" />
          <polyline points={`${p1.x},${p1.y} ${e.x},${e.y} ${p2.x},${p2.y}`} fill="none" stroke={activeColor} strokeWidth={2} />
        </g>
      );
    }
    if (d.type === 'arrow-curved' && s && e) {
      const cp = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 - 50 };
      const headAngle = Math.atan2(e.y - cp.y, e.x - cp.x);
      const size = 12;
      const p1 = { x: e.x - size * Math.cos(headAngle - Math.PI / 6), y: e.y - size * Math.sin(headAngle - Math.PI / 6) };
      const p2 = { x: e.x - size * Math.cos(headAngle + Math.PI / 6), y: e.y - size * Math.sin(headAngle + Math.PI / 6) };
      return (
        <g>
          <path d={`M ${s.x} ${s.y} Q ${cp.x} ${cp.y} ${e.x} ${e.y}`}
            fill="none" stroke={activeColor} strokeWidth={2} strokeDasharray="4 2" />
          <polyline points={`${p1.x},${p1.y} ${e.x},${e.y} ${p2.x},${p2.y}`} fill="none" stroke={activeColor} strokeWidth={2} />
        </g>
      );
    }
    if (d.type === 'arrow-block' && s && e) {
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      const distVal = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const headLen = Math.min(distVal * 0.4, 30);
      return (
        <g transform={`translate(${s.x},${s.y}) rotate(${angle * 180 / Math.PI})`}>
          <path d={`M 0 -5 L ${distVal - headLen} -5 L ${distVal - headLen} -12 L ${distVal} 0 L ${distVal - headLen} 12 L ${distVal - headLen} 5 L 0 5 Z`}
            fill={activeColor} fillOpacity={0.3} stroke={activeColor} strokeWidth={1} strokeDasharray="2 2" />
        </g>
      );
    }
    if (d.type === 'callout' && s && e) {
      const w = 120 * pdfScale, h = 60 * pdfScale;
      return (
        <g>
          <line
            x1={e.x + w / 2} y1={e.y + h / 2}
            x2={s.x} y2={s.y}
            stroke={activeColor} strokeWidth={1.5} opacity={0.6}
          />
          <rect
            x={e.x} y={e.y}
            width={w} height={h}
            fill="rgba(255,250,200,0.5)"
            stroke={activeColor} strokeWidth={1.5} strokeDasharray="4 2"
            rx={4}
          />
        </g>
      );
    }
    if (d.type === 'text' && s && e) {
      return (
        <rect x={e.x} y={e.y} width={160 * pdfScale} height={40 * pdfScale}
          fill="rgba(255,250,200,0.5)" stroke={activeColor} strokeWidth={1.5} rx={4} />
      );
    }
    if (d.type === 'measure-distance' && p.length > 0) {
      const allPts = [...p];
      const pstr = allPts.map((pt) => `${pt.x},${pt.y}`).join(' ');
      let totalPx = 0;
      const normPts = d.points || [];
      for (let i = 0; i < normPts.length - 1; i++) {
        totalPx += dist(normPts[i], normPts[i + 1]);
      }
      const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
      const totalDisplay = (totalPx / scale.pixelsPerUnit).toFixed(2);
      const lastP = allPts[allPts.length - 1];
      return (
        <g>
          <polyline points={pstr} stroke="#1a73e8" strokeWidth={2} strokeDasharray="5 3" fill="none" />
          {allPts.map((pt, i) => {
            const isLast = i === allPts.length - 1;
            if (isLast) {
              return (
                <g key={i}>
                  <line x1={pt.x - 10} y1={pt.y} x2={pt.x + 10} y2={pt.y} stroke="#1a73e8" strokeWidth={1} />
                  <line x1={pt.x} y1={pt.y - 10} x2={pt.x} y2={pt.y + 10} stroke="#1a73e8" strokeWidth={1} />
                </g>
              );
            }
            return <circle key={i} cx={pt.x} cy={pt.y} r={4} fill="#1a73e8" />;
          })}
          <text x={lastP.x} y={lastP.y - 10} textAnchor="middle" className="measure-label">
            {totalDisplay} {scale.unit}
          </text>
        </g>
      );
    }
    if (d.type === 'measure-calibrate') {
      const st = s;
      const en = e;
      if (!st || !en) return null;
      return (
        <g>
          <line x1={st.x} y1={st.y} x2={en.x} y2={en.y}
            stroke="#1a73e8" strokeWidth={2} strokeDasharray="5 3" />
          <circle cx={st.x} cy={st.y} r={4} fill="#1a73e8" />
          <circle cx={en.x} cy={en.y} r={4} fill="#1a73e8" />
          <text x={(st.x + en.x) / 2} y={(st.y + en.y) / 2 - 6}
            textAnchor="middle" className="measure-label">
            {dist({ x: st.x / pdfScale, y: st.y / pdfScale }, { x: en.x / pdfScale, y: en.y / pdfScale }).toFixed(1)} px
          </text>
        </g>
      );
    }
    if (d.type === 'measure-circle' && s && e) {
      const dVal = dist(s, e);
      const radius = dVal / 2;
      const center = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
      const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
      const realRadius = (radius / pdfScale) / scale.pixelsPerUnit;
      const realArea = Math.PI * (realRadius ** 2);
      return (
        <g>
          <circle cx={center.x} cy={center.y} r={radius} fill="rgba(26, 115, 232, 0.1)" stroke="#1a73e8" strokeWidth={2} strokeDasharray="5 3" />
          <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke="#1a73e8" strokeWidth={1} strokeDasharray="2 2" />
          <text x={center.x} y={center.y - radius - 10} textAnchor="middle" className="measure-label">
            {realArea.toFixed(2)} {scale.unit}²
          </text>
        </g>
      );
    }
    if (d.type === 'measure-area' && p.length > 0) {
      const pstr = p.map((pt) => `${pt.x},${pt.y}`).join(' ');
      return (
        <g>
          <polygon points={pstr} fill="rgba(26, 115, 232, 0.15)" stroke="#1a73e8" strokeWidth={2} strokeDasharray="5 3" />
          {p.map((pt, i) => {
            const isLast = i === p.length - 1;
            if (isLast) {
              return (
                <g key={i}>
                  <line x1={pt.x - 10} y1={pt.y} x2={pt.x + 10} y2={pt.y} stroke="#1a73e8" strokeWidth={1} />
                  <line x1={pt.x} y1={pt.y - 10} x2={pt.x} y2={pt.y + 10} stroke="#1a73e8" strokeWidth={1} />
                </g>
              );
            }
            return <circle key={i} cx={pt.x} cy={pt.y} r={3} fill="#1a73e8" />;
          })}
        </g>
      );
    }
    return null;
  };

  // Render the marquee selection rectangle (separate from renderLive drawing state)
  const renderSelectionRect = () => {
    if (activeTool !== 'cursor' || !selectionRect.current) return null;
    const { start, end } = selectionRect.current;
    const x = Math.min(start.x, end.x) * pdfScale;
    const y = Math.min(start.y, end.y) * pdfScale;
    const w = Math.abs(end.x - start.x) * pdfScale;
    const h = Math.abs(end.y - start.y) * pdfScale;
    return <rect x={x} y={y} width={w} height={h} fill="rgba(79,142,247,0.15)" stroke="#4f8ef7" strokeWidth={1} strokeDasharray="4 2" pointerEvents="none" />;
  };

  // Render the lasso selection polygon
  const renderLassoPolygon = () => {
    if (activeTool !== 'cursor-lasso' || lassoPoints.current.length < 2) return null;
    const pstr = lassoPoints.current.map(p => `${p.x * pdfScale},${p.y * pdfScale}`).join(' ');
    return <polygon points={pstr} fill="rgba(79,142,247,0.15)" stroke="#4f8ef7" strokeWidth={1} strokeDasharray="4 2" pointerEvents="none" />;
  };




  // ─── Pointer event handling ───
  const isAnnotateTool = [
    'highlight', 'freehand', 'callout', 'text',
    'measure-distance', 'measure-area', 'measure-circle', 'measure-magic-area', 'measure-calibrate',
    'zoom-area', 'measure-spray-area', 'measure-rough-area',
    'direct-edit', 'ocr-select',
    'rect-shape', 'circle-shape', 'line-shape', 'arrow-shape', 'double-arrow-shape',
    'arrow-dashed', 'arrow-filled', 'arrow-measurement',
    'arrow-block', 'arrow-curved', 'arrow-zigzag'
  ].includes(activeTool);

  const getCursor = () => {
    if (activeTool === 'hand') return 'inherit';
    if (activeTool === 'direct-edit') return 'cell';
    if (activeTool === 'cursor') return 'default';
    if (activeTool === 'cursor-lasso') return 'crosshair';
    if (activeTool === 'eraser') return 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'black\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.9-9.9c1-1 2.5-1 3.4 0l4.3 4.3c1 1 1 2.5 0 3.4l-9.9 9.9c-1 1-2.5 1-3.4 0Z\'/%3E%3Cpath d=\'M22 21H7\'/%3E%3Cpath d=\'m5 11 9 9\'/%3E%3C/svg%3E") 0 24, auto';
    if (activeTool === 'fill-tool') return 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'black\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m19 11-8-8-8.6 8.6c-1 1-1 2.4 0 3.4l5 5c1 1 2.4 1 3.4 0L19 11Z\'/%3E%3Cpath d=\'m5 21.5 1.7-1.7\'/%3E%3Cpath d=\'M1.3 17.7 3 16\'/%3E%3Cpath d=\'M19.7 11c1.3-1.3 4-3 5-2g-1.5 3c-1 1-2.7 3.5-4 4.8\'/%3E%3Cpath d=\'m5 11 9 9\'/%3E%3C/svg%3E") 0 24, auto';
    if (activeTool === 'measure-magic-area') return 'crosshair';
    if (activeTool === 'zoom-area') return 'crosshair';
    if (activeTool === 'measure-spray-area') return 'none'; // SVG circle IS the cursor
    if (activeTool === 'measure-rough-area') return 'crosshair';
    if (isAnnotateTool) return 'crosshair';
    return 'inherit';
  };

  // Warm up OpenCV.js WASM on mount so first click is instant
  useEffect(() => { preloadCV(); }, []);

  const onPointerDown = useCallback((e: any) => {
    const svg = svgRef.current!;
    const zoom = doc?.zoom ?? 1.0;
    const pt = svgPt(e, svg);
    const normPt = { x: pt.x / zoom, y: pt.y / zoom };
    setRawPointerPos({ x: e.clientX, y: e.clientY });
    setLocalPointerPos({ x: pt.x, y: pt.y });

    if (activeTool === 'cursor' || activeTool === 'cursor-lasso') {
      const clickedEl = (e.target as Element)?.closest('[data-ann-id]');
      if (clickedEl) {
        // Single click on annotation → select it immediately
        const annId = clickedEl.getAttribute('data-ann-id');
        if (annId) selectAnnotation(docId, page, annId);
      } else {
        // Drag on empty space → start selection
        selectAnnotation(docId, page, null);
        if (activeTool === 'cursor-lasso') {
          lassoPoints.current = [normPt];
        } else {
          selectionRect.current = { start: normPt, end: normPt };
        }
        (svg as SVGSVGElement).setPointerCapture(e.pointerId);
        rerender();
      }
      return;
    }

    if (activeTool === 'zoom-area') {
      (svg as SVGSVGElement).setPointerCapture(e.pointerId);
      zoomRect.current = { start: normPt, end: normPt };
      rerender();
      return;
    }

    if (activeTool === 'measure-spray-area') {
      (svg as SVGSVGElement).setPointerCapture(e.pointerId);
      sprayPoints.current = [normPt]; // start the brush path
      rerender();
      return;
    }

    if (activeTool === 'measure-rough-area') {
      (svg as SVGSVGElement).setPointerCapture(e.pointerId);
      roughPoints.current = [normPt];
      rerender();
      return;
    }

    if (activeTool === 'direct-edit') {
      const clickedEl = (e.target as Element)?.closest('[data-ann-id]');
      if (!clickedEl) {
        selectAnnotation(docId, page, null);
      }
      // direct-edit continues to possible point-click detection
    }

    if (activeTool === 'callout') {
      if (!drawing.current) {
        (svg as SVGSVGElement).setPointerCapture(e.pointerId);
        drawing.current = { id: uuidv4(), type: 'callout', start: normPt, end: normPt, phase: 1 };
      } else if (drawing.current.phase === 1) {
        drawing.current.phase = 2;
      }
      rerender();
      return;
    }

    if (activeTool === 'eraser') {
      // Centralized: find annotation under pointer and delete it
      const clickedEl = (e.target as Element)?.closest('[data-ann-id]');
      if (clickedEl) {
        const annId = clickedEl.getAttribute('data-ann-id');
        if (annId) deleteAnnotation(docId, page, annId);
      }
      return;
    }

    if (activeTool === 'measure-magic-area') {
      const container = svg.closest('.pdf-page-container');
      const pdfCanvas = container?.querySelector('canvas') as HTMLCanvasElement;
      if (!pdfCanvas) {
        alert('Fehler: PDF-Seite konnte für die Raumerkennung nicht gelesen werden.');
        return;
      }

      const normPageW = width / pdfScale;
      const normPageH = height / pdfScale;

      // Run OpenCV detection asynchronously
      // Show wait cursor while processing
      const svgEl = svg as SVGSVGElement;
      svgEl.style.cursor = 'wait';

      // Capture the click point and scale info for the async context
      const clickNormPt = { ...normPt };
      const clickDocId = docId;
      const clickPage = page;

      detectRoomPolygon(pdfCanvas, clickNormPt, normPageW, normPageH, {
        rdpEpsilon: 3,
      }).then((res) => {
        svgEl.style.cursor = '';

        if (res && res.points.length >= 3) {
          const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
          const realArea = res.areaPx / (scale.pixelsPerUnit ** 2);
          const newId = uuidv4();

          addAnnotation(clickDocId, clickPage, {
            id: newId,
            type: 'measure-area',
            page: clickPage,
            color: '#1a73e8',
            fillColor: activeFillColor !== 'transparent' ? activeFillColor : '#1a73e8',
            opacity: 1,
            createdAt: Date.now(),
            points: res.points,
            displayValue: realArea.toFixed(2),
            unit: scale.unit,
          } as MeasureAreaAnnotation);

          selectAnnotation(clickDocId, clickPage, newId);
          rerender();
        } else {
          alert(
            'Auto-Raum: Kein geschlossener Raum gefunden.\n\n' +
            'Tipps:\n' +
            '• In die Mitte des Raumes klicken (nicht auf Text oder Linie)\n' +
            '• Zoom etwas erhöhen und erneut versuchen'
          );
        }
      }).catch((err) => {
        svgEl.style.cursor = '';
        console.error('Auto-Raum Fehler:', err);
        alert('Auto-Raum: Fehler bei der OpenCV-Verarbeitung. Bitte erneut versuchen.');
      });

      return;
    }

    if (activeTool === 'measure-distance' || activeTool === 'measure-area' || activeTool === 'measure-circle') {
      if (!drawing.current) {
        (svg as SVGSVGElement).setPointerCapture(e.pointerId);
        drawing.current = { id: uuidv4(), type: activeTool, points: [normPt, normPt], start: normPt, end: normPt };
      } else if (activeTool !== 'measure-circle') {
        const pts = drawing.current.points!;
        pts[pts.length - 1] = normPt; // Finalize current preview
        pts.push(normPt); // Add new potential point
      }
      rerender();
      return;
    }

    if (!isAnnotateTool || activeTool === 'fill-tool') return;

    (svg as SVGSVGElement).setPointerCapture(e.pointerId);
    drawing.current = {
      id: uuidv4(),
      type: activeTool as ToolType,
      start: normPt,
      end: normPt,
      points: activeTool === 'freehand' ? [normPt] : undefined,
    };
    rerender();
  }, [activeTool, isAnnotateTool, doc, docId, page, onCalibrate, setActiveTool, rerender, selectAnnotation]);

  const onPointerMove = useCallback((e: any) => {
    const svg = svgRef.current!;
    const zoom = doc?.zoom ?? 1.0;
    const pt = svgPt(e, svg);
    const normPt = { x: pt.x / zoom, y: pt.y / zoom };
    setRawPointerPos({ x: e.clientX, y: e.clientY });
    setLocalPointerPos({ x: pt.x, y: pt.y });

    if (dragRef.current) {
      const { id, type, startPt, originalRect, pointIndex } = dragRef.current;
      const ann = annotations.find(a => a.id === id);

      if (ann && type === 'rect' && startPt && originalRect && ann.type === 'callout') {
        const dx = normPt.x - startPt.x;
        const dy = normPt.y - startPt.y;
        updateAnnotation(docId, page, {
          ...ann,
          rect: { ...originalRect, x: originalRect.x + dx, y: originalRect.y + dy }
        });
      }

      if (ann && type === 'dist-point' && ann.type === 'measure-distance' && pointIndex !== undefined) {
        const newPts = [...ann.points];
        newPts[pointIndex] = normPt;
        const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
        let totalPx = 0;
        for (let i = 0; i < newPts.length - 1; i++) {
          totalPx += dist(newPts[i], newPts[i + 1]);
        }
        updateAnnotation(docId, page, {
          ...ann,
          points: newPts,
          displayValue: (totalPx / scale.pixelsPerUnit).toFixed(2)
        } as MeasureDistanceAnnotation);
      }

      if (ann && type === 'area-point' && ann.type === 'measure-area' && pointIndex !== undefined) {
        const newPts = [...ann.points];
        newPts[pointIndex] = normPt;
        const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
        const areaPx = polyArea(newPts);
        const areaReal = areaPx / (scale.pixelsPerUnit ** 2);
        updateAnnotation(docId, page, {
          ...ann,
          points: newPts,
          displayValue: areaReal.toFixed(2)
        } as MeasureAreaAnnotation);
      }
      return;
    }

    if (drawing.current && (activeTool === 'measure-distance' || activeTool === 'measure-area')) {
      const pts = drawing.current.points!;
      pts[pts.length - 1] = normPt;
      rerender();
      return;
    }

    if (activeTool === 'zoom-area' && zoomRect.current) {
      zoomRect.current.end = normPt;
      rerender();
      return;
    }

    if (activeTool === 'measure-spray-area') {
      rerender(); // always rerender so cursor circle moves
      if (e.buttons === 1 && sprayPoints.current.length > 0) {
        // Collect smooth path points (min 3px apart in page coords)
        const last = sprayPoints.current[sprayPoints.current.length - 1];
        const minDist = 3 / zoom;
        if (Math.hypot(normPt.x - last.x, normPt.y - last.y) >= minDist) {
          sprayPoints.current.push(normPt);
        }
      }
      return;
    }

    if (activeTool === 'measure-rough-area' && e.buttons === 1 && roughPoints.current.length > 0) {
      const last = roughPoints.current[roughPoints.current.length - 1];
      const dx = normPt.x - last.x, dy = normPt.y - last.y;
      if (dx * dx + dy * dy > 9) {
        roughPoints.current.push(normPt);
        rerender();
      }
      return;
    }

    if (activeTool === 'cursor' && selectionRect.current) {
      selectionRect.current.end = normPt;
      rerender();
      return;
    }

    if (activeTool === 'cursor-lasso' && lassoPoints.current.length > 0) {
      lassoPoints.current.push(normPt);
      rerender();
      return;
    }

    if (activeTool === 'eraser' && e.buttons === 1) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el?.closest('[data-ann-id]');
      if (target) {
        const annId = target.getAttribute('data-ann-id');
        if (annId) deleteAnnotation(docId, page, annId);
      }
    }

    if (!drawing.current) return;
    drawing.current.end = normPt;
    if (activeTool === 'freehand' && drawing.current.points) {
      drawing.current.points.push(normPt);
    }
    rerender();
  }, [activeTool, doc, docId, page, annotations, deleteAnnotation, updateAnnotation, rerender]);

  const onPointerUp = useCallback((e: any) => {
    // ─── Spray/Rough hinted room detection ───────────────────────────────────
    const isHintTool = activeTool === 'measure-spray-area' || activeTool === 'measure-rough-area';
    const hintPts = activeTool === 'measure-spray-area' ? sprayPoints.current : roughPoints.current;
    if (isHintTool && hintPts.length >= 2) {
      const pts = [...hintPts];
      sprayPoints.current = [];
      roughPoints.current = [];
      (svgRef.current as SVGSVGElement)?.releasePointerCapture(e.pointerId);
      rerender();

      const container = svgRef.current?.closest('.pdf-page-container');
      const pdfCanvas = container?.querySelector('canvas') as HTMLCanvasElement | null;
      if (!pdfCanvas) return;

      const normPageW = width / pdfScale;
      const normPageH = height / pdfScale;
      const svgEl = svgRef.current as SVGSVGElement;
      svgEl.style.cursor = 'wait';
      const capturedDocId = docId;
      const capturedPage = page;

      detectRoomPolygonHinted(pdfCanvas, pts, normPageW, normPageH, { rdpEpsilon: 3 })
        .then((res) => {
          svgEl.style.cursor = '';
          if (res && res.points.length >= 3) {
            const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
            const realArea = res.areaPx / (scale.pixelsPerUnit ** 2);
            const newId = uuidv4();
            addAnnotation(capturedDocId, capturedPage, {
              id: newId,
              type: 'measure-area',
              page: capturedPage,
              color: '#1a73e8',
              fillColor: activeFillColor !== 'transparent' ? activeFillColor : '#1a73e8',
              opacity: 1,
              createdAt: Date.now(),
              points: res.points,
              displayValue: realArea.toFixed(2),
              unit: scale.unit,
            } as MeasureAreaAnnotation);
            selectAnnotation(capturedDocId, capturedPage, newId);
            rerender();
          } else {
            alert(
              (activeTool === 'measure-spray-area' ? 'Spray-Raum' : 'Grob-Erkennung') +
              ': Kein Raum gefunden.\n\nTipps:\n• Großzügiger über den Raum ziehen\n• Zoom erhöhen und erneut versuchen'
            );
          }
        })
        .catch((err) => {
          svgEl.style.cursor = '';
          console.error('Hinted-Raum Fehler:', err);
        });
      return;
    }
    if (isHintTool) {
      sprayPoints.current = [];
      roughPoints.current = [];
      (svgRef.current as SVGSVGElement)?.releasePointerCapture(e.pointerId);
      rerender();
      return;
    }

    if (activeTool === 'zoom-area' && zoomRect.current) {
      const zr = zoomRect.current;
      zoomRect.current = null;
      (svgRef.current as SVGSVGElement)?.releasePointerCapture(e.pointerId);
      rerender();

      const w = Math.abs(zr.end.x - zr.start.x);
      const h = Math.abs(zr.end.y - zr.start.y);
      const minX = Math.min(zr.start.x, zr.end.x);
      const minY = Math.min(zr.start.y, zr.end.y);

      const currentZoom = doc?.zoom ?? 1.0;
      const screenW = w * currentZoom;
      const screenH = h * currentZoom;

      const unscaledPageW = width / currentZoom;
      const unscaledPageH = height / currentZoom;

      const svg = svgRef.current;
      const scrollEl = svg?.closest('.canvas-area') || (document.querySelector('.canvas-area') as HTMLElement);
      const clientW = scrollEl?.clientWidth || window.innerWidth;
      const clientH = scrollEl?.clientHeight || window.innerHeight;

      const vw = Math.max(150, clientW - 40);
      const vh = Math.max(150, clientH - 40);

      let targetZoom: number;
      let centerUnscaledX: number;
      let centerUnscaledY: number;

      if (screenW < 6 && screenH < 6) {
        // Single click or tiny drag: zoom in by 1.5x centered on click
        targetZoom = Math.min(10.0, currentZoom * 1.5);
        centerUnscaledX = minX;
        centerUnscaledY = minY;
      } else {
        // Marquee box zoom: fit selected region in viewport
        const zoomW = vw / Math.max(1, w);
        const zoomH = vh / Math.max(1, h);
        targetZoom = Math.min(10.0, Math.max(0.1, Math.min(zoomW, zoomH)));
        centerUnscaledX = minX + w / 2;
        centerUnscaledY = minY + h / 2;
      }

      setZoom(docId, Math.round(targetZoom * 100) / 100);

      // Deterministic target scroll calculation
      const targetPageWidth = unscaledPageW * targetZoom;
      const targetPageHeight = unscaledPageH * targetZoom;

      const pageLeft = Math.max(20, (clientW - targetPageWidth) / 2);
      const pageIndex = Math.max(0, (page || 1) - 1);
      const pageGap = 12;
      const pageTop = 20 + pageIndex * (targetPageHeight + pageGap);

      const targetScrollLeft = Math.max(0, pageLeft + (centerUnscaledX * targetZoom) - clientW / 2);
      const targetScrollTop = Math.max(0, pageTop + (centerUnscaledY * targetZoom) - clientH / 2);

      const performScroll = () => {
        if (scrollEl) {
          scrollEl.scrollTo({
            left: targetScrollLeft,
            top: targetScrollTop,
            behavior: 'smooth'
          });
        }
      };

      requestAnimationFrame(performScroll);
      setTimeout(performScroll, 40);
      setTimeout(performScroll, 120);

      return;
    }

    // Handle marquee selection finish
    if (activeTool === 'cursor' && selectionRect.current) {
      const sr = selectionRect.current;
      const rx1 = Math.min(sr.start.x, sr.end.x);
      const ry1 = Math.min(sr.start.y, sr.end.y);
      const rx2 = Math.max(sr.start.x, sr.end.x);
      const ry2 = Math.max(sr.start.y, sr.end.y);
      const minDrag = 5; // ignore tiny accidental drags
      if (rx2 - rx1 > minDrag || ry2 - ry1 > minDrag) {
        const selectedIds = annotations
          .filter(ann => {
            const b = getAnnotationBounds(ann);
            if (!b) return false;
            // Check if bounding boxes overlap
            return b.x < rx2 && b.x + b.w > rx1 && b.y < ry2 && b.y + b.h > ry1;
          })
          .map(ann => ann.id);
        if (selectedIds.length > 0) {
          selectAnnotations(docId, page, selectedIds);
        }
      }
      selectionRect.current = null;
      (svgRef.current as SVGSVGElement)?.releasePointerCapture(e.pointerId);
      rerender();
      return;
    }

    // Handle lasso selection finish
    if (activeTool === 'cursor-lasso' && lassoPoints.current.length > 0) {
      const pts = lassoPoints.current;
      if (pts.length > 3) {
        const selectedIds = annotations
          .filter(ann => {
            const b = getAnnotationBounds(ann);
            if (!b) return false;
            // Check if any corner of bounding box is inside lasso
            const corners = [
              { x: b.x, y: b.y },
              { x: b.x + b.w, y: b.y },
              { x: b.x, y: b.y + b.h },
              { x: b.x + b.w, y: b.y + b.h },
              { x: b.x + b.w / 2, y: b.y + b.h / 2 } // center
            ];
            return corners.some(c => pointInPolygon(c, pts));
          })
          .map(ann => ann.id);
        if (selectedIds.length > 0) {
          selectAnnotations(docId, page, selectedIds);
        }
      }
      lassoPoints.current = [];
      (svgRef.current as SVGSVGElement)?.releasePointerCapture(e.pointerId);
      rerender();
      return;
    }

    if (dragRef.current) {
      (svgRef.current as SVGSVGElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
      return;
    }

    const d = drawing.current;
    if (!d || !d.start || !d.end) return;

    if (activeTool === 'highlight') {
      const x = Math.min(d.start.x, d.end.x);
      const y = Math.min(d.start.y, d.end.y);
      const w = Math.abs(d.end.x - d.start.x);
      const h = Math.abs(d.end.y - d.start.y);
      if (w > 4 && h > 4) {
        addAnnotation(docId, page, {
          id: d.id, type: 'highlight', page, color: activeColor, opacity: 0.4,
          createdAt: Date.now(), rect: { x, y, width: w, height: h },
        } as HighlightAnnotation);
      }
    } else if (activeTool === 'freehand' && d.points && d.points.length > 2) {
      addAnnotation(docId, page, {
        id: d.id, type: 'freehand', page, color: activeColor, opacity: 1,
        createdAt: Date.now(), points: d.points, strokeWidth,
      } as FreehandAnnotation);
    } else if (activeTool === 'callout') {
      if (d.phase === 1) {
        (svgRef.current as SVGSVGElement).releasePointerCapture(e.pointerId);
        return;
      } else if (d.phase === 2) {
        addAnnotation(docId, page, {
          id: d.id, type: 'callout', page, color: activeColor, opacity: 1,
          createdAt: Date.now(),
          rect: { x: d.end.x, y: d.end.y, width: 160, height: 80 },
          tailPoint: d.start,
          text: '', fontSize: 13,
          hidden: false,
        } as CalloutAnnotation);
        drawing.current = null;
        rerender();
        selectAnnotation(docId, page, d.id);
      }
    } else if (activeTool === 'text') {
      const x = Math.min(d.start.x, d.end.x);
      const y = Math.min(d.start.y, d.end.y);
      const w = Math.abs(d.end.x - d.start.x);
      const h = Math.abs(d.end.y - d.start.y);
      addAnnotation(docId, page, {
        id: d.id, type: 'text', page, color: activeColor, opacity: 1,
        createdAt: Date.now(),
        position: { x, y },
        text: '',
        fontSize: 13,
      } as TextAnnotation);
    } else if (activeTool === 'ocr-select') {
      const x = Math.min(d.start.x, d.end.x);
      const y = Math.min(d.start.y, d.end.y);
      const w = Math.abs(d.end.x - d.start.x);
      const h = Math.abs(d.end.y - d.start.y);

      if (w > 5 && h > 5) {
        runOCR(x, y, w, h);
      } else {
        drawing.current = null;
        setActiveTool('cursor');
        rerender();
      }
      return;
    } else if (activeTool === 'measure-circle') {
      const dVal = dist(d.start, d.end);
      const radius = dVal / 2;
      const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
      const realRadius = radius / scale.pixelsPerUnit;
      const realArea = Math.PI * (realRadius ** 2);
      addAnnotation(docId, page, {
        id: d.id, type: 'measure-circle', page, color: '#1a73e8', opacity: 1,
        createdAt: Date.now(), center: { x: (d.start.x + d.end.x) / 2, y: (d.start.y + d.end.y) / 2 },
        radius: radius, displayValue: realArea.toFixed(2), unit: scale.unit,
      } as MeasureCircleAnnotation);
    } else if (activeTool === 'measure-distance' || activeTool === 'measure-area') {
      // These are multi-click tools. Do NOT nullify drawing.current here.
      // They are finished via DoubleClick or Enter.
      (svgRef.current as SVGSVGElement)?.releasePointerCapture(e.pointerId);
      return;
    } else if (activeTool === 'measure-calibrate') {
      onCalibrate?.(d.start, d.end);
    } else if (activeTool === 'direct-edit') {
      // Point-click OCR logic removed as requested.
      // direct-edit now focuses on selecting/interacting with existing annotations (handled above in onPointerDown/onPointerUp).
    } else if (activeTool === 'rect-shape') {
      const x = Math.min(d.start.x, d.end.x);
      const y = Math.min(d.start.y, d.end.y);
      const w = Math.abs(d.end.x - d.start.x);
      const h = Math.abs(d.end.y - d.start.y);
      addAnnotation(docId, page, {
        id: d.id, type: 'rect-shape', page, color: activeColor, fillColor: activeFillColor,
        opacity: 1, createdAt: Date.now(), start: d.start, end: d.end
      } as any);
    } else if (activeTool === 'circle-shape') {
      addAnnotation(docId, page, {
        id: d.id, type: 'circle-shape', page, color: activeColor, fillColor: activeFillColor,
        opacity: 1, createdAt: Date.now(), start: d.start, end: d.end
      } as any);
    } else if (activeTool === 'line-shape') {
      addAnnotation(docId, page, {
        id: d.id, type: 'line-shape', page, color: activeColor, strokeWidth: strokeWidth || 2,
        opacity: 1, createdAt: Date.now(), start: d.start, end: d.end
      } as any);
    } else if (activeTool === 'arrow-shape') {
      addAnnotation(docId, page, {
        id: d.id, type: 'arrow-shape', page, color: activeColor, strokeWidth: strokeWidth || 2,
        opacity: 1, createdAt: Date.now(), start: d.start, end: d.end
      } as any);
    } else if (activeTool === 'double-arrow-shape') {
      addAnnotation(docId, page, {
        id: d.id, type: 'double-arrow-shape', page, color: activeColor, strokeWidth: strokeWidth || 2,
        opacity: 1, createdAt: Date.now(), start: d.start, end: d.end
      } as any);
    } else if (activeTool === 'arrow-dashed') {
      addAnnotation(docId, page, {
        id: d.id, type: 'arrow-dashed', page, color: activeColor, strokeWidth: strokeWidth || 2,
        opacity: 1, createdAt: Date.now(), start: d.start, end: d.end
      } as any);
    } else if (activeTool === 'arrow-filled') {
      addAnnotation(docId, page, {
        id: d.id, type: 'arrow-filled', page, color: activeColor, strokeWidth: strokeWidth || 2,
        opacity: 1, createdAt: Date.now(), start: d.start, end: d.end
      } as any);
    } else if (activeTool === 'arrow-measurement') {
      addAnnotation(docId, page, {
        id: d.id, type: 'arrow-measurement', page, color: activeColor, strokeWidth: strokeWidth || 2,
        opacity: 1, createdAt: Date.now(), start: d.start, end: d.end
      } as any);
    } else if (activeTool === 'arrow-zigzag') {
      addAnnotation(docId, page, {
        id: d.id, type: 'arrow-zigzag', page, color: activeColor, strokeWidth: strokeWidth || 2,
        opacity: 1, createdAt: Date.now(), start: d.start, end: d.end
      } as any);
    } else if (activeTool === 'arrow-curved') {
      addAnnotation(docId, page, {
        id: d.id, type: 'arrow-curved', page, color: activeColor, strokeWidth: strokeWidth || 2,
        opacity: 1, createdAt: Date.now(), start: d.start, end: d.end
      } as any);
    } else if (activeTool === 'arrow-block') {
      addAnnotation(docId, page, {
        id: d.id, type: 'arrow-block', page, color: activeColor, strokeWidth: strokeWidth || 1,
        opacity: 1, createdAt: Date.now(), start: d.start, end: d.end
      } as any);
    }

    // Auto-select the newly created annotation
    if (d.id) {
      selectAnnotation(docId, page, d.id);
    }

    drawing.current = null;
    rerender();
  }, [activeTool, addAnnotation, docId, page, activeColor, activeFillColor, strokeWidth, doc, onCalibrate]);

  const onDoubleClick = useCallback(() => {
    finishAreaMeasurement();
    finishDistanceMeasurement();
  }, [finishAreaMeasurement, finishDistanceMeasurement]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    const d = drawing.current;
    if (activeTool === 'measure-area' && d?.points && d.points.length >= 3) {
      e.preventDefault();
      finishAreaMeasurement();
    } else if (activeTool === 'measure-distance' && d?.points && d.points.length >= 2) {
      e.preventDefault();
      finishDistanceMeasurement();
    }
  }, [activeTool, finishAreaMeasurement, finishDistanceMeasurement]);

  return (
    <div
      className="annotation-layers-container"
      style={{
        position: 'absolute', top: 0, left: 0,
        width, height,
        pointerEvents: 'none',
        zIndex: 100
      }}
    >
      <svg
        ref={svgRef}
        tabIndex={0}
        className={`annotation-svg-layer ${isAnnotateTool || activeTool === 'cursor' || activeTool === 'direct-edit' || activeTool === 'ocr-select' ? 'interactive' : ''}`}
        width={width} height={height}
        style={{ cursor: getCursor(), pointerEvents: 'auto', zIndex: 50 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setRawPointerPos(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={handleSvgKeyDown}
      >
        {renderAnnotations()}
        {renderLive()}
        {renderSelectionRect()}
        {renderLassoPolygon()}

        {/* ── Spray-Raum: thick brush stroke preview ── */}
        {activeTool === 'measure-spray-area' && (() => {
          const z = doc?.zoom ?? 1.0;
          const STROKE_W = 28; // thick brush stroke in SVG pixels
          // Build SVG path from collected points
          const pathD = sprayPoints.current.length > 1
            ? sprayPoints.current.map((p, i) =>
                `${i === 0 ? 'M' : 'L'}${(p.x * z).toFixed(1)},${(p.y * z).toFixed(1)}`
              ).join(' ')
            : null;
          return (
            <g pointerEvents="none">
              {/* Thick, semi-transparent stroke – the painted area */}
              {pathD && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="rgba(255, 140, 0, 0.38)"
                  strokeWidth={STROKE_W}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {/* Darker outline so the stroke is clearly visible */}
              {pathD && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="rgba(200, 80, 0, 0.60)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {/* Circular cursor indicator – shows brush size */}
              {localPointerPos && (
                <g>
                  <circle
                    cx={localPointerPos.x} cy={localPointerPos.y} r={STROKE_W / 2}
                    fill="rgba(255,100,0,0.06)"
                    stroke="rgba(255,100,0,0.80)" strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                  <line x1={localPointerPos.x - 4} y1={localPointerPos.y}
                        x2={localPointerPos.x + 4} y2={localPointerPos.y}
                        stroke="rgba(255,100,0,0.9)" strokeWidth={1.2} />
                  <line x1={localPointerPos.x} y1={localPointerPos.y - 4}
                        x2={localPointerPos.x} y2={localPointerPos.y + 4}
                        stroke="rgba(255,100,0,0.9)" strokeWidth={1.2} />
                  {sprayPoints.current.length > 3 && (
                    <g transform={`translate(${localPointerPos.x + STROKE_W / 2 + 6}, ${localPointerPos.y - 9})`}>
                      <rect x={0} y={0} width={130} height={18} rx={4} fill="#cc5000" opacity={0.92} />
                      <text x={6} y={13} fill="#fff" fontSize={11} fontWeight={600} fontFamily="system-ui,sans-serif">
                        🎨 Loslassen → Erkennen
                      </text>
                    </g>
                  )}
                </g>
              )}
            </g>
          );
        })()}

        {/* ── Grob-Erkennung: rough outline path preview ── */}
        {activeTool === 'measure-rough-area' && roughPoints.current.length > 1 && (() => {
          const z = doc?.zoom ?? 1.0;
          const d = roughPoints.current.map((p, i) =>
            `${i === 0 ? 'M' : 'L'}${(p.x * z).toFixed(1)},${(p.y * z).toFixed(1)}`
          ).join(' ') + ' Z';
          const cx = roughPoints.current.reduce((s, p) => s + p.x, 0) / roughPoints.current.length * z;
          const cy = roughPoints.current.reduce((s, p) => s + p.y, 0) / roughPoints.current.length * z;
          return (
            <g pointerEvents="none">
              <path d={d}
                fill="rgba(234,67,53,0.12)"
                stroke="#ea4335"
                strokeWidth={2.5}
                strokeDasharray="8 4"
                strokeLinejoin="round"
              />
              <g transform={`translate(${cx - 65}, ${cy - 22})`}>
                <rect x={0} y={0} width={130} height={18} rx={4} fill="#ea4335" opacity={0.9} />
                <text x={6} y={13} fill="#fff" fontSize={11} fontWeight={600} fontFamily="system-ui,sans-serif">
                  ✏️ Loslassen → Erkennen
                </text>
              </g>
            </g>
          );
        })()}
        {activeTool === 'zoom-area' && zoomRect.current && (() => {
          const z = doc?.zoom ?? 1.0;
          const rx = Math.min(zoomRect.current.start.x, zoomRect.current.end.x) * z;
          const ry = Math.min(zoomRect.current.start.y, zoomRect.current.end.y) * z;
          const rw = Math.abs(zoomRect.current.end.x - zoomRect.current.start.x) * z;
          const rh = Math.abs(zoomRect.current.end.y - zoomRect.current.start.y) * z;
          return (
            <g pointerEvents="none">
              <rect
                x={rx} y={ry} width={rw} height={rh}
                fill="rgba(26, 115, 232, 0.18)"
                stroke="#1a73e8"
                strokeWidth={2}
                strokeDasharray="5 5"
              />
              {rw > 40 && rh > 20 && (
                <g transform={`translate(${rx + 6}, ${ry + 18})`}>
                  <rect x={0} y={-13} width={125} height={18} rx={4} fill="#1a73e8" opacity={0.92} />
                  <text x={6} y={0} fill="#ffffff" fontSize={11} fontWeight={600} fontFamily="system-ui, sans-serif">
                    🔍 Bereich zoomen
                  </text>
                </g>
              )}
            </g>
          );
        })()}
      </svg>
      {ocrScanning && ocrArea && (
        <div style={{
          position: 'absolute',
          left: ocrArea.x * pdfScale,
          top: ocrArea.y * pdfScale,
          width: ocrArea.w * pdfScale,
          height: ocrArea.h * pdfScale,
          background: 'rgba(255, 255, 255, 0.75)',
          backdropFilter: 'blur(4px)',
          border: '2px dashed #4f8ef7',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '12px',
          zIndex: 10000,
          boxSizing: 'border-box',
          pointerEvents: 'auto',
        }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#1a73e8', textShadow: '0 1px 2px rgba(255,255,255,0.8)', textAlign: 'center' }}>
            Erkenne Text ({ocrProgress}%)
          </div>
          <div style={{
            width: '80%',
            height: '4px',
            background: 'rgba(0,0,0,0.1)',
            borderRadius: '2px',
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              width: `${ocrProgress}%`,
              background: '#4f8ef7',
              transition: 'width 0.2s ease-out'
            }} />
          </div>
        </div>
      )}
      {(() => {
        if (!showMagnifier || !rawPointerPos || !localPointerPos || !svgRef.current) return null;
        const canvas = svgRef.current.closest('.pdf-page-container')?.querySelector('canvas');
        if (!canvas) return null;
        const magSize = 200;
        const rect = canvas.getBoundingClientRect();
        // Use localPointerPos which is already relative to the SVG/Canvas origin
        const xInCanvas = localPointerPos.x;
        const yInCanvas = localPointerPos.y;
        return (
          <div style={{
            position: 'fixed',
            left: rawPointerPos.x - magSize / 2,
            top: rawPointerPos.y - magSize / 2,
            width: magSize, height: magSize,
            borderRadius: '50%', border: '4px solid #fff',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            background: '#000', overflow: 'hidden',
            zIndex: 100000, pointerEvents: 'none',
          }}>
            <div style={{
              position: 'absolute',
              left: -xInCanvas * magZoom + magSize / 2,
              top: -yInCanvas * magZoom + magSize / 2,
              width: width * magZoom, height: height * magZoom,
              transformOrigin: '0 0',
            }}>
              <canvas
                ref={(node) => {
                  if (node) {
                    const ctx = node.getContext('2d');
                    if (ctx) {
                      node.width = width;
                      node.height = height;
                      ctx.drawImage(canvas as HTMLCanvasElement, 0, 0, width, height);
                    }
                  }
                }}
                style={{ position: 'absolute', top: 0, left: 0, width: width * magZoom, height: height * magZoom, imageRendering: 'pixelated' }}
              />
              <svg
                width={width * magZoom}
                height={height * magZoom}
                style={{
                  position: 'absolute', top: 0, left: 0,
                  transform: `scale(${magZoom})`, transformOrigin: '0 0',
                  pointerEvents: 'none', zIndex: 10
                }}
              >
                {renderAnnotations()}
                {renderLive()}
                {renderSelectionRect()}
                {renderLassoPolygon()}
              </svg>
            </div>
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ width: 1, height: 26, background: 'red', position: 'absolute' }} />
              <div style={{ width: 26, height: 1, background: 'red', position: 'absolute' }} />
            </div>
          </div>
        );
      })()}

      {/* ─── Context Menu ─── */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: '#1e1f24',
            border: '1px solid #3d3e47',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            borderRadius: '8px',
            padding: '12px',
            zIndex: 99999,
            minWidth: '240px',
            pointerEvents: 'auto',
            color: '#e8eaed'
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(() => {
            const currentAnn = annotations.find(a => a.id === contextMenu.annId) as any;
            if (!currentAnn) return null;
            const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' };
            const inputBaseStyle = {
              background: '#2a2b30',
              border: '1px solid #3d3e47',
              borderRadius: '4px',
              padding: '4px 8px',
              color: '#e8eaed',
              fontSize: '12px'
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
                <div
                  onPointerDown={handleMenuDragStart}
                  onPointerMove={handleMenuDragMove}
                  onPointerUp={handleMenuDragEnd}
                  style={{
                    fontWeight: 'bold',
                    borderBottom: '1px solid #3d3e47',
                    paddingBottom: '8px',
                    color: '#fff',
                    fontSize: '14px',
                    cursor: isDraggingMenuState ? 'grabbing' : 'grab',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                  <span>{currentAnn.type.includes('measure') ? 'Messung' : 'Eigenschaften'}</span>
                  <span style={{ fontSize: '10px', color: '#666', fontWeight: 'normal' }}>Ziehen zum Verschieben</span>
                </div>

                {currentAnn.type.includes('measure') && (
                  <div style={{ ...rowStyle, borderBottom: '1px solid #3d3e47', paddingBottom: '10px', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '11px', color: '#9aa0ac' }}>Kalibrieren:</span>
                      <button
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (currentAnn.type === 'measure-distance') {
                            const pts = currentAnn.points;
                            if (pts.length >= 2) {
                              onCalibrate?.(pts[0], pts[pts.length - 1]);
                            }
                          } else {
                            // simple start/end if available
                            onCalibrate?.(currentAnn.start || currentAnn.points?.[0], currentAnn.end || currentAnn.points?.[currentAnn.points.length - 1]);
                          }
                          setContextMenu(null);
                        }}
                        style={{
                          padding: '6px 12px', background: '#4f8ef7', color: '#fff',
                          border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                        }}
                      >
                        Als Referenz für Maßstab nutzen
                      </button>
                    </div>
                  </div>
                )}

                {currentAnn.type.includes('measure') && (
                  <div style={rowStyle}>
                    <span>Modus:</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onPointerDown={(e) => { e.stopPropagation(); updateAnnotation(docId, page, { ...currentAnn, isNegative: false }); }}
                        style={{
                          padding: '4px 10px', borderRadius: '4px', border: 'none',
                          background: currentAnn.isNegative ? '#333' : '#34a853',
                          color: '#fff', cursor: 'pointer', fontWeight: 'bold'
                        }}>
                        + ADD
                      </button>
                      <button
                        onPointerDown={(e) => { e.stopPropagation(); updateAnnotation(docId, page, { ...currentAnn, isNegative: true }); }}
                        style={{
                          padding: '4px 10px', borderRadius: '4px', border: 'none',
                          background: currentAnn.isNegative ? '#ea4335' : '#333',
                          color: '#fff', cursor: 'pointer', fontWeight: 'bold'
                        }}>
                        - SUB
                      </button>
                    </div>
                  </div>
                )}

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={!!currentAnn.doubleSided} onChange={(e) => {
                    updateAnnotation(docId, page, { ...currentAnn, doubleSided: e.target.checked });
                  }} style={{ width: '16px', height: '16px' }} />
                  <span>Doppelpfeil (Beidseitig)</span>
                </label>

                <div style={rowStyle}>
                  <span>Füllfarbe:</span>
                  <div style={{ transform: 'scale(1.1)', transformOrigin: 'right center' }}>
                    <ColorPicker
                      label=""
                      color={currentAnn.fillColor || currentAnn.color}
                      onChange={(c) => updateAnnotation(docId, page, { ...currentAnn, fillColor: c })}
                      allowTransparent={true}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span>Beschriftungstext:</span>
                  <input
                    type="text"
                    value={currentAnn.textContent || ''}
                    placeholder="Hier Text..."
                    style={inputBaseStyle}
                    onChange={(e) => {
                      updateAnnotation(docId, page, { ...currentAnn, textContent: e.target.value });
                    }}
                  />
                </div>

                <div style={rowStyle}>
                  <span>Position:</span>
                  <select
                    value={currentAnn.textAlign || 'center'}
                    style={inputBaseStyle}
                    onChange={(e) => {
                      updateAnnotation(docId, page, { ...currentAnn, textAlign: e.target.value as any });
                    }}
                  >
                    <option value="left">Anfang</option>
                    <option value="center">Mittig</option>
                    <option value="right">Ende</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', borderTop: '1px solid #3d3e47', paddingTop: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#9aa0ac' }}>Spitzenlänge:</span>
                    <input type="number" value={currentAnn.headLength ?? 30} style={inputBaseStyle} onChange={(e) => {
                      updateAnnotation(docId, page, { ...currentAnn, headLength: parseInt(e.target.value) || 0 });
                    }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#9aa0ac' }}>Spitzenbreite:</span>
                    <input type="number" value={currentAnn.headWidth ?? 25} style={inputBaseStyle} onChange={(e) => {
                      updateAnnotation(docId, page, { ...currentAnn, headWidth: parseInt(e.target.value) || 0 });
                    }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#9aa0ac' }}>Linienstärke:</span>
                    <input type="number" value={currentAnn.shaftWidth ?? 10} style={inputBaseStyle} onChange={(e) => {
                      updateAnnotation(docId, page, { ...currentAnn, shaftWidth: parseInt(e.target.value) || 0 });
                    }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#9aa0ac' }}>Textgröße:</span>
                    <input type="number" value={currentAnn.fontSize ?? 14} style={inputBaseStyle} onChange={(e) => {
                      updateAnnotation(docId, page, { ...currentAnn, fontSize: parseInt(e.target.value) || 0 });
                    }} />
                  </div>
                </div>

                <div style={rowStyle}>
                  <span>Textfarbe:</span>
                  <div style={{ transform: 'scale(1.1)', transformOrigin: 'right center' }}>
                    <ColorPicker
                      label=""
                      color={currentAnn.textColor || '#ffffff'}
                      onChange={(c) => updateAnnotation(docId, page, { ...currentAnn, textColor: c })}
                      allowTransparent={false}
                    />
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── External components for stability ───

function TextAnnotationComponent({
  ann, docId, page, ocrTransparencyEnabled, svgRef, pdfScale
}: {
  ann: TextAnnotation;
  docId: string;
  page: number;
  ocrTransparencyEnabled: boolean;
  svgRef: React.RefObject<SVGSVGElement | null>;
  pdfScale: number;
}) {
  const {
    updateAnnotation, selectAnnotation, deleteAnnotation
  } = useAppStore();

  const [copyFeedback, setCopyFeedback] = useState(false);

  const { position, id, selected, isOcr, text, fontSize, width, height, fillColor } = ann;
  const bg = fillColor || (isOcr
    ? (selected ? 'rgba(255, 255, 255, 0.98)' : (ocrTransparencyEnabled ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.95)'))
    : 'rgba(255,255,200,0.95)');
  const border = selected ? '2px solid #4f8ef7' : (isOcr ? '1px solid #4f8ef7' : '1px solid #aaa');
  const color = ann.color || '#1a1a1a';

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const resizeData = useRef<{
    dir: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  const [isDraggingText, setIsDraggingText] = useState(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number } | null>(null);
  const holdTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Re-OCR handle
  const onReOCR = async () => {
    console.log("🔄 Re-OCR gestartet für ID:", id);
    const canvas = document.querySelector(`#page-${page} canvas`) as HTMLCanvasElement;
    if (!canvas || !textareaRef.current) {
      console.error("❌ Canvas oder Textarea nicht gefunden", { canvas: !!canvas, textarea: !!textareaRef.current });
      return;
    }

    const currentWidth = textareaRef.current.offsetWidth;
    const currentHeight = textareaRef.current.offsetHeight;

    try {
      console.log("📦 Lade Tesseract...");
      const TesseractModule = await import('tesseract.js');
      const Tesseract = (TesseractModule as any).default || TesseractModule;

      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;

      const ocrDpr = 3.0;
      tempCanvas.width = currentWidth * ocrDpr;
      tempCanvas.height = currentHeight * ocrDpr;

      tempCtx.fillStyle = 'white';
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      tempCtx.scale(ocrDpr, ocrDpr);

      const rect = canvas.getBoundingClientRect();
      const canvasDpr = canvas.width / rect.width;

      console.log("✂️ Extrahiere Bereich für OCR...", {
        x: ann.position.x, y: ann.position.y,
        w: currentWidth, h: currentHeight,
        pdfScale,
        canvasDpr
      });

      tempCtx.drawImage(
        canvas,
        ann.position.x * pdfScale * canvasDpr, ann.position.y * pdfScale * canvasDpr,
        currentWidth * canvasDpr, currentHeight * canvasDpr,
        0, 0, currentWidth, currentHeight
      );

      console.log("⏳ Tesseract Analyse läuft...");
      const result = await Tesseract.recognize(tempCanvas, 'deu+eng', {
        logger: (m: any) => console.log("⏳ Tesseract:", m.status, Math.round(m.progress * 100) + "%")
      });

      const data = result.data as any;
      const lines = data.lines || [];

      let reconstructedText = "";
      let lastLineBottom = -1;

      lines.forEach((line: any) => {
        const lineText = line.text.replace(/\s+$/g, "");
        if (!lineText.trim()) return;

        const currentLineTop = line.bbox.y0 / ocrDpr;
        const currentLineHeight = (line.bbox.y1 - line.bbox.y0) / ocrDpr;

        if (lastLineBottom !== -1) {
          const gap = currentLineTop - lastLineBottom;
          // Ab 80% Zeilenhöhe wird ein Abstand als Absatz gewertet
          if (gap > currentLineHeight * 0.80) {
            const numNewLines = Math.max(1, Math.round(gap / (currentLineHeight * 0.9)));
            for (let i = 0; i < numNewLines; i++) reconstructedText += "\n";
          }
        }

        reconstructedText += lineText + "\n";
        lastLineBottom = line.bbox.y1 / ocrDpr;
      });

      let finalAreaText = reconstructedText.trim();
      if (!finalAreaText) {
        console.warn("⚠️ Keine Zeilen erkannt, verwende fallback text");
        finalAreaText = (data.text || "").trim();
      }

      if (finalAreaText) {
        console.log("✅ OCR erfolgreich. Textlänge:", finalAreaText.length);
        updateAnnotation(docId, page, {
          ...ann,
          text: finalAreaText,
          width: currentWidth,
          height: currentHeight
        });
      } else {
        console.error("❌ Kein Text erkannt");
      }
    } catch (e) {
      console.error("❌ Re-OCR Fehler:", e);
    }
  };

  // Resizing Logic with stable Pointer Capture
  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (e: PointerEvent) => {
      const state = resizeData.current;
      if (!state) return;

      const dx = (e.clientX - state.startX) / pdfScale;
      const dy = (e.clientY - state.startY) / pdfScale;

      const minW = 40;
      const minH = 20;

      let newX = state.origX;
      let newY = state.origY;
      let newW = state.origW;
      let newH = state.origH;

      if (state.dir.includes('e')) newW = Math.max(minW, state.origW + dx);
      if (state.dir.includes('w')) {
        const potW = state.origW - dx;
        if (potW > minW) {
          newW = potW;
          newX = state.origX + dx;
        }
      }
      if (state.dir.includes('s')) newH = Math.max(minH, state.origH + dy);
      if (state.dir.includes('n')) {
        const potH = state.origH - dy;
        if (potH > minH) {
          newH = potH;
          newY = state.origY + dy;
        }
      }

      updateAnnotation(docId, page, {
        ...ann,
        position: { x: newX, y: newY },
        width: newW,
        height: newH
      });
    };

    const handlePointerUp = () => {
      setIsResizing(null);
      resizeData.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isResizing, ann, docId, page, updateAnnotation]);

  // Drag text annotation logic (1s hold)
  useEffect(() => {
    if (!isDraggingText) return;
    const handlePointerMove = (e: PointerEvent) => {
      const state = dragStartRef.current;
      if (!state) return;
      const dx = (e.clientX - state.clientX) / pdfScale;
      const dy = (e.clientY - state.clientY) / pdfScale;
      updateAnnotation(docId, page, {
        ...ann,
        position: { x: state.startX + dx, y: state.startY + dy }
      });
    };

    const handlePointerUp = () => {
      setIsDraggingText(false);
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDraggingText, ann, docId, page, updateAnnotation, pdfScale]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
    };
  }, []);

  const handleDragPointerDown = (e: React.PointerEvent) => {
    // Only handle left mouse button drag-hold
    if (e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;

    if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);

    holdTimeoutRef.current = setTimeout(() => {
      setIsDraggingText(true);
      dragStartRef.current = {
        clientX: startX,
        clientY: startY,
        startX: ann.position.x,
        startY: ann.position.y
      };

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      
      holdTimeoutRef.current = null;
    }, 1000);

    const cancelHold = (moveEvent: PointerEvent) => {
      const dx = Math.abs(moveEvent.clientX - startX);
      const dy = Math.abs(moveEvent.clientY - startY);
      if (dx > 5 || dy > 5) {
        if (holdTimeoutRef.current) {
          clearTimeout(holdTimeoutRef.current);
          holdTimeoutRef.current = null;
        }
        window.removeEventListener('pointermove', cancelHold);
      }
    };

    const releaseHold = () => {
      if (holdTimeoutRef.current) {
        clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = null;
      }
      window.removeEventListener('pointermove', cancelHold);
      window.removeEventListener('pointerup', releaseHold);
    };

    window.addEventListener('pointermove', cancelHold);
    window.addEventListener('pointerup', releaseHold);
  };

  const handleResizeStart = (dir: string, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    resizeData.current = {
      dir,
      startX: e.clientX,
      startY: e.clientY,
      origX: ann.position.x,
      origY: ann.position.y,
      origW: ann.width || 400,
      origH: ann.height || 100
    };

    setIsResizing(dir);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const Handle = ({ dir, style }: { dir: string; style: React.CSSProperties }) => (
    <div
      onPointerDown={(e) => handleResizeStart(dir, e)}
      style={{
        position: 'absolute',
        width: 12,
        height: 12,
        background: '#4f8ef7',
        border: '2px solid white',
        borderRadius: '50%',
        zIndex: 10005,
        pointerEvents: 'auto',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        ...style
      }}
    />
  );

  return (
    <div
      tabIndex={0}
      style={{
        position: 'absolute',
        left: position.x * pdfScale,
        top: position.y * pdfScale,
        zIndex: selected ? 10000 : 5000,
        width: (width || 400) * pdfScale,
        height: (height || 100) * pdfScale,
        pointerEvents: 'auto',
        outline: 'none',
        cursor: isDraggingText ? 'move' : 'default'
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!selected) selectAnnotation(docId, page, id);
        handleDragPointerDown(e);
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        data-ann-id={id}
        value={text}
        onChange={(e) => {
          updateAnnotation(docId, page, { ...ann, text: e.target.value });
        }}
        placeholder="Text eingeben…"
        tabIndex={0}
        style={{
          width: '100%',
          height: '100%',
          background: bg,
          border: border,
          borderRadius: 3,
          outline: 'none',
          resize: 'none',
          fontSize: (fontSize || 13) * pdfScale,
          color: color,
          padding: isOcr ? `${25 * pdfScale}px ${6 * pdfScale}px ${6 * pdfScale}px ${6 * pdfScale}px` : `${6 * pdfScale}px`,
          fontFamily: 'Arial, sans-serif',
          cursor: isDraggingText ? 'move' : 'text',
          pointerEvents: isDraggingText ? 'none' : 'auto',
          whiteSpace: 'pre-wrap',
          overflow: 'auto',
          display: 'block',
          lineHeight: 1.2,
          boxSizing: 'border-box',
          transition: 'background 0.15s ease-out'
        }}
        onClick={(e) => {
          e.stopPropagation();
          selectAnnotation(docId, page, id);
        }}
        onFocus={() => {
          if (!selected) selectAnnotation(docId, page, id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            (e.target as HTMLElement).blur();
            selectAnnotation(docId, page, null);
          }
        }}
      />

      {selected && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 6,
          paddingBottom: 6,
          pointerEvents: 'none',
          zIndex: 10001
        }}>
          <div style={{ display: 'flex', gap: 4, pointerEvents: 'auto' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteAnnotation(docId, page, id);
              }}
              style={{
                background: '#ff4d4d',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 8px',
                cursor: 'pointer',
                color: '#fff',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontWeight: 500,
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
              }}
              title="Löschen (Entf)"
            >
              <MdDelete size={12} />
              <span>Löschen</span>
            </button>

            {isOcr && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReOCR();
                }}
                style={{
                  background: '#4f8ef7',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  cursor: 'pointer',
                  color: '#fff',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontWeight: 500,
                  boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                }}
                title="Erneut analysieren"
              >
                <MdRefresh size={12} />
                <span>Re-OCR</span>
              </button>
            )}
          </div>

          <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ColorPicker
              label=""
              color={fillColor || (isOcr ? '#ffffff' : '#ffffc8')}
              onChange={(c) => updateAnnotation(docId, page, { ...ann, fillColor: c })}
              allowTransparent={true}
            />
          </div>

          <div style={{ pointerEvents: 'auto' }}>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (text) {
                  try {
                    await navigator.clipboard.writeText(text);
                    setCopyFeedback(true);
                    setTimeout(() => setCopyFeedback(false), 2000);
                  } catch (err) {
                    console.error('Copy failed', err);
                  }
                }
              }}
              style={{
                background: '#28a745',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 8px',
                cursor: 'pointer',
                color: '#fff',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontWeight: 500,
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
              }}
              title="In die Zwischenablage kopieren"
            >
              <MdContentCopy size={12} />
              <span>{copyFeedback ? 'Kopiert!' : 'Copy'}</span>
            </button>
          </div>
        </div>
      )}

      {selected && (
        <>
          <Handle dir="nw" style={{ top: -6, left: -6, cursor: 'nwse-resize' }} />
          <Handle dir="n" style={{ top: -6, left: '50%', marginLeft: -6, cursor: 'ns-resize' }} />
          <Handle dir="ne" style={{ top: -6, right: -6, cursor: 'nesw-resize' }} />
          <Handle dir="e" style={{ top: '50%', right: -6, marginTop: -6, cursor: 'ew-resize' }} />
          <Handle dir="se" style={{ bottom: -6, right: -6, cursor: 'nwse-resize' }} />
          <Handle dir="s" style={{ bottom: -6, left: '50%', marginLeft: -6, cursor: 'ns-resize' }} />
          <Handle dir="sw" style={{ bottom: -6, left: -6, cursor: 'nesw-resize' }} />
          <Handle dir="w" style={{ top: '50%', left: -6, marginTop: -6, cursor: 'ew-resize' }} />
        </>
      )}
    </div>
  );
};
