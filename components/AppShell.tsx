'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Ribbon } from '@/components/Ribbon';
import { DocTabBar } from '@/components/DocTabBar';
import { ThumbnailPanel } from '@/components/ThumbnailPanel';
import { PDFViewer } from '@/components/viewer/PDFViewer';
import { StatusBar } from '@/components/StatusBar';
import { DropZone } from '@/components/DropZone';
import { useAppStore } from '@/store/useAppStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { KropfPanel } from '@/components/KropfPanel';
import { LinesCalcPanel } from '@/components/LinesCalcPanel';
import { VolCalcPanel } from '@/components/VolCalcPanel';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export function AppShell() {
  const {
    openDocuments, activeDocumentId, sidebarOpen, openDocument,
  } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [pdfDocMap, setPdfDocMap] = useState<Record<string, PDFDocumentProxy>>({});

  useKeyboardShortcuts(activeDocumentId);

  const activeDoc = openDocuments.find((d) => d.id === activeDocumentId) ?? null;

  const handleFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|svg)$/i.test(file.name);
      openDocument(file.name, url, isImage ? 1 : 0, isImage ? 'image' : 'pdf');
    }
  }, [openDocument]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement) {
        return;
      }
      
      const items = e.clipboardData?.items;
      if (!items) return;
      
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            const dateStr = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/:/g, '-');
            const namedFile = new File([file], `Zwischenablage_${dateStr}.png`, { type: file.type });
            imageFiles.push(namedFile);
          }
        }
      }
      
      if (imageFiles.length > 0) {
        handleFiles(imageFiles);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFiles]);


  const openFileDialog = () => fileInputRef.current?.click();

  return (
    <div
      className={`app-shell ${sidebarOpen ? '' : 'sidebar-closed'}`}
      style={{ gridTemplateColumns: sidebarOpen ? 'var(--sidebar-w) 1fr' : '0 1fr' }}
    >
      {/* ── Ribbon ── */}
      <div className="ribbon-area">
        <Ribbon onOpenFile={openFileDialog} activeDocId={activeDocumentId} />
      </div>

      {/* ── Tab Bar ── */}
      <div className="tabbar-area">
        <DocTabBar onOpenFile={openFileDialog} />
      </div>

      {/* ── Sidebar / Thumbnails ── */}
      <div className="sidebar-area" style={{ width: sidebarOpen ? 'var(--sidebar-w)' : 0, overflow: 'hidden' }}>
        <ThumbnailPanel pdfDoc={null} activeDocId={activeDocumentId} />
      </div>

      {/* ── Main canvas area ── */}
      <div
        className="canvas-area"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files).filter((f) => {
            const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
            const isImg = f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|svg)$/i.test(f.name);
            return isPdf || isImg;
          });
          if (files.length) handleFiles(files);
        }}
      >
        {openDocuments.length === 0 ? (
          <DropZone onFilesLoaded={handleFiles} />
        ) : activeDoc ? (
          <PDFViewer docId={activeDoc.id} onCursorPos={setCursorPos} />
        ) : null}
      </div>

      {/* ── Status bar ── */}
      <div className="statusbar-area">
        <StatusBar activeDocId={activeDocumentId} cursorPos={cursorPos} />
      </div>

      {/* ── Kropf Calculator Panels ── */}
      <KropfPanel />
      <LinesCalcPanel />
      <VolCalcPanel />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.webp,.svg"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) handleFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
    </div>
  );
}
