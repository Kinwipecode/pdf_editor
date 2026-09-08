import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import type {
  ToolType,
  OpenDocument,
  Annotation,
  MeasureScale,
} from '@/types';

// ──────────────────────────────────────────────
//  App-level store
// ──────────────────────────────────────────────
interface AppState {
  openDocuments: OpenDocument[];
  activeDocumentId: string | null;
  hoveredPoint: { docId: string; page: number; annId: string; index: number } | null;
  setHoveredPoint: (p: { docId: string; page: number; annId: string; index: number } | null) => void;
  activeTool: ToolType;
  activeColor: string;
  activeFillColor: string;
  strokeWidth: number;
  sidebarOpen: boolean;
  propertiesPanelOpen: boolean;
  ocrTransparencyEnabled: boolean;
  setOcrTransparency: (enabled: boolean) => void;
  ocrFontSize: number;
  ocrTextColor: string;
  ocrBgColor: string;
  setOcrFontSize: (size: number) => void;
  setOcrTextColor: (color: string) => void;
  setOcrBgColor: (color: string) => void;
  calculatorOpen: boolean;
  calculatorColCount: number;
  toggleCalculator: () => void;
  setCalculatorColCount: (count: number) => void;
  distCalculatorOpen: boolean;
  distCalculatorColCount: number;
  toggleDistCalculator: () => void;
  setDistCalculatorColCount: (count: number) => void;
  setDistCalculatorOpen: (open: boolean) => void;
  volCalculatorOpen: boolean;
  volCalculatorColCount: number;
  toggleVolCalculator: () => void;
  setVolCalculatorColCount: (count: number) => void;
  setVolCalculatorOpen: (open: boolean) => void;
  defaultRoomHeight: number;
  setDefaultRoomHeight: (h: number) => void;
  magZoom: number;
  setMagZoom: (zoom: number) => void;

  // Actions
  openDocument: (fileName: string, fileUrl: string, pageCount: number, fileType?: 'pdf' | 'image') => string;
  closeDocument: (id: string) => void;
  setActiveDocument: (id: string) => void;
  setActiveTool: (tool: ToolType) => void;
  setActiveColor: (color: string) => void;
  setActiveFillColor: (color: string) => void;
  setStrokeWidth: (w: number) => void;
  toggleSidebar: () => void;
  togglePropertiesPanel: () => void;
  toggleAnnotationsVisible: (docId: string) => void;
  toggleOcrTransparency: () => void;
  setCalculatorOpen: (open: boolean) => void;

  // Per-document actions
  setCurrentPage: (docId: string, page: number) => void;
  setZoom: (docId: string, zoom: number) => void;
  setRotation: (docId: string, rotation: number) => void;
  setPageCount: (docId: string, count: number) => void;
  setThumbnailsReady: (docId: string, ready: boolean) => void;
  setScale: (docId: string, scale: MeasureScale) => void;

  // Annotation actions
  addAnnotation: (docId: string, page: number, annotation: Annotation) => void;
  addAnnotations: (docId: string, page: number, annotations: Annotation[]) => void;

  updateAnnotation: (docId: string, page: number, annotation: Annotation) => void;
  deleteAnnotation: (docId: string, page: number, annotationId: string) => void;
  deleteSelectedAnnotation: (docId: string) => void;
  selectAnnotation: (docId: string, page: number, annotationId: string | null) => void;
  selectAnnotations: (docId: string, page: number, annotationIds: string[]) => void;
  undo: (docId: string) => void;
  redo: (docId: string) => void;

  // Page manipulation
  deletePage: (docId: string, logicalPageIndex: number) => void;
  insertPage: (docId: string, atIndex: number) => void;
  movePage: (docId: string, fromIndex: number, toIndex: number) => void;
  movePageRelative: (docId: string, logicalPageIndex: number, delta: number) => void;
  movePageRange: (docId: string, startIdx: number, endIdx: number, targetIdx: number) => void;
  appendExternalPages: (docId: string, newFileUrl: string, oldPhysicalCount: number, newPhysicalCount: number) => void;
}

