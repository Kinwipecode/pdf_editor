'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface PopoutWindowProps {
  title: string;
  isOpen: boolean;
  isPopout: boolean;
  popWindow: Window | null;
  onClose: () => void;
  onPopoutToggle: (popout: boolean) => void;
  children: React.ReactNode;
}

export const PopoutWindow: React.FC<PopoutWindowProps> = ({
  title,
  isOpen,
  isPopout,
  popWindow,
  onClose,
  onPopoutToggle,
  children,
}) => {
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen || !isPopout || !popWindow || popWindow.closed) {
      setContainerEl(null);
      return;
    }

    const doc = popWindow.document;
    doc.title = title;

    // Copy style tags and stylesheet links from parent window to popout window
    const styleElements = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
    styleElements.forEach((node) => {
      try {
        doc.head.appendChild(node.cloneNode(true));
      } catch (e) {}
    });

    let root = doc.getElementById('popout-root');
    if (!root) {
      root = doc.createElement('div');
      root.id = 'popout-root';
      root.style.width = '100vw';
      root.style.height = '100vh';
      root.style.display = 'flex';
      root.style.flexDirection = 'column';
      root.style.boxSizing = 'border-box';
      root.style.backgroundColor = '#1e1f24';
      doc.body.appendChild(root);
    }

    setContainerEl(root);

    const handleBeforeUnload = () => {
      onClose();
    };

    popWindow.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      try {
        popWindow.removeEventListener('beforeunload', handleBeforeUnload);
      } catch (e) {}
    };
  }, [isOpen, isPopout, popWindow, title, onClose]);

  if (!isOpen) return null;

  if (isPopout) {
    if (!containerEl) return null;
    return createPortal(children, containerEl);
  }

  return <>{children}</>;
};
