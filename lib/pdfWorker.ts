// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Use the locally-served worker file (copied from node_modules to public/)
// This avoids CDN availability issues and version mismatches.
if (typeof window !== 'undefined') {
  let basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

  if (!basePath) {
    const pathname = window.location.pathname;
    if (window.location.hostname.includes('github.io')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        basePath = `/${parts[0]}`;
      }
    } else if (pathname.startsWith('/pdf_editor')) {
      basePath = '/pdf_editor';
    }
  }

  // Remove trailing slash if present
  basePath = basePath.replace(/\/$/, '');

  pdfjsLib.GlobalWorkerOptions.workerSrc = `${basePath}/pdf.worker.min.mjs`;
}

export default pdfjsLib;