export const useAppStore = create<AppState>()(
  immer((set, get) => ({
    openDocuments: [],
    activeDocumentId: null,
    hoveredPoint: null,
    setHoveredPoint: (p) => set((state) => { state.hoveredPoint = p; }),
    activeTool: 'hand',
    activeColor: '#000000',
    activeFillColor: 'transparent',
    strokeWidth: 2,
    sidebarOpen: true,
    propertiesPanelOpen: false,
    ocrTransparencyEnabled: false,
    ocrFontSize: 10,
    ocrTextColor: '#1a1a1a',
    ocrBgColor: '#ffffff',
    calculatorOpen: false,
    calculatorColCount: 1,
    toggleCalculator: () => set((state) => { state.calculatorOpen = !state.calculatorOpen; }),
    setCalculatorOpen: (open) => set((state) => { state.calculatorOpen = open; }),
    setCalculatorColCount: (count) => set((state) => { state.calculatorColCount = count; }),
    distCalculatorOpen: false,
    distCalculatorColCount: 1,
    toggleDistCalculator: () => set((state) => { state.distCalculatorOpen = !state.distCalculatorOpen; }),
    setDistCalculatorColCount: (count) => set((state) => { state.distCalculatorColCount = count; }),
    setDistCalculatorOpen: (open) => set((state) => { state.distCalculatorOpen = open; }),
    volCalculatorOpen: false,
    volCalculatorColCount: 1,
    toggleVolCalculator: () => set((state) => { state.volCalculatorOpen = !state.volCalculatorOpen; }),
    setVolCalculatorColCount: (count) => set((state) => { state.volCalculatorColCount = count; }),
    setVolCalculatorOpen: (open) => set((state) => { state.volCalculatorOpen = open; }),
    defaultRoomHeight: 2.50,
    setDefaultRoomHeight: (h) => set((state) => { state.defaultRoomHeight = Math.max(0.1, h); }),
    magZoom: 2,
    setMagZoom: (zoom) => set((state) => { state.magZoom = Math.max(1, Math.min(20, zoom)); }),

    openDocument: (fileName, fileUrl, pageCount, fileType = 'pdf') => {
      const id = uuidv4();
      set((state) => {
        state.openDocuments.push({
          id,
          fileName,
          fileUrl,
          fileType,
          pageCount,
          currentPage: 1,
          zoom: 1.0,
          rotation: 0,
          annotations: {},
          history: [{}],
          historyIndex: 0,
          scale: { pixelsPerUnit: 1, unit: 'px' },
          thumbnailsReady: false,
          annotationsVisible: true,
          pageOrder: Array.from({ length: pageCount }, (_, i) => i + 1),
        });
        state.activeDocumentId = id;
      });
      return id;
    },

    closeDocument: (id) =>
      set((state) => {
        const idx = state.openDocuments.findIndex((d) => d.id === id);
        if (idx === -1) return;
        state.openDocuments.splice(idx, 1);
        if (state.activeDocumentId === id) {
          state.activeDocumentId =
            state.openDocuments[Math.max(0, idx - 1)]?.id ?? null;
        }
      }),

    setActiveDocument: (id) =>
      set((state) => {
        state.activeDocumentId = id;
      }),

    setActiveTool: (tool) =>
      set((state) => {
        state.activeTool = tool;
      }),

    setActiveColor: (color) =>
      set((state) => {
        state.activeColor = color;
      }),

    setActiveFillColor: (color) =>
      set((state) => {
        state.activeFillColor = color;
      }),

    setStrokeWidth: (w) =>
      set((state) => {
        state.strokeWidth = w;
      }),

    toggleSidebar: () =>
      set((state) => {
        state.sidebarOpen = !state.sidebarOpen;
      }),

    togglePropertiesPanel: () =>
      set((state) => {
        state.propertiesPanelOpen = !state.propertiesPanelOpen;
      }),

    toggleAnnotationsVisible: (docId) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (doc) doc.annotationsVisible = !doc.annotationsVisible;
      }),

    toggleOcrTransparency: () =>
      set((state) => {
        state.ocrTransparencyEnabled = !state.ocrTransparencyEnabled;
      }),

    setOcrTransparency: (enabled) =>
      set((state) => {
        state.ocrTransparencyEnabled = enabled;
      }),

    setOcrFontSize: (size) =>
      set((state) => {
        state.ocrFontSize = size;
      }),

    setOcrTextColor: (color) =>
      set((state) => {
        state.ocrTextColor = color;
      }),

    setOcrBgColor: (color) =>
      set((state) => {
        state.ocrBgColor = color;
      }),

    setCurrentPage: (docId, page) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (doc) doc.currentPage = page;
      }),

    setZoom: (docId, zoom) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (doc) doc.zoom = Math.max(0.1, Math.min(10, zoom));
      }),

    setRotation: (docId, rotation) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (doc) doc.rotation = rotation % 360;
      }),

    setPageCount: (docId, count) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (doc) {
          doc.pageCount = count;
          // IMPORTANT: If pageOrder was empty (initial PDF state), populate it now
          if (doc.pageOrder.length === 0 && count > 0) {
            doc.pageOrder = Array.from({ length: count }, (_, i) => i + 1);
          }
        }
      }),

    setThumbnailsReady: (docId, ready) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (doc) doc.thumbnailsReady = ready;
      }),

    setScale: (docId, scale) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (doc) doc.scale = scale;
      }),

    addAnnotation: (docId, page, annotation) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;
        if (!doc.annotations[page]) doc.annotations[page] = [];
        doc.annotations[page].push(annotation);

        // push history only after a small delay or if not in bulk
        const snapshot = JSON.parse(JSON.stringify(doc.annotations));
        doc.history = doc.history.slice(0, doc.historyIndex + 1);
        doc.history.push(snapshot);
        doc.historyIndex++;
      }),

    addAnnotations: (docId, page, annotations) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;
        if (!doc.annotations[page]) doc.annotations[page] = [];
        doc.annotations[page].push(...annotations);

        // push history once for the whole batch
        const snapshot = JSON.parse(JSON.stringify(doc.annotations));
        doc.history = doc.history.slice(0, doc.historyIndex + 1);
        doc.history.push(snapshot);
        doc.historyIndex++;
      }),

    updateAnnotation: (docId, page, annotation) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;
        const idx = doc.annotations[page]?.findIndex((a) => a.id === annotation.id);
        if (idx !== undefined && idx !== -1) {
          doc.annotations[page][idx] = annotation;
        }
      }),

    deleteAnnotation: (docId, page, annotationId) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;
        doc.annotations[page] = (doc.annotations[page] ?? []).filter(
          (a) => a.id !== annotationId
        );
        const snapshot = JSON.parse(JSON.stringify(doc.annotations));
        doc.history = doc.history.slice(0, doc.historyIndex + 1);
        doc.history.push(snapshot);
        doc.historyIndex++;
      }),

    deleteSelectedAnnotation: (docId) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;

        let deleted = false;
        for (const pageStr of Object.keys(doc.annotations)) {
          const page = Number(pageStr);
          const initialLength = doc.annotations[page].length;
          doc.annotations[page] = doc.annotations[page].filter((a) => !a.selected);

          if (doc.annotations[page].length < initialLength) {
            deleted = true;
          }
        }

        if (deleted) {
          const snapshot = JSON.parse(JSON.stringify(doc.annotations));
          doc.history = doc.history.slice(0, doc.historyIndex + 1);
          doc.history.push(snapshot);
          doc.historyIndex++;
        }
      }),

    selectAnnotation: (docId, page, annotationId) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;
        Object.values(doc.annotations).forEach((pageAnnotations) => {
          pageAnnotations.forEach((a) => {
            a.selected = a.id === annotationId;
          });
        });
      }),

    selectAnnotations: (docId, page, annotationIds) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;
        const idSet = new Set(annotationIds);
        Object.values(doc.annotations).forEach((pageAnnotations) => {
          pageAnnotations.forEach((a) => {
            a.selected = idSet.has(a.id);
          });
        });
      }),

    undo: (docId) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc || doc.historyIndex <= 0) return;
        doc.historyIndex--;
        doc.annotations = JSON.parse(JSON.stringify(doc.history[doc.historyIndex]));
      }),

    redo: (docId) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc || doc.historyIndex >= doc.history.length - 1) return;
        doc.historyIndex++;
        doc.annotations = JSON.parse(JSON.stringify(doc.history[doc.historyIndex]));
      }),

    deletePage: (docId, logicalPageIndex) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc || doc.pageOrder.length <= 1) return;

        const originalPage = doc.pageOrder[logicalPageIndex];
        doc.pageOrder.splice(logicalPageIndex, 1);

        // Optionally delete annotations for that page if it was a real page
        if (typeof originalPage === 'number') {
          delete doc.annotations[originalPage];
        }

        if (doc.currentPage > doc.pageOrder.length) {
          doc.currentPage = doc.pageOrder.length;
        }
        doc.pageCount = doc.pageOrder.length;
      }),

    insertPage: (docId, atIndex) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;
        const newId = `blank-${uuidv4()}`;
        doc.pageOrder.splice(atIndex, 0, newId);
        doc.pageCount = doc.pageOrder.length;
      }),

    movePage: (docId, fromIndex, toIndex) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;
        const [moved] = doc.pageOrder.splice(fromIndex, 1);
        doc.pageOrder.splice(toIndex, 0, moved);
      }),

    movePageRelative: (docId, logicalPageIndex, delta) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;
        const toIndex = logicalPageIndex + delta;
        if (toIndex < 0 || toIndex >= doc.pageOrder.length) return;
        const [moved] = doc.pageOrder.splice(logicalPageIndex, 1);
        doc.pageOrder.splice(toIndex, 0, moved);
        doc.currentPage = toIndex + 1;
      }),

    movePageRange: (docId, startIdx, endIdx, targetIdx) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;
        const count = endIdx - startIdx + 1;
        if (count <= 0) return;

        const removed = doc.pageOrder.splice(startIdx, count);
        // If target was after the removed block, we must adjust targetIdx
        let adjustedTarget = targetIdx;
        if (targetIdx > startIdx) {
          adjustedTarget -= count;
        }
        if (adjustedTarget < 0) adjustedTarget = 0;
        if (adjustedTarget > doc.pageOrder.length) adjustedTarget = doc.pageOrder.length;

        doc.pageOrder.splice(adjustedTarget, 0, ...removed);
        doc.currentPage = adjustedTarget + 1;
      }),

    appendExternalPages: (docId, newFileUrl, oldPhysicalCount, newPhysicalCount) =>
      set((state) => {
        const doc = state.openDocuments.find((d) => d.id === docId);
        if (!doc) return;
        
        doc.fileUrl = newFileUrl;
        doc.fileType = 'pdf'; // In case it was an image
        
        // The newly appended physical pages start at oldPhysicalCount + 1
        const newPages = Array.from(
          { length: newPhysicalCount - oldPhysicalCount }, 
          (_, i) => oldPhysicalCount + i + 1
        );
        
        // Insert right after the current page
        doc.pageOrder.splice(doc.currentPage, 0, ...newPages);
        doc.pageCount = doc.pageOrder.length;
        doc.currentPage = doc.currentPage + 1; // Move to first new page
      }),
  }))
);

// Helper hook - active document
export const useActiveDocument = () => {
  const { openDocuments, activeDocumentId } = useAppStore();
  return openDocuments.find((d) => d.id === activeDocumentId) ?? null;
};