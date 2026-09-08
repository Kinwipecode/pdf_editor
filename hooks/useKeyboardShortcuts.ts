'use client';
import { useEffect, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';

export function useKeyboardShortcuts(activeDocId: string | null) {
  const { setActiveTool, undo, redo, setZoom, openDocuments, deleteSelectedAnnotation } = useAppStore();
  const activeDoc = openDocuments.find((d) => d.id === activeDocId);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (e.key === 'Escape') {
        setActiveTool('cursor');
        window.dispatchEvent(new CustomEvent('abort-annotation'));
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace' || e.key === '-' || e.key === '_') {
        const isModifier = e.ctrlKey || e.metaKey || e.altKey;
        const tag = (e.target as HTMLElement).tagName.toLowerCase();
        const isFocused = tag === 'input' || tag === 'textarea' || (e.target as HTMLElement).isContentEditable;

        if (!isFocused || isModifier) {
          const { hoveredPoint, setHoveredPoint, updateAnnotation } = useAppStore.getState();

          // 1. Point deletion takes precedence if we are NOT in an operation that uses these keys otherwise
          if (hoveredPoint && activeDocId === hoveredPoint.docId) {
            const doc = openDocuments.find(d => d.id === hoveredPoint.docId);
            const ann = doc?.annotations[hoveredPoint.page]?.find(a => a.id === hoveredPoint.annId) as any;
            if (ann && ann.points && ann.points.length > 2) {
              e.preventDefault();
              const newPts = [...ann.points];
              newPts.splice(hoveredPoint.index, 1);

              // Poly Area recalculation
              const scale = doc?.scale ?? { pixelsPerUnit: 1, unit: 'px' };
              if (ann.type === 'measure-area') {
                // Shoelace formula for area
                const polyArea = (pts: any[]) => {
                  let area = 0;
                  for (let i = 0; i < pts.length; i++) {
                    const j = (i + 1) % pts.length;
                    area += pts[i].x * pts[j].y;
                    area -= pts[j].x * pts[i].y;
                  }
                  return Math.abs(area / 2);
                };
                const aPx = polyArea(newPts);
                const aR = aPx / (scale.pixelsPerUnit ** 2);
                updateAnnotation(hoveredPoint.docId, hoveredPoint.page, { ...ann, points: newPts, displayValue: aR.toFixed(2) } as any);
              } else if (ann.type === 'measure-distance') {
                const dist = (a: any, b: any) => Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
                let tPx = 0;
                for (let i = 0; i < newPts.length - 1; i++) tPx += dist(newPts[i], newPts[i + 1]);
                const dR = tPx / scale.pixelsPerUnit;
                updateAnnotation(hoveredPoint.docId, hoveredPoint.page, { ...ann, points: newPts, displayValue: dR.toFixed(2) } as any);
              }
              setHoveredPoint(null);
              return;
            }
          }

          // 2. Fallback to deleting entire annotation (only for Delete/Backspace)
          if ((e.key === 'Delete' || e.key === 'Backspace') && activeDocId) {
            e.preventDefault();
            deleteSelectedAnnotation(activeDocId);
          }
          return;
        }
      }

      // Ctrl combos
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) { if (activeDocId) redo(activeDocId); }
            else { if (activeDocId) undo(activeDocId); }
            break;
          case 'y':
            e.preventDefault();
            if (activeDocId) redo(activeDocId);
            break;
          case '=':
          case '+':
            e.preventDefault();
            if (activeDocId && activeDoc) setZoom(activeDocId, activeDoc.zoom + 0.25);
            break;
          case '-':
            e.preventDefault();
            if (activeDocId && activeDoc) setZoom(activeDocId, activeDoc.zoom - 0.25);
            break;
          case '0':
            e.preventDefault();
            if (activeDocId) {
              const canvasArea = document.querySelector('.canvas-area') as HTMLElement;
              const pageEl = canvasArea?.querySelector('.pdf-page-container') as HTMLElement;
              if (canvasArea && pageEl && activeDoc) {
                const unscaledW = pageEl.clientWidth / activeDoc.zoom;
                const unscaledH = pageEl.clientHeight / activeDoc.zoom;
                const containerW = Math.max(200, canvasArea.clientWidth - 48);
                const containerH = Math.max(200, canvasArea.clientHeight - 48);
                if (unscaledW > 0 && unscaledH > 0) {
                  const fitZoom = Math.min(containerW / unscaledW, containerH / unscaledH);
                  setZoom(activeDocId, Math.round(fitZoom * 100) / 100);
                  canvasArea.scrollLeft = 0;
                  canvasArea.scrollTop = 0;
                  break;
                }
              }
              setZoom(activeDocId, 1.0);
            }
            break;
          case '1':
            e.preventDefault();
            if (activeDocId) setZoom(activeDocId, 1.0);
            break;
          case '2':
            e.preventDefault();
            if (activeDocId && activeDoc) {
              const canvasArea = document.querySelector('.canvas-area') as HTMLElement;
              const pageEl = canvasArea?.querySelector('.pdf-page-container') as HTMLElement;
              if (canvasArea && pageEl) {
                const unscaledW = pageEl.clientWidth / activeDoc.zoom;
                const containerW = Math.max(200, canvasArea.clientWidth - 48);
                if (unscaledW > 0) {
                  setZoom(activeDocId, Math.round((containerW / unscaledW) * 100) / 100);
                  canvasArea.scrollLeft = 0;
                }
              }
            }
            break;
        }
        return;
      }

      // Single-key shortcuts (when not typing in form field)
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement).isContentEditable;
      if (!isInput) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            setActiveTool('zoom-area');
            break;
          case 'h':
            e.preventDefault();
            setActiveTool('hand');
            break;
          case 'v':
            e.preventDefault();
            setActiveTool('cursor');
            break;
        }
      }
    },
    [activeDocId, activeDoc, setActiveTool, undo, redo, setZoom]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
