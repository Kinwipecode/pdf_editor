'use client';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PopoutWindowProps {
  title: string;
  width?: number;
  height?: number;
  isOpen: boolean;
  isPopout: boolean;
  onClose: () => void;
  onPopoutClose?: () => void;
  children: React.ReactNode;
}

export const PopoutWindow: React.FC<PopoutWindowProps> = ({
  title,
  width = 720,
  height = 560,
  isOpen,
  isPopout,
  onClose,
  onPopoutClose,
  children,
}) => {
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);
  const externalWindowRef = useRef<Window | null>(null);

  useEffect(() => {
    if (!isOpen || !isPopout) {
      if (externalWindowRef.current) {
        externalWindowRef.current.close();
        externalWindowRef.current = null;
      }
      setContainerEl(null);
      return;
    }

    const left = typeof window !== 'undefined' && window.screen?.width ? Math.max(50, Math.round((window.screen.width - width) / 2)) : 100;
    const top = typeof window !== 'undefined' && window.screen?.height ? Math.max(50, Math.round((window.screen.height - height) / 2)) : 100;

    const popWin = window.open(
      '',
      `PDFEditor_Popout_${title.replace(/[^a-zA-Z0-9]/g, '_')}`,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (!popWin) {
      alert("Das Pop-up-Fenster wurde vom Browser blockiert. Bitte erlauben Sie Pop-ups in den Browser-Einstellungen.");
      if (onPopoutClose) onPopoutClose();
      return;
    }

    externalWindowRef.current = popWin;

    const doc = popWin.document;
    doc.title = title;

    // Base body styles for dark modern UI
    doc.body.style.margin = '0';
    doc.body.style.padding = '0';
    doc.body.style.backgroundColor = '#1e1f24';
    doc.body.style.color = '#e8eaed';
    doc.body.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    doc.body.style.overflow = 'hidden';

    // Copy style tags and stylesheet links from parent window
    const styleElements = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
    styleElements.forEach((node) => {
      doc.head.appendChild(node.cloneNode(true));
    });

    // Create container
    const root = doc.createElement('div');
    root.id = 'popout-container';
    root.style.width = '100vw';
    root.style.height = '100vh';
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.boxSizing = 'border-box';
    root.style.backgroundColor = '#1e1f24';
    doc.body.appendChild(root);

    setContainerEl(root);

    const handleBeforeUnload = () => {
      if (onPopoutClose) onPopoutClose();
    };

    popWin.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      popWin.removeEventListener('beforeunload', handleBeforeUnload);
      if (popWin && !popWin.closed) {
        popWin.close();
      }
      externalWindowRef.current = null;
      setContainerEl(null);
    };
  }, [isOpen, isPopout, title, width, height, onPopoutClose]);

  if (!isOpen) return null;

  if (isPopout) {
    if (!containerEl) return null;
    return createPortal(children, containerEl);
  }

  return <>{children}</>;
};
