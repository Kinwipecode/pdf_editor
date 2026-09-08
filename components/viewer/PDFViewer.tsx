'use client';
import { useEffect, useRef, useCallback, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { useAppStore } from '@/store/useAppStore';
import { AnnotationCanvas } from '@/components/annotations/AnnotationCanvas';
import { CalibrateDialog } from '@/components/measure/CalibrateDialog';
import type { Point } from '@/types';

interface PDFPageProps {
  pdfDoc: PDFDocumentProxy | null;
  pageNum: number; // logical
  physicalPage: number | string; // original
  zoom: number;
  rotation: number;
  docId: string;
  isActive: boolean;
  activeTool: string;
  fileType: 'pdf' | 'image';
  fileUrl: string;
  onVisibilityChange: (page: number, visible: boolean) => void;
  onCalibrate?: (start: Point, end: Point) => void;
}

function PDFPage({
  pdfDoc, pageNum, physicalPage, zoom, rotation, docId, onVisibilityChange, onCalibrate, activeTool,
  fileType, fileUrl,
}: PDFPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTask = useRef<{ cancel: () => void } | null>(null);
  const [dims, setDims] = useState({ width: 0, height: 0, scale: 1 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new IntersectionObserver(
      ([entry]) => onVisibilityChange(pageNum, entry.isIntersecting),
      { threshold: 0.1 }
    );
    obs.observe(container);
    return () => obs.disconnect();
  }, [pageNum, onVisibilityChange]);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;

    const render = async () => {
      const dpr = window.devicePixelRatio || 1;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d')!;

      // Browser hard limit for canvas dimension (16,384px).
      // Rendering natively at 1:1 device resolution guarantees crystal clear vector text & crisp lines (matching Bild 1).
      const MAX_CANVAS_DIM = 16384;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      if (fileType === 'pdf' && pdfDoc) {
        if (typeof physicalPage !== 'number') {
          // Blank page
          const w = 595; // A4 approx
          const h = 842;
          const scaledW = w * zoom;
          const scaledH = h * zoom;
          const targetW = scaledW * dpr;
          const targetH = scaledH * dpr;
          const maxDim = Math.max(targetW, targetH);
          const ratio = maxDim > MAX_CANVAS_DIM ? MAX_CANVAS_DIM / maxDim : 1.0;

          canvas.width = Math.round(targetW * ratio);
          canvas.height = Math.round(targetH * ratio);
          canvas.style.width = `${scaledW}px`;
          canvas.style.height = `${scaledH}px`;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          setDims({ width: scaledW, height: scaledH, scale: zoom });
          return;
        }

        let page: PDFPageProxy;
        try {
          page = await pdfDoc.getPage(physicalPage);
        } catch { return; }
        if (cancelled) return;

        const targetScale = zoom * dpr;
        const fullViewport = page.getViewport({ scale: targetScale, rotation });
        const cssWidth = fullViewport.width / dpr;
        const cssHeight = fullViewport.height / dpr;

        // Render at 1:1 native vector resolution whenever possible (up to 16,384px)
        const maxDim = Math.max(fullViewport.width, fullViewport.height);
        const bufferRatio = maxDim > MAX_CANVAS_DIM ? MAX_CANVAS_DIM / maxDim : 1.0;

        const renderViewport = bufferRatio === 1.0
          ? fullViewport
          : page.getViewport({ scale: targetScale * bufferRatio, rotation });

        canvas.width = Math.round(renderViewport.width);
        canvas.height = Math.round(renderViewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        setDims({ width: cssWidth, height: cssHeight, scale: zoom });

        renderTask.current?.cancel();
        const task = page.render({ canvasContext: ctx, viewport: renderViewport });
        renderTask.current = task;
        try {
          await task.promise;
        } catch { /* cancelled */ }
        page.cleanup();
      } else if (fileType === 'image' && fileUrl) {
        const img = new Image();
        const isBlobOrDataUrl = fileUrl.startsWith('blob:') || fileUrl.startsWith('data:');
        const isSameOrigin = typeof window !== 'undefined' && 
          (fileUrl.startsWith(window.location.origin) || fileUrl.startsWith('/') || !fileUrl.includes('://'));
        if (!isBlobOrDataUrl && !isSameOrigin) {
          img.crossOrigin = 'anonymous';
        }
        img.src = fileUrl;
        try {
          await img.decode();
          if (cancelled) return;

          // Apply rotation logic manually for image
          const is90 = (rotation / 90) % 2 !== 0;
          const w = is90 ? img.height : img.width;
          const h = is90 ? img.width : img.height;

          const scaledW = w * zoom;
          const scaledH = h * zoom;

          const targetW = scaledW * dpr;
          const targetH = scaledH * dpr;
          const maxDim = Math.max(targetW, targetH);
          const ratio = maxDim > MAX_CANVAS_DIM ? MAX_CANVAS_DIM / maxDim : 1.0;

          const bufW = Math.round(targetW * ratio);
          const bufH = Math.round(targetH * ratio);

          canvas.width = bufW;
          canvas.height = bufH;
          canvas.style.width = `${scaledW}px`;
          canvas.style.height = `${scaledH}px`;

          setDims({ width: scaledW, height: scaledH, scale: zoom });

          ctx.setTransform(bufW / scaledW, 0, 0, bufH / scaledH, 0, 0);
          ctx.clearRect(0, 0, scaledW, scaledH);

          ctx.save();
          ctx.translate(scaledW / 2, scaledH / 2);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.drawImage(img, -img.width * zoom / 2, -img.height * zoom / 2, img.width * zoom, img.height * zoom);
          ctx.restore();
        } catch (err) {
          console.error("Image load error", err);
        }
      }
    };
    render();
    return () => { cancelled = true; renderTask.current?.cancel(); };
  }, [pdfDoc, pageNum, zoom, rotation, fileType, fileUrl]);

  return (
    <div
      ref={containerRef}
      className="pdf-page-container"
      id={`page-${pageNum}`}
      style={{ cursor: 'inherit', position: 'relative' }}
    >
      {/* cursor: inherit lets's parent .pdf-viewer grab/crosshair flow down */}
      <canvas ref={canvasRef} style={{ cursor: 'inherit', display: 'block', position: 'relative', zIndex: 1 }} />
      {dims.width > 0 && (
        <AnnotationCanvas
          docId={docId}
          page={pageNum}
          width={dims.width}
          height={dims.height}
          pdfScale={dims.scale}
          onCalibrate={onCalibrate}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Viewer
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  Viewer
// ─────────────────────────────────────────────
interface PDFViewerProps {
  docId: string;
  onCursorPos: (pos: { x: number; y: number } | null) => void;
}

export function PDFViewer({ docId, onCursorPos }: PDFViewerProps) {
  const { openDocuments, setCurrentPage, setPageCount, setScale, activeTool, setActiveTool, setZoom } = useAppStore();
  const doc = openDocuments.find((d) => d.id === docId);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [calibratePending, setCalibratePending] = useState<{
    start: Point; end: Point; pixelDist: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isHandPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // Helper: actual scrollable container is PARENT (.canvas-area)
  const getScrollEl = useCallback(() => scrollRef.current?.parentElement ?? null, []);

  // Track spacebar for pan tool override
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        if (!spacePressed) setSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [spacePressed]);

  // Load Document
  useEffect(() => {
    if (!doc?.fileUrl) return;
    setPdfError(null);
    if (doc.fileType === 'image') {
      setPdfDoc(null);
      setPageCount(docId, 1);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = (await import('@/lib/pdfWorker')).default;
        console.log('PDF loading started for:', doc.fileUrl);
        const loaded = await pdfjsLib.getDocument({ url: doc.fileUrl }).promise;
        if (cancelled) return;
        setPdfDoc(loaded);
        setPageCount(docId, loaded.numPages);
      } catch (err: any) {
        console.error('PDF Load Error:', err);
        if (!cancelled) {
          setPdfError(err?.message || 'Fehler beim Laden des PDF-Dokuments.');
        }
      }
    })();

    return () => { cancelled = true; setPdfDoc(null); };
  }, [doc?.fileUrl, doc?.fileType, docId, setPageCount]);

  const handleVisibility = useCallback(
    (page: number, visible: boolean) => {
      if (visible) setCurrentPage(docId, page);
    },
    [docId, setCurrentPage]
  );

  const handleCalibrate = useCallback((start: Point, end: Point) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    setCalibratePending({ start, end, pixelDist });
  }, []);

  const applyCalibration = (realValue: number, unit: string) => {
    if (!calibratePending) return;
    setScale(docId, {
      pixelsPerUnit: calibratePending.pixelDist / realValue,
      unit,
    });
    setCalibratePending(null);
    setActiveTool('hand');
  };

  // Scroll to active page on change
  useEffect(() => {
    if (!doc || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`#page-${doc.currentPage}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [doc?.currentPage]);

  // Fit Width helper
  const handleFitWidth = useCallback(() => {
    if (!doc || !scrollRef.current) return;
    const pageEl = scrollRef.current.querySelector('.pdf-page-container') as HTMLElement;
    const scrollEl = getScrollEl();
    if (!pageEl || !scrollEl) return;

    const currentZoom = doc.zoom;
    const unscaledW = pageEl.clientWidth / currentZoom;
    const containerW = Math.max(200, scrollEl.clientWidth - 48);
    if (unscaledW > 0) {
      const fitZoom = Math.max(0.1, Math.min(10.0, Math.round((containerW / unscaledW) * 100) / 100));
      setZoom(docId, fitZoom);
      scrollEl.scrollLeft = 0;
    }
  }, [doc, docId, setZoom, getScrollEl]);

  // Fit Page helper
  const handleFitPage = useCallback(() => {
    if (!doc || !scrollRef.current) return;
    const pageEl = scrollRef.current.querySelector('.pdf-page-container') as HTMLElement;
    const scrollEl = getScrollEl();
    if (!pageEl || !scrollEl) return;

    const currentZoom = doc.zoom;
    const unscaledW = pageEl.clientWidth / currentZoom;
    const unscaledH = pageEl.clientHeight / currentZoom;
    const containerW = Math.max(200, scrollEl.clientWidth - 48);
    const containerH = Math.max(200, scrollEl.clientHeight - 48);

    if (unscaledW > 0 && unscaledH > 0) {
      const zoomW = containerW / unscaledW;
      const zoomH = containerH / unscaledH;
      const fitZoom = Math.max(0.1, Math.min(10.0, Math.round(Math.min(zoomW, zoomH) * 100) / 100));
      setZoom(docId, fitZoom);
      scrollEl.scrollLeft = 0;
      scrollEl.scrollTop = 0;
    }
  }, [doc, docId, setZoom, getScrollEl]);

  // Global Mouse Up / Mouse Move handlers for pan drag stability
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isHandPanning.current) return;
      const scrollEl = getScrollEl();
      if (!scrollEl) return;

      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      scrollEl.scrollLeft = panStart.current.scrollLeft - dx;
      scrollEl.scrollTop = panStart.current.scrollTop - dy;
    };

    const handleGlobalMouseUp = () => {
      if (isHandPanning.current) {
        isHandPanning.current = false;
        setIsPanning(false);
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [getScrollEl]);

  // Hand pan mouse down: trigger on hand tool, spacebar, or middle click (button === 1)
  const onMouseDown = (e: React.MouseEvent) => {
    const isMiddleClick = e.button === 1;
    const isHandMode = activeTool === 'hand' && e.button === 0;
    const isSpaceMode = spacePressed && e.button === 0;

    if (isMiddleClick || isHandMode || isSpaceMode) {
      e.preventDefault();
      const scrollEl = getScrollEl();
      if (!scrollEl) return;
      isHandPanning.current = true;
      setIsPanning(true);
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: scrollEl.scrollLeft,
        scrollTop: scrollEl.scrollTop,
      };
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (activeTool === 'hand' || spacePressed) {
      onCursorPos({ x: e.clientX, y: e.clientY });
    }
  };

  const onMouseLeave = () => {
    onCursorPos(null);
  };

  // Focal-Point Mouse Wheel Zooming
  useEffect(() => {
    const scrollEl = getScrollEl();
    if (!scrollEl) return;

    const handleWheel = (e: WheelEvent) => {
      if (!doc) return;
      // Zoom on Ctrl+Wheel or in Hand mode / Space mode
      const isCtrlWheel = e.ctrlKey || e.metaKey;
      const isHandWheel = activeTool === 'hand' && e.altKey;

      if (isCtrlWheel || isHandWheel) {
        e.preventDefault();
        e.stopPropagation();

        const rect = scrollEl.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const oldZoom = doc.zoom;
        const delta = e.deltaY > 0 ? -0.15 : 0.15;
        const newZoom = Math.max(0.1, Math.min(10.0, Math.round((oldZoom + delta) * 100) / 100));

        if (newZoom !== oldZoom) {
          const scrollLeft = scrollEl.scrollLeft;
          const scrollTop = scrollEl.scrollTop;

          // Focal point calculation: keep location under mouse fixed
          const contentX = scrollLeft + mouseX;
          const contentY = scrollTop + mouseY;

          const ratio = newZoom / oldZoom;
          const newScrollLeft = contentX * ratio - mouseX;
          const newScrollTop = contentY * ratio - mouseY;

          useAppStore.getState().setZoom(docId, newZoom);

          requestAnimationFrame(() => {
            scrollEl.scrollLeft = Math.max(0, newScrollLeft);
            scrollEl.scrollTop = Math.max(0, newScrollTop);
          });
        }
      }
    };

    scrollEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => scrollEl.removeEventListener('wheel', handleWheel);
  }, [docId, doc, activeTool, getScrollEl]);

  if (!doc) return null;

  const isPanningActive = isPanning || isHandPanning.current;
  const cursorStyle =
    isPanningActive ? 'grabbing'
      : (activeTool === 'hand' || spacePressed) ? 'grab'
        : activeTool === 'cursor' ? 'default'
          : activeTool === 'direct-edit' ? 'cell'
            : 'default';

  const currentZoomPct = Math.round(doc.zoom * 100);

  return (
    <>
      <div
        ref={scrollRef}
        className="pdf-viewer"
        style={{
          cursor: cursorStyle,
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        {/* Edit mode indicator banner */}
        {activeTool === 'direct-edit' && (
          <div style={{
            position: 'sticky', top: 8, zIndex: 10,
            display: 'flex', justifyContent: 'center', pointerEvents: 'none',
          }}>
            <span style={{
              background: 'rgba(79,142,247,0.18)', border: '1px solid #4f8ef7',
              borderRadius: 6, padding: '4px 14px', fontSize: 12,
              color: '#4f8ef7', backdropFilter: 'blur(4px)',
            }}>
              ✏️ Direkt-Edit — Wählen Sie vorhandene Notizen oder Markierungen aus, um sie zu bearbeiten
            </span>
          </div>
        )}

        {pdfDoc || doc.fileType === 'image' ? (
          (doc.pageOrder || []).map((physicalPage, idx) => {
            const logicalPageNum = idx + 1;
            return (
              <PDFPage
                key={`${docId}-${logicalPageNum}-${physicalPage}`}
                pdfDoc={pdfDoc}
                pageNum={logicalPageNum}
                physicalPage={physicalPage}
                zoom={doc.zoom}
                rotation={doc.rotation}
                docId={docId}
                isActive={doc.currentPage === logicalPageNum}
                onVisibilityChange={handleVisibility}
                onCalibrate={handleCalibrate}
                activeTool={activeTool}
                fileType={doc.fileType}
                fileUrl={doc.fileUrl}
              />
            );
          })
        ) : pdfError ? (
          <div style={{ color: '#ef4444', marginTop: 60, textAlign: 'center', padding: '0 20px' }}>
            <p style={{ fontWeight: 600, fontSize: 16 }}>⚠️ PDF konnte nicht geladen werden</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>{pdfError}</p>
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', marginTop: 60 }}>
            PDF wird geladen...
          </div>
        )}
      </div>

      {/* Floating Zoom & Viewport Toolbar HUD */}
      <div className="floating-zoom-hud" title="Zoom & Navigationswerkzeuge">
        <button
          className={`hud-btn ${activeTool === 'hand' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'hand' ? 'cursor' : 'hand')}
          title="Hand-Werkzeug zum Verschieben / Pan (H)"
        >
          🖐️ Pan
        </button>

        <div className="hud-sep" />

        <button
          className={`hud-btn ${activeTool === 'zoom-area' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'zoom-area' ? 'cursor' : 'zoom-area')}
          title="Rechteck-Zoom / Bereich vergrößern (Z)"
        >
          🔍 Bereich
        </button>

        <div className="hud-sep" />

        <button
          className="hud-btn"
          onClick={() => setZoom(docId, Math.max(0.1, doc.zoom - 0.25))}
          title="Verkleinern (Strg+-)"
        >
          -
        </button>

        <select
          className="hud-select"
          value={currentZoomPct}
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'fit-width') {
              handleFitWidth();
            } else if (val === 'fit-page') {
              handleFitPage();
            } else {
              setZoom(docId, (parseInt(val) || 100) / 100);
            }
          }}
          title="Zoom-Stufe wählen"
        >
          <option value="25">25%</option>
          <option value="50">50%</option>
          <option value="75">75%</option>
          <option value="100">100% (1:1)</option>
          <option value="125">125%</option>
          <option value="150">150%</option>
          <option value="200">200%</option>
          <option value="300">300%</option>
          <option value="400">400%</option>
          <option value="500">500%</option>
          <option value="800">800%</option>
          <option value="fit-width">Breite anpassen</option>
          <option value="fit-page">Seite anpassen</option>
          {!['25','50','75','100','125','150','200','300','400','500','800'].includes(String(currentZoomPct)) && (
            <option value={currentZoomPct}>{currentZoomPct}%</option>
          )}
        </select>

        <button
          className="hud-btn"
          onClick={() => setZoom(docId, Math.min(10.0, doc.zoom + 0.25))}
          title="Vergrößern (Strg++)"
        >
          +
        </button>

        <div className="hud-sep" />

        <button
          className="hud-btn"
          onClick={handleFitWidth}
          title="An Fensterbreite anpassen"
        >
          ↔ Breite
        </button>

        <button
          className="hud-btn"
          onClick={handleFitPage}
          title="Ganze Seite anpassen (Strg+0)"
        >
          ⛶ Seite
        </button>

        <button
          className="hud-btn"
          onClick={() => setZoom(docId, 1.0)}
          title="100% Originalgröße"
        >
          1:1
        </button>
      </div>

      {calibratePending && (
        <CalibrateDialog
          linePixelLength={calibratePending.pixelDist}
          onConfirm={applyCalibration}
          onCancel={() => setCalibratePending(null)}
        />
      )}
    </>
  );
}