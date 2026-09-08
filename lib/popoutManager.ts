'use client';

let areaWindowRef: Window | null = null;
let distWindowRef: Window | null = null;

export function openAreaPopoutWindow(title = "Flächen (∑) – PDF Editor"): Window | null {
  if (typeof window === 'undefined') return null;

  if (areaWindowRef && !areaWindowRef.closed) {
    areaWindowRef.focus();
    return areaWindowRef;
  }

  const width = 760;
  const height = 580;
  const left = window.screen.width ? Math.max(50, Math.round((window.screen.width - width) / 2)) : 100;
  const top = window.screen.height ? Math.max(50, Math.round((window.screen.height - height) / 2)) : 100;

  const win = window.open(
    '',
    'PDF_Editor_Area_Calc_Window',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );

  if (win) {
    areaWindowRef = win;
    try {
      const doc = win.document;
      doc.open();
      doc.write(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #1e1f24; color: #e8eaed; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
    #popout-root { width: 100vw; height: 100vh; display: flex; flex-direction: column; background: #1e1f24; box-sizing: border-box; }
  </style>
</head>
<body>
  <div id="popout-root"></div>
</body>
</html>`);
      doc.close();
    } catch (e) {
      console.error("Error initializing popout document", e);
    }
    win.focus();
  }
  return win;
}

export function openDistPopoutWindow(title = "Längen (∑) – PDF Editor"): Window | null {
  if (typeof window === 'undefined') return null;

  if (distWindowRef && !distWindowRef.closed) {
    distWindowRef.focus();
    return distWindowRef;
  }

  const width = 760;
  const height = 580;
  const left = window.screen.width ? Math.max(50, Math.round((window.screen.width - width) / 2)) : 100;
  const top = window.screen.height ? Math.max(50, Math.round((window.screen.height - height) / 2)) : 100;

  const win = window.open(
    '',
    'PDF_Editor_Dist_Calc_Window',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );

  if (win) {
    distWindowRef = win;
    try {
      const doc = win.document;
      doc.open();
      doc.write(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #1e1f24; color: #e8eaed; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
    #popout-root { width: 100vw; height: 100vh; display: flex; flex-direction: column; background: #1e1f24; box-sizing: border-box; }
  </style>
</head>
<body>
  <div id="popout-root"></div>
</body>
</html>`);
      doc.close();
    } catch (e) {
      console.error("Error initializing popout document", e);
    }
    win.focus();
  }
  return win;
}

export function getAreaPopoutWindow(): Window | null {
  if (areaWindowRef && !areaWindowRef.closed) return areaWindowRef;
  return null;
}

export function getDistPopoutWindow(): Window | null {
  if (distWindowRef && !distWindowRef.closed) return distWindowRef;
  return null;
}

export function closeAreaPopoutWindow() {
  if (areaWindowRef && !areaWindowRef.closed) {
    try {
      areaWindowRef.close();
    } catch (e) {}
  }
  areaWindowRef = null;
}

export function closeDistPopoutWindow() {
  if (distWindowRef && !distWindowRef.closed) {
    try {
      distWindowRef.close();
    } catch (e) {}
  }
  distWindowRef = null;
}
