'use client';

let areaWindowRef: Window | null = null;
let distWindowRef: Window | null = null;

export function openAreaPopoutWindow(): Window | null {
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
    win.focus();
  }
  return win;
}

export function openDistPopoutWindow(): Window | null {
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
    areaWindowRef.close();
  }
  areaWindowRef = null;
}

export function closeDistPopoutWindow() {
  if (distWindowRef && !distWindowRef.closed) {
    distWindowRef.close();
  }
  distWindowRef = null;
}
