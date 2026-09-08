'use client';
import { useAppStore } from '@/store/useAppStore';
import type { MeasureAreaAnnotation, MeasureCircleAnnotation, MeasureDistanceAnnotation, MeasureVolumeAnnotation } from '@/types';

let areaPopWindow: Window | null = null;
let distPopWindow: Window | null = null;
let volPopWindow: Window | null = null;
let unsubArea: (() => void) | null = null;
let unsubDist: (() => void) | null = null;
let unsubVol: (() => void) | null = null;

function parseAndEval(startVal: number, calculations: string[]): number {
  let current = startVal;
  (calculations || []).forEach((opStr) => {
    const s = (opStr || '').trim().toLowerCase();
    if (!s) return;
    const match = s.match(/^([x*+\-/:])\s*(\d*\.?\d+)$/);
    if (!match) return;
    const op = match[1];
    const val = parseFloat(match[2]);
    if (isNaN(val)) return;

    if (op === 'x' || op === '*') current *= val;
    else if (op === '+') current += val;
    else if (op === '-') current -= val;
    else if (op === '/' || op === ':') current /= val;
  });
  return current;
}

function formatNum(num: number): string {
  return num.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ==========================================================================
   FLÄCHEN (∑) POP-UP WINDOW SYSTEM
   ========================================================================== */
export function openAreaPopoutWindow(): Window | null {
  if (typeof window === 'undefined') return null;

  if (areaPopWindow && !areaPopWindow.closed) {
    areaPopWindow.focus();
    renderAreaPopoutContent();
    return areaPopWindow;
  }

  const width = 780;
  const height = 580;
  const left = window.screen.width ? Math.max(50, Math.round((window.screen.width - width) / 2)) : 100;
  const top = window.screen.height ? Math.max(50, Math.round((window.screen.height - height) / 2)) : 100;

  const win = window.open(
    '',
    'PDF_Editor_Area_Calc_Window',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );

  if (!win) return null;
  areaPopWindow = win;

  const doc = win.document;
  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>Flächen (∑) – PDF Editor</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #2a2b30; color: #e8eaed; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; display: flex; flex-direction: column; }
    .header { padding: 12px 16px; background: #1e1f24; border-bottom: 1px solid #3d3e47; display: flex; align-items: center; justify-content: space-between; user-select: none; flex-shrink: 0; }
    .header-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
    .badge { font-size: 11px; color: #9aa0ac; background: #3d3e47; padding: 2px 6px; border-radius: 4px; }
    .header-actions { display: flex; align-items: center; gap: 8px; }
    .btn-icon { background: transparent; border: none; cursor: pointer; color: #9aa0ac; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: color 0.15s, background 0.15s; }
    .btn-icon:hover { color: #fff; background: #3d3e47; }
    .btn-step { background: #3d3e47; border: none; border-radius: 4px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; font-weight: bold; font-size: 14px; }
    .btn-step:hover { background: #4f5260; }
    .divider { width: 1px; height: 16px; background: #3d3e47; margin: 0 2px; }
    .content { flex: 1; overflow: auto; padding: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { color: #9aa0ac; border-bottom: 1px solid #3d3e47; text-align: left; padding: 8px 4px; font-weight: 500; }
    td { padding: 8px 4px; border-bottom: 1px solid #32333b; vertical-align: middle; }
    tr.selected { background: rgba(79, 142, 247, 0.18) !important; }
    tr:hover { background: rgba(255, 255, 255, 0.04); cursor: pointer; }
    .color-dot { width: 10px; height: 10px; border-radius: 50%; margin: 0 auto; }
    .btn-mode { padding: 2px 6px; border-radius: 4px; border: none; font-size: 10px; font-weight: bold; cursor: pointer; color: #fff; min-width: 24px; }
    .btn-mode.pos { background: #34a853; }
    .btn-mode.neg { background: #ea4335; }
    .input-factor { width: 80px; background: #1a1b1e; border: 1px solid #3d3e47; border-radius: 4px; padding: 4px 8px; color: #fff; font-size: 11px; outline: none; }
    .input-factor:focus { border-color: #4f8ef7; }
    .result-cell { text-align: right; font-weight: bold; color: #fff; min-width: 80px; }
    .total-row { border-top: 2px solid #4f8ef7; font-weight: bold; font-size: 14px; }
    .total-label { padding: 16px 4px; }
    .total-val { padding: 16px 4px; text-align: right; color: #4f8ef7; font-size: 15px; }
    .empty-state { text-align: center; padding: 40px; color: #5f6368; font-size: 13px; }
    .footer-tip { padding: 8px 16px; background: #1e1f24; font-size: 10px; color: #5f6368; border-top: 1px solid #3d3e47; flex-shrink: 0; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">
      <span>Flächen (∑)</span>
      <span class="badge" id="area-count-badge">0 Flächen</span>
    </div>
    <div class="header-actions">
      <button class="btn-icon" id="btn-delete-all" title="Alle Flächen löschen">🗑️</button>
      <div class="divider"></div>
      <button class="btn-step" id="btn-col-minus" title="Spalte entfernen">-</button>
      <button class="btn-step" id="btn-col-plus" title="Spalte hinzufügen">+</button>
      <div class="divider"></div>
      <button class="btn-icon" id="btn-close-win" title="Fenster schließen" style="font-size: 16px; font-weight: bold;">✕</button>
    </div>
  </div>

  <div class="content">
    <table id="area-table">
      <thead id="area-thead"></thead>
      <tbody id="area-tbody"></tbody>
      <tfoot id="area-tfoot"></tfoot>
    </table>
    <div id="area-empty" class="empty-state" style="display: none;">
      Keine Flächenmessungen gefunden. Messen Sie zuerst einige Flächen.
    </div>
  </div>

  <div class="footer-tip">
    Tipp: Geben Sie Operationen wie 'x2', '+10', '-5' oder ':2' in die Felder ein.
  </div>
</body>
</html>`);
  doc.close();

  // Attach event listeners to popup DOM elements
  const btnClose = doc.getElementById('btn-close-win');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      closeAreaPopoutWindow();
    });
  }

  const btnDeleteAll = doc.getElementById('btn-delete-all');
  if (btnDeleteAll) {
    btnDeleteAll.addEventListener('click', () => {
      const state = useAppStore.getState();
      const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
      if (!activeDoc) return;
      if (confirm("Alle Flächenmessungen in diesem Dokument löschen?")) {
        Object.values(activeDoc.annotations).forEach((pageAnns) => {
          pageAnns.forEach((ann) => {
            if (ann.type === 'measure-area' || ann.type === 'measure-circle') {
              state.deleteAnnotation(activeDoc.id, ann.page, ann.id);
            }
          });
        });
      }
    });
  }

  const btnColMinus = doc.getElementById('btn-col-minus');
  if (btnColMinus) {
    btnColMinus.addEventListener('click', () => {
      const state = useAppStore.getState();
      state.setCalculatorColCount(Math.max(1, state.calculatorColCount - 1));
    });
  }

  const btnColPlus = doc.getElementById('btn-col-plus');
  if (btnColPlus) {
    btnColPlus.addEventListener('click', () => {
      const state = useAppStore.getState();
      state.setCalculatorColCount(state.calculatorColCount + 1);
    });
  }

  // Input & Click events on table
  const tbody = doc.getElementById('area-tbody');
  if (tbody) {
    tbody.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target && target.classList.contains('input-factor')) {
        const annId = target.dataset.annId;
        const page = parseInt(target.dataset.page || '0', 10);
        const colIdx = parseInt(target.dataset.colIdx || '0', 10);
        if (!annId) return;

        const state = useAppStore.getState();
        const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
        if (!activeDoc) return;

        const pageAnns = activeDoc.annotations[page] || [];
        const ann = pageAnns.find((a) => a.id === annId);
        if (ann) {
          const newCalcs = [...(ann.calculations || [])];
          while (newCalcs.length <= colIdx) newCalcs.push('');
          newCalcs[colIdx] = target.value;
          state.updateAnnotation(activeDoc.id, page, { ...ann, calculations: newCalcs } as any);
        }
      }
    });

    tbody.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const btnMode = target.closest('.btn-mode') as HTMLButtonElement;
      if (btnMode) {
        e.stopPropagation();
        const annId = btnMode.dataset.annId;
        const page = parseInt(btnMode.dataset.page || '0', 10);
        const state = useAppStore.getState();
        const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
        if (!activeDoc || !annId) return;

        const pageAnns = activeDoc.annotations[page] || [];
        const ann = pageAnns.find((a) => a.id === annId);
        if (ann) {
          state.updateAnnotation(activeDoc.id, page, { ...ann, isNegative: !ann.isNegative } as any);
        }
        return;
      }

      const btnDel = target.closest('.btn-del-row') as HTMLButtonElement;
      if (btnDel) {
        e.stopPropagation();
        const annId = btnDel.dataset.annId;
        const page = parseInt(btnDel.dataset.page || '0', 10);
        const state = useAppStore.getState();
        const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
        if (!activeDoc || !annId) return;

        state.deleteAnnotation(activeDoc.id, page, annId);
        return;
      }

      const tr = target.closest('tr');
      if (tr && tr.dataset.annId) {
        const annId = tr.dataset.annId;
        const page = parseInt(tr.dataset.page || '0', 10);
        const state = useAppStore.getState();
        if (state.activeDocumentId) {
          state.selectAnnotation(state.activeDocumentId, page, annId);
        }
      }
    });
  }

    // Drag & drop support: drag area row out to volume window or receive volume row
    tbody.addEventListener('dragstart', (e: DragEvent) => {
      const tr = (e.target as HTMLElement).closest('tr');
      if (tr && tr.dataset.annId) {
        e.dataTransfer?.setData('application/json', JSON.stringify({
          annId: tr.dataset.annId,
          page: parseInt(tr.dataset.page || '0', 10),
          from: 'area'
        }));
      }
    });

    const contentArea = doc.querySelector('.content');
    if (contentArea) {
      contentArea.addEventListener('dragover', (e: Event) => {
        (e as DragEvent).preventDefault();
        if ((e as DragEvent).dataTransfer) {
          (e as DragEvent).dataTransfer!.dropEffect = 'move';
        }
      });
      contentArea.addEventListener('drop', (e: Event) => {
        (e as DragEvent).preventDefault();
        const dragEvent = e as DragEvent;
        const dataStr = dragEvent.dataTransfer?.getData('application/json');
        if (!dataStr) return;
        try {
          const data = JSON.parse(dataStr);
          if (data.annId && data.from === 'vol') {
            const state = useAppStore.getState();
            const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
            if (!activeDoc) return;
            const pageAnns = activeDoc.annotations[data.page] || [];
            const ann = pageAnns.find((a) => a.id === data.annId);
            if (ann) {
              state.updateAnnotation(activeDoc.id, data.page, {
                ...ann,
                type: 'measure-area'
              } as any);
            }
          }
        } catch (err) {}
      });
    }

  win.addEventListener('beforeunload', () => {
    areaPopWindow = null;
    if (unsubArea) {
      unsubArea();
      unsubArea = null;
    }
    useAppStore.getState().setCalculatorOpen(false);
  });

  // Initial render
  renderAreaPopoutContent();

  // Subscribe to Zustand store changes
  if (unsubArea) unsubArea();
  unsubArea = useAppStore.subscribe(() => {
    renderAreaPopoutContent();
  });

  win.focus();
  return win;
}

function renderAreaPopoutContent() {
  if (!areaPopWindow || areaPopWindow.closed) return;
  const doc = areaPopWindow.document;

  const state = useAppStore.getState();
  const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
  const colCount = state.calculatorColCount || 1;
  const unit = activeDoc?.scale?.unit || 'm';

  const badge = doc.getElementById('area-count-badge');
  const thead = doc.getElementById('area-thead');
  const tbody = doc.getElementById('area-tbody');
  const tfoot = doc.getElementById('area-tfoot');
  const empty = doc.getElementById('area-empty');

  if (!activeDoc) {
    if (tbody) tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  // Collect area annotations
  const areaAnns: (MeasureAreaAnnotation | MeasureCircleAnnotation)[] = [];
  Object.values(activeDoc.annotations).forEach((pageAnns) => {
    pageAnns.forEach((ann) => {
      if (ann.type === 'measure-area' || ann.type === 'measure-circle') {
        areaAnns.push(ann as any);
      }
    });
  });
  areaAnns.sort((a, b) => a.createdAt - b.createdAt);

  if (badge) badge.textContent = `${areaAnns.length} Flächen`;

  if (areaAnns.length === 0) {
    if (tbody) tbody.innerHTML = '';
    if (tfoot) tfoot.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  if (empty) empty.style.display = 'none';

  // Build Table Header
  let thHtml = `<tr>
    <th style="width:30px;"></th>
    <th style="width:40px; text-align:center;">Mode</th>
    <th style="white-space:nowrap;">Seite</th>
    <th style="white-space:nowrap;">Fläche (${unit}²)</th>`;
  for (let i = 0; i < colCount; i++) {
    thHtml += `<th style="width:90px;">Faktor ${i + 1}</th>`;
  }
  thHtml += `<th style="text-align:right; color:#4f8ef7; min-width:80px;">Resultat</th><th style="width:40px;"></th></tr>`;
  if (thead) thead.innerHTML = thHtml;

  // Build Table Rows
  let totalSum = 0;
  let trHtml = '';

  areaAnns.forEach((ann) => {
    const base = parseFloat(ann.displayValue.replace(/[^\d.]/g, '')) || 0;
    const calcList = ann.calculations || [];
    const paddedCalcs = [...calcList];
    while (paddedCalcs.length < colCount) paddedCalcs.push('');

    const finalResult = parseAndEval(base, paddedCalcs.slice(0, colCount)) * (ann.isNegative ? -1 : 1);
    totalSum += finalResult;

    trHtml += `<tr draggable="true" class="${ann.selected ? 'selected' : ''}" data-ann-id="${ann.id}" data-page="${ann.page}" title="Ziehen zum Verschieben ins Volumen-Fenster">
      <td style="text-align:center;"><div class="color-dot" style="background:${ann.color || '#4f8ef7'};"></div></td>
      <td style="text-align:center;">
        <button class="btn-mode ${ann.isNegative ? 'neg' : 'pos'}" data-ann-id="${ann.id}" data-page="${ann.page}">
          ${ann.isNegative ? '-' : '+'}
        </button>
      </td>
      <td style="color:#9aa0ac;">S. ${ann.page + 1}</td>
      <td style="font-weight:bold;">${formatNum(base)}</td>`;

    for (let c = 0; c < colCount; c++) {
      const val = paddedCalcs[c] || '';
      trHtml += `<td style="padding:4px;">
        <input type="text" class="input-factor" data-ann-id="${ann.id}" data-page="${ann.page}" data-col-idx="${c}" value="${val}" placeholder="z.B. x2" />
      </td>`;
    }

    trHtml += `<td class="result-cell">${formatNum(finalResult)}</td>
      <td style="text-align:right;">
        <button class="btn-icon btn-del-row" data-ann-id="${ann.id}" data-page="${ann.page}" title="Löschen">🗑️</button>
      </td>
    </tr>`;
  });

  if (tbody) tbody.innerHTML = trHtml;

  // Build Table Footer
  if (tfoot) {
    tfoot.innerHTML = `<tr class="total-row">
      <td colSpan="${colCount + 4}" class="total-label">GESAMTSUMME</td>
      <td class="total-val">${formatNum(totalSum)}</td>
      <td></td>
    </tr>`;
  }
}

/* ==========================================================================
   LÄNGEN (∑) POP-UP WINDOW SYSTEM
   ========================================================================== */
export function openDistPopoutWindow(): Window | null {
  if (typeof window === 'undefined') return null;

  if (distPopWindow && !distPopWindow.closed) {
    distPopWindow.focus();
    renderDistPopoutContent();
    return distPopWindow;
  }

  const width = 780;
  const height = 580;
  const left = window.screen.width ? Math.max(50, Math.round((window.screen.width - width) / 2)) : 100;
  const top = window.screen.height ? Math.max(50, Math.round((window.screen.height - height) / 2)) : 100;

  const win = window.open(
    '',
    'PDF_Editor_Dist_Calc_Window',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );

  if (!win) return null;
  distPopWindow = win;

  const doc = win.document;
  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>Längen (∑) – PDF Editor</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #232429; color: #e8eaed; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; display: flex; flex-direction: column; }
    .header { padding: 12px 16px; background: #1a1b1e; border-bottom: 1px solid #3d3e47; display: flex; align-items: center; justify-content: space-between; user-select: none; flex-shrink: 0; }
    .header-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
    .badge { font-size: 11px; color: #9aa0ac; background: #3d3e47; padding: 2px 6px; border-radius: 4px; }
    .header-actions { display: flex; align-items: center; gap: 8px; }
    .btn-icon { background: transparent; border: none; cursor: pointer; color: #9aa0ac; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: color 0.15s, background 0.15s; }
    .btn-icon:hover { color: #fff; background: #3d3e47; }
    .btn-step { background: #3d3e47; border: none; border-radius: 4px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; font-weight: bold; font-size: 14px; }
    .btn-step:hover { background: #4f5260; }
    .divider { width: 1px; height: 16px; background: #3d3e47; margin: 0 2px; }
    .content { flex: 1; overflow: auto; padding: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { color: #9aa0ac; border-bottom: 1px solid #3d3e47; text-align: left; padding: 8px 4px; font-weight: 500; }
    td { padding: 8px 4px; border-bottom: 1px solid #32333b; vertical-align: middle; }
    tr.selected { background: rgba(79, 142, 247, 0.18) !important; }
    tr:hover { background: rgba(255, 255, 255, 0.04); cursor: pointer; }
    .color-dot { width: 10px; height: 10px; border-radius: 50%; margin: 0 auto; }
    .btn-mode { padding: 2px 6px; border-radius: 4px; border: none; font-size: 10px; font-weight: bold; cursor: pointer; color: #fff; min-width: 24px; }
    .btn-mode.pos { background: #34a853; }
    .btn-mode.neg { background: #ea4335; }
    .input-factor { width: 80px; background: #1a1b1e; border: 1px solid #3d3e47; border-radius: 4px; padding: 4px 8px; color: #fff; font-size: 11px; outline: none; }
    .input-factor:focus { border-color: #4f8ef7; }
    .result-cell { text-align: right; font-weight: bold; color: #fff; min-width: 80px; }
    .total-row { border-top: 2px solid #4f8ef7; font-weight: bold; font-size: 14px; }
    .total-label { padding: 16px 4px; }
    .total-val { padding: 16px 4px; text-align: right; color: #4f8ef7; font-size: 15px; }
    .empty-state { text-align: center; padding: 40px; color: #5f6368; font-size: 13px; }
    .footer-tip { padding: 8px 16px; background: #1a1b1e; font-size: 10px; color: #5f6368; border-top: 1px solid #3d3e47; flex-shrink: 0; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">
      <span>Längen (∑)</span>
      <span class="badge" id="dist-count-badge">0 Linien</span>
    </div>
    <div class="header-actions">
      <button class="btn-icon" id="btn-delete-all" title="Alle Längen löschen">🗑️</button>
      <div class="divider"></div>
      <button class="btn-step" id="btn-col-minus" title="Spalte entfernen">-</button>
      <button class="btn-step" id="btn-col-plus" title="Spalte hinzufügen">+</button>
      <div class="divider"></div>
      <button class="btn-icon" id="btn-close-win" title="Fenster schließen" style="font-size: 16px; font-weight: bold;">✕</button>
    </div>
  </div>

  <div class="content">
    <table id="dist-table">
      <thead id="dist-thead"></thead>
      <tbody id="dist-tbody"></tbody>
      <tfoot id="dist-tfoot"></tfoot>
    </table>
    <div id="dist-empty" class="empty-state" style="display: none;">
      Keine Längenmessungen gefunden. Messen Sie zuerst einige Abstände.
    </div>
  </div>

  <div class="footer-tip">
    Tipp: Geben Sie Operationen wie 'x2', '+10', '-5' oder ':2' in die Felder ein.
  </div>
</body>
</html>`);
  doc.close();

  // Attach event listeners to popup DOM elements
  const btnClose = doc.getElementById('btn-close-win');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      closeDistPopoutWindow();
    });
  }

  const btnDeleteAll = doc.getElementById('btn-delete-all');
  if (btnDeleteAll) {
    btnDeleteAll.addEventListener('click', () => {
      const state = useAppStore.getState();
      const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
      if (!activeDoc) return;
      if (confirm("Alle Längenmessungen in diesem Dokument löschen?")) {
        Object.values(activeDoc.annotations).forEach((pageAnns) => {
          pageAnns.forEach((ann) => {
            if (ann.type === 'measure-distance') {
              state.deleteAnnotation(activeDoc.id, ann.page, ann.id);
            }
          });
        });
      }
    });
  }

  const btnColMinus = doc.getElementById('btn-col-minus');
  if (btnColMinus) {
    btnColMinus.addEventListener('click', () => {
      const state = useAppStore.getState();
      state.setDistCalculatorColCount(Math.max(1, state.distCalculatorColCount - 1));
    });
  }

  const btnColPlus = doc.getElementById('btn-col-plus');
  if (btnColPlus) {
    btnColPlus.addEventListener('click', () => {
      const state = useAppStore.getState();
      state.setDistCalculatorColCount(state.distCalculatorColCount + 1);
    });
  }

  // Input & Click events on table
  const tbody = doc.getElementById('dist-tbody');
  if (tbody) {
    tbody.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target && target.classList.contains('input-factor')) {
        const annId = target.dataset.annId;
        const page = parseInt(target.dataset.page || '0', 10);
        const colIdx = parseInt(target.dataset.colIdx || '0', 10);
        if (!annId) return;

        const state = useAppStore.getState();
        const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
        if (!activeDoc) return;

        const pageAnns = activeDoc.annotations[page] || [];
        const ann = pageAnns.find((a) => a.id === annId);
        if (ann) {
          const newCalcs = [...(ann.calculations || [])];
          while (newCalcs.length <= colIdx) newCalcs.push('');
          newCalcs[colIdx] = target.value;
          state.updateAnnotation(activeDoc.id, page, { ...ann, calculations: newCalcs } as any);
        }
      }
    });

    tbody.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const btnMode = target.closest('.btn-mode') as HTMLButtonElement;
      if (btnMode) {
        e.stopPropagation();
        const annId = btnMode.dataset.annId;
        const page = parseInt(btnMode.dataset.page || '0', 10);
        const state = useAppStore.getState();
        const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
        if (!activeDoc || !annId) return;

        const pageAnns = activeDoc.annotations[page] || [];
        const ann = pageAnns.find((a) => a.id === annId);
        if (ann) {
          state.updateAnnotation(activeDoc.id, page, { ...ann, isNegative: !ann.isNegative } as any);
        }
        return;
      }

      const btnDel = target.closest('.btn-del-row') as HTMLButtonElement;
      if (btnDel) {
        e.stopPropagation();
        const annId = btnDel.dataset.annId;
        const page = parseInt(btnDel.dataset.page || '0', 10);
        const state = useAppStore.getState();
        const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
        if (!activeDoc || !annId) return;

        state.deleteAnnotation(activeDoc.id, page, annId);
        return;
      }

      const tr = target.closest('tr');
      if (tr && tr.dataset.annId) {
        const annId = tr.dataset.annId;
        const page = parseInt(tr.dataset.page || '0', 10);
        const state = useAppStore.getState();
        if (state.activeDocumentId) {
          state.selectAnnotation(state.activeDocumentId, page, annId);
        }
      }
    });
  }

  win.addEventListener('beforeunload', () => {
    distPopWindow = null;
    if (unsubDist) {
      unsubDist();
      unsubDist = null;
    }
    useAppStore.getState().setDistCalculatorOpen(false);
  });

  // Initial render
  renderDistPopoutContent();

  // Subscribe to Zustand store changes
  if (unsubDist) unsubDist();
  unsubDist = useAppStore.subscribe(() => {
    renderDistPopoutContent();
  });

  win.focus();
  return win;
}

function renderDistPopoutContent() {
  if (!distPopWindow || distPopWindow.closed) return;
  const doc = distPopWindow.document;

  const state = useAppStore.getState();
  const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
  const colCount = state.distCalculatorColCount || 1;
  const unit = activeDoc?.scale?.unit || 'm';

  const badge = doc.getElementById('dist-count-badge');
  const thead = doc.getElementById('dist-thead');
  const tbody = doc.getElementById('dist-tbody');
  const tfoot = doc.getElementById('dist-tfoot');
  const empty = doc.getElementById('dist-empty');

  if (!activeDoc) {
    if (tbody) tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  // Collect distance annotations
  const distAnns: MeasureDistanceAnnotation[] = [];
  Object.values(activeDoc.annotations).forEach((pageAnns) => {
    pageAnns.forEach((ann) => {
      if (ann.type === 'measure-distance') {
        distAnns.push(ann as MeasureDistanceAnnotation);
      }
    });
  });
  distAnns.sort((a, b) => a.createdAt - b.createdAt);

  if (badge) badge.textContent = `${distAnns.length} Linien`;

  if (distAnns.length === 0) {
    if (tbody) tbody.innerHTML = '';
    if (tfoot) tfoot.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  if (empty) empty.style.display = 'none';

  // Build Table Header
  let thHtml = `<tr>
    <th style="width:30px;"></th>
    <th style="width:40px; text-align:center;">Mode</th>
    <th style="white-space:nowrap;">Seite</th>
    <th style="white-space:nowrap;">Länge (${unit})</th>`;
  for (let i = 0; i < colCount; i++) {
    thHtml += `<th style="width:90px;">Faktor ${i + 1}</th>`;
  }
  thHtml += `<th style="text-align:right; color:#4f8ef7; min-width:80px;">Resultat</th><th style="width:40px;"></th></tr>`;
  if (thead) thead.innerHTML = thHtml;

  // Build Table Rows
  let totalSum = 0;
  let trHtml = '';

  distAnns.forEach((ann) => {
    const base = parseFloat(ann.displayValue.replace(/[^\d.]/g, '')) || 0;
    const calcList = ann.calculations || [];
    const paddedCalcs = [...calcList];
    while (paddedCalcs.length < colCount) paddedCalcs.push('');

    const finalResult = parseAndEval(base, paddedCalcs.slice(0, colCount)) * (ann.isNegative ? -1 : 1);
    totalSum += finalResult;

    trHtml += `<tr class="${ann.selected ? 'selected' : ''}" data-ann-id="${ann.id}" data-page="${ann.page}">
      <td style="text-align:center;"><div class="color-dot" style="background:${ann.color || '#4f8ef7'};"></div></td>
      <td style="text-align:center;">
        <button class="btn-mode ${ann.isNegative ? 'neg' : 'pos'}" data-ann-id="${ann.id}" data-page="${ann.page}">
          ${ann.isNegative ? '-' : '+'}
        </button>
      </td>
      <td style="color:#9aa0ac;">S. ${ann.page + 1}</td>
      <td style="font-weight:bold;">${formatNum(base)}</td>`;

    for (let c = 0; c < colCount; c++) {
      const val = paddedCalcs[c] || '';
      trHtml += `<td style="padding:4px;">
        <input type="text" class="input-factor" data-ann-id="${ann.id}" data-page="${ann.page}" data-col-idx="${c}" value="${val}" placeholder="z.B. x2" />
      </td>`;
    }

    trHtml += `<td class="result-cell">${formatNum(finalResult)}</td>
      <td style="text-align:right;">
        <button class="btn-icon btn-del-row" data-ann-id="${ann.id}" data-page="${ann.page}" title="Löschen">🗑️</button>
      </td>
    </tr>`;
  });

  if (tbody) tbody.innerHTML = trHtml;

  // Build Table Footer
  if (tfoot) {
    tfoot.innerHTML = `<tr class="total-row">
      <td colSpan="${colCount + 4}" class="total-label">GESAMTSUMME</td>
      <td class="total-val">${formatNum(totalSum)}</td>
      <td></td>
    </tr>`;
  }
}

/* ==========================================================================
   VOLUMEN (∑) POP-UP WINDOW SYSTEM
   ========================================================================== */
export function openVolPopoutWindow(): Window | null {
  if (typeof window === 'undefined') return null;

  if (volPopWindow && !volPopWindow.closed) {
    volPopWindow.focus();
    renderVolPopoutContent();
    return volPopWindow;
  }

  const width = 860;
  const height = 620;
  const left = window.screen.width ? Math.max(50, Math.round((window.screen.width - width) / 2)) : 100;
  const top = window.screen.height ? Math.max(50, Math.round((window.screen.height - height) / 2)) : 100;

  const win = window.open(
    '',
    'PDF_Editor_Vol_Calc_Window',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );

  if (!win) return null;
  volPopWindow = win;

  const doc = win.document;
  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>Volumen (∑) – PDF Editor</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #232029; color: #e8eaed; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; display: flex; flex-direction: column; }
    .header { padding: 12px 16px; background: #1a1721; border-bottom: 1px solid #3d3e47; display: flex; align-items: center; justify-content: space-between; user-select: none; flex-shrink: 0; }
    .header-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
    .badge { font-size: 11px; color: #d8b4fe; background: #3b284c; padding: 2px 8px; border-radius: 4px; border: 1px solid #6b21a8; }
    .header-actions { display: flex; align-items: center; gap: 8px; }
    .btn-icon { background: transparent; border: none; cursor: pointer; color: #9aa0ac; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: color 0.15s, background 0.15s; }
    .btn-icon:hover { color: #fff; background: #3d3e47; }
    .btn-step { background: #3d3e47; border: none; border-radius: 4px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; font-weight: bold; font-size: 14px; }
    .btn-step:hover { background: #4f5260; }
    .divider { width: 1px; height: 16px; background: #3d3e47; margin: 0 2px; }
    .content { flex: 1; overflow: auto; padding: 16px; position: relative; }
    .drop-hint { padding: 8px 12px; background: rgba(147, 51, 234, 0.12); border: 1px dashed #9333ea; border-radius: 6px; margin-bottom: 12px; font-size: 11px; color: #c084fc; text-align: center; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { color: #9aa0ac; border-bottom: 1px solid #3d3e47; text-align: left; padding: 8px 4px; font-weight: 500; }
    td { padding: 8px 4px; border-bottom: 1px solid #32333b; vertical-align: middle; }
    tr.selected { background: rgba(147, 51, 234, 0.22) !important; }
    tr.no-height { color: #72768d !important; }
    tr.no-height td { color: #72768d !important; }
    tr:hover { background: rgba(255, 255, 255, 0.04); cursor: grab; }
    tr:active { cursor: grabbing; }
    .color-dot { width: 10px; height: 10px; border-radius: 50%; margin: 0 auto; }
    .btn-mode { padding: 2px 6px; border-radius: 4px; border: none; font-size: 10px; font-weight: bold; cursor: pointer; color: #fff; min-width: 24px; }
    .btn-mode.pos { background: #34a853; }
    .btn-mode.neg { background: #ea4335; }
    .input-factor { width: 80px; background: #15131b; border: 1px solid #3d3e47; border-radius: 4px; padding: 4px 8px; color: #fff; font-size: 11px; outline: none; }
    .input-factor:focus { border-color: #a855f7; }
    .input-height { width: 80px; background: #15131b; border: 1px solid #9333ea; border-radius: 4px; padding: 4px 6px; color: #a855f7; font-weight: bold; font-size: 12px; outline: none; text-align: right; }
    .input-height:placeholder-shown { border-color: #4a4b56; color: #72768d; font-weight: normal; }
    .input-height:focus { border-color: #c084fc; box-shadow: 0 0 0 2px rgba(168,85,247,0.3); }
    .result-cell { text-align: right; font-weight: bold; color: #c084fc; min-width: 90px; font-size: 13px; }
    .result-cell.empty { color: #5c6070; font-weight: normal; }
    .total-row { border-top: 2px solid #a855f7; font-weight: bold; font-size: 14px; }
    .total-label { padding: 16px 4px; }
    .total-val { padding: 16px 4px; text-align: right; color: #c084fc; font-size: 16px; }
    .empty-state { text-align: center; padding: 40px; color: #9aa0ac; font-size: 13px; border: 2px dashed #3d3e47; border-radius: 8px; margin-top: 20px; }
    .footer-tip { padding: 8px 16px; background: #1a1721; font-size: 10px; color: #9aa0ac; border-top: 1px solid #3d3e47; flex-shrink: 0; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">
      <span>Volumen (∑)</span>
      <span class="badge" id="vol-count-badge">0 Flächen</span>
    </div>
    <div class="header-actions">
      <button class="btn-icon" id="btn-delete-all" title="Alle Volumenmessungen löschen">🗑️</button>
      <div class="divider"></div>
      <button class="btn-step" id="btn-col-minus" title="Spalte entfernen">-</button>
      <button class="btn-step" id="btn-col-plus" title="Spalte hinzufügen">+</button>
      <div class="divider"></div>
      <button class="btn-icon" id="btn-close-win" title="Fenster schließen" style="font-size: 16px; font-weight: bold;">✕</button>
    </div>
  </div>

  <div class="content" id="vol-content">
    <div class="drop-hint">
      💡 <b>Hinweis:</b> Alle gezeichneten Flächen werden hier automatisch aufgelistet. Geben Sie die <b>lichte Raumhöhe (m)</b> ein, damit das Volumen berechnet wird.
    </div>
    <table id="vol-table">
      <thead id="vol-thead"></thead>
      <tbody id="vol-tbody"></tbody>
      <tfoot id="vol-tfoot"></tfoot>
    </table>
    <div id="vol-empty" class="empty-state" style="display: none;">
      Keine gezeichneten Flächen vorhanden.<br>
      • Zeichnen Sie mit dem <b>Flächen-</b> oder <b>Volumen-Werkzeug</b> Flächen auf der Karte.
    </div>
  </div>

  <div class="footer-tip">
    Tipp: Ohne Raumhöhe bleiben Flächen grau und fließen nicht in die Summe ein. Sobald Sie eine Höhe eingeben, wird das Volumen berechnet.
  </div>
</body>
</html>`);
  doc.close();

  // Attach event listeners to popup DOM elements
  const btnClose = doc.getElementById('btn-close-win');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      closeVolPopoutWindow();
    });
  }

  const btnDeleteAll = doc.getElementById('btn-delete-all');
  if (btnDeleteAll) {
    btnDeleteAll.addEventListener('click', () => {
      const state = useAppStore.getState();
      const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
      if (!activeDoc) return;
      if (confirm("Alle Volumenmessungen in diesem Dokument löschen?")) {
        Object.values(activeDoc.annotations).forEach((pageAnns) => {
          pageAnns.forEach((ann) => {
            if (ann.type === 'measure-volume') {
              state.deleteAnnotation(activeDoc.id, ann.page, ann.id);
            }
          });
        });
      }
    });
  }

  const btnColMinus = doc.getElementById('btn-col-minus');
  if (btnColMinus) {
    btnColMinus.addEventListener('click', () => {
      const state = useAppStore.getState();
      state.setVolCalculatorColCount(Math.max(1, state.volCalculatorColCount - 1));
    });
  }

  const btnColPlus = doc.getElementById('btn-col-plus');
  if (btnColPlus) {
    btnColPlus.addEventListener('click', () => {
      const state = useAppStore.getState();
      state.setVolCalculatorColCount(state.volCalculatorColCount + 1);
    });
  }

  // Table Drag & Drop and input listeners
  const tbody = doc.getElementById('vol-tbody');
  if (tbody) {
    tbody.addEventListener('dragstart', (e: DragEvent) => {
      const tr = (e.target as HTMLElement).closest('tr');
      if (tr && tr.dataset.annId) {
        e.dataTransfer?.setData('application/json', JSON.stringify({
          annId: tr.dataset.annId,
          page: parseInt(tr.dataset.page || '0', 10),
          from: 'vol'
        }));
      }
    });

    tbody.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!target) return;

      const annId = target.dataset.annId;
      const page = parseInt(target.dataset.page || '0', 10);
      if (!annId) return;

      const state = useAppStore.getState();
      const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
      if (!activeDoc) return;

      const pageAnns = activeDoc.annotations[page] || [];
      const ann = pageAnns.find((a) => a.id === annId);
      if (!ann) return;

      if (target.classList.contains('input-height')) {
        const raw = target.value.trim();
        const val = parseFloat(raw);
        if (raw === '' || isNaN(val) || val <= 0) {
          state.updateAnnotation(activeDoc.id, page, { ...ann, height: undefined } as any);
        } else {
          state.updateAnnotation(activeDoc.id, page, { ...ann, type: 'measure-volume', height: val } as any);
        }
      } else if (target.classList.contains('input-factor')) {
        const colIdx = parseInt(target.dataset.colIdx || '0', 10);
        const newCalcs = [...(ann.calculations || [])];
        while (newCalcs.length <= colIdx) newCalcs.push('');
        newCalcs[colIdx] = target.value;
        state.updateAnnotation(activeDoc.id, page, { ...ann, calculations: newCalcs } as any);
      }
    });

    tbody.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const btnMode = target.closest('.btn-mode') as HTMLButtonElement;
      if (btnMode) {
        e.stopPropagation();
        const annId = btnMode.dataset.annId;
        const page = parseInt(btnMode.dataset.page || '0', 10);
        const state = useAppStore.getState();
        const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
        if (!activeDoc || !annId) return;

        const pageAnns = activeDoc.annotations[page] || [];
        const ann = pageAnns.find((a) => a.id === annId);
        if (ann) {
          state.updateAnnotation(activeDoc.id, page, { ...ann, isNegative: !ann.isNegative } as any);
        }
        return;
      }

      const btnDel = target.closest('.btn-del-row') as HTMLButtonElement;
      if (btnDel) {
        e.stopPropagation();
        const annId = btnDel.dataset.annId;
        const page = parseInt(btnDel.dataset.page || '0', 10);
        const state = useAppStore.getState();
        const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
        if (!activeDoc || !annId) return;

        state.deleteAnnotation(activeDoc.id, page, annId);
        return;
      }

      const tr = target.closest('tr');
      if (tr && tr.dataset.annId) {
        const annId = tr.dataset.annId;
        const page = parseInt(tr.dataset.page || '0', 10);
        const state = useAppStore.getState();
        if (state.activeDocumentId) {
          state.selectAnnotation(state.activeDocumentId, page, annId);
        }
      }
    });
  }

  // Handle Drag & Drop onto the Volume window content area
  const contentArea = doc.getElementById('vol-content');
  if (contentArea) {
    contentArea.addEventListener('dragover', (e: Event) => {
      (e as DragEvent).preventDefault();
      if ((e as DragEvent).dataTransfer) {
        (e as DragEvent).dataTransfer!.dropEffect = 'move';
      }
    });
    contentArea.addEventListener('drop', (e: Event) => {
      (e as DragEvent).preventDefault();
      const dragEvent = e as DragEvent;
      const dataStr = dragEvent.dataTransfer?.getData('application/json');
      if (!dataStr) return;
      try {
        const data = JSON.parse(dataStr);
        if (data.annId && data.from === 'area') {
          const state = useAppStore.getState();
          const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
          if (!activeDoc) return;
          const pageAnns = activeDoc.annotations[data.page] || [];
          const ann = pageAnns.find((a) => a.id === data.annId);
          if (ann) {
            state.updateAnnotation(activeDoc.id, data.page, {
              ...ann,
              type: 'measure-volume'
            } as any);
          }
        }
      } catch (err) {}
    });
  }

  win.addEventListener('beforeunload', () => {
    volPopWindow = null;
    if (unsubVol) {
      unsubVol();
      unsubVol = null;
    }
    useAppStore.getState().setVolCalculatorOpen(false);
  });

  // Initial render
  renderVolPopoutContent();

  // Subscribe to Zustand store changes
  if (unsubVol) unsubVol();
  unsubVol = useAppStore.subscribe(() => {
    renderVolPopoutContent();
  });

  win.focus();
  return win;
}

function renderVolPopoutContent() {
  if (!volPopWindow || volPopWindow.closed) return;
  const doc = volPopWindow.document;

  const state = useAppStore.getState();
  const activeDoc = state.openDocuments.find((d) => d.id === state.activeDocumentId);
  const colCount = state.volCalculatorColCount || 1;
  const unit = activeDoc?.scale?.unit || 'm';

  const badge = doc.getElementById('vol-count-badge');
  const thead = doc.getElementById('vol-thead');
  const tbody = doc.getElementById('vol-tbody');
  const tfoot = doc.getElementById('vol-tfoot');
  const empty = doc.getElementById('vol-empty');

  if (!activeDoc) {
    if (tbody) tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  // Collect ALL surface annotations (volume, area, circle) so drawn areas automatically appear
  const volAnns: (MeasureVolumeAnnotation | MeasureAreaAnnotation | MeasureCircleAnnotation)[] = [];
  Object.values(activeDoc.annotations).forEach((pageAnns) => {
    pageAnns.forEach((ann) => {
      if (ann.type === 'measure-volume' || ann.type === 'measure-area' || ann.type === 'measure-circle') {
        volAnns.push(ann as any);
      }
    });
  });
  volAnns.sort((a, b) => a.createdAt - b.createdAt);

  if (badge) badge.textContent = `${volAnns.length} Flächen`;

  if (volAnns.length === 0) {
    if (tbody) tbody.innerHTML = '';
    if (tfoot) tfoot.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  if (empty) empty.style.display = 'none';

  // Build Table Header
  let thHtml = `<tr>
    <th style="width:30px;"></th>
    <th style="width:40px; text-align:center;">Mode</th>
    <th style="white-space:nowrap;">Seite</th>
    <th style="white-space:nowrap;">Grundfläche (${unit}²)</th>
    <th style="white-space:nowrap;">Lichte Höhe (m)</th>`;
  for (let i = 0; i < colCount; i++) {
    thHtml += `<th style="width:90px;">Faktor ${i + 1}</th>`;
  }
  thHtml += `<th style="text-align:right; color:#a855f7; min-width:90px;">Volumen (${unit}³)</th><th style="width:40px;"></th></tr>`;
  if (thead) thead.innerHTML = thHtml;

  // Build Table Rows
  let totalSum = 0;
  let trHtml = '';

  volAnns.forEach((ann) => {
    const baseArea = parseFloat(ann.displayValue.replace(/[^\d.]/g, '')) || 0;
    const heightVal = (ann as MeasureVolumeAnnotation).height;
    const hasHeight = heightVal !== undefined && heightVal !== null && !isNaN(heightVal) && heightVal > 0;

    const calcList = ann.calculations || [];
    const paddedCalcs = [...calcList];
    while (paddedCalcs.length < colCount) paddedCalcs.push('');

    let finalResult = 0;
    if (hasHeight) {
      const baseVol = baseArea * heightVal!;
      finalResult = parseAndEval(baseVol, paddedCalcs.slice(0, colCount)) * (ann.isNegative ? -1 : 1);
      totalSum += finalResult;
    }

    const rowClass = `${ann.selected ? 'selected' : ''} ${!hasHeight ? 'no-height' : ''}`;

    trHtml += `<tr draggable="true" class="${rowClass}" data-ann-id="${ann.id}" data-page="${ann.page}" title="${hasHeight ? 'Volumen berechnet' : 'Raumhöhe eingeben, um Volumen zu berechnen'}">
      <td style="text-align:center;"><div class="color-dot" style="background:${ann.color || '#a855f7'};"></div></td>
      <td style="text-align:center;">
        <button class="btn-mode ${ann.isNegative ? 'neg' : 'pos'}" data-ann-id="${ann.id}" data-page="${ann.page}">
          ${ann.isNegative ? '-' : '+'}
        </button>
      </td>
      <td style="color:${hasHeight ? '#9aa0ac' : '#72768d'};">S. ${ann.page + 1}</td>
      <td style="font-weight:bold; color:${hasHeight ? '#e8eaed' : '#72768d'};">${formatNum(baseArea)} ${unit}²</td>
      <td style="padding:4px;">
        <input type="number" step="0.01" min="0.1" class="input-height" data-ann-id="${ann.id}" data-page="${ann.page}" value="${hasHeight ? heightVal : ''}" placeholder="Höhe in m" />
      </td>`;

    for (let c = 0; c < colCount; c++) {
      const val = paddedCalcs[c] || '';
      trHtml += `<td style="padding:4px;">
        <input type="text" class="input-factor" data-ann-id="${ann.id}" data-page="${ann.page}" data-col-idx="${c}" value="${val}" placeholder="z.B. x2" />
      </td>`;
    }

    trHtml += `<td class="result-cell ${!hasHeight ? 'empty' : ''}">${hasHeight ? `${formatNum(finalResult)} ${unit}³` : '—'}</td>
      <td style="text-align:right;">
        <button class="btn-icon btn-del-row" data-ann-id="${ann.id}" data-page="${ann.page}" title="Löschen">🗑️</button>
      </td>
    </tr>`;
  });

  if (tbody) tbody.innerHTML = trHtml;

  // Build Table Footer
  if (tfoot) {
    tfoot.innerHTML = `<tr class="total-row">
      <td colSpan="${colCount + 5}" class="total-label">GESAMTVOLUMEN</td>
      <td class="total-val">${formatNum(totalSum)} ${unit}³</td>
      <td></td>
    </tr>`;
  }
}

export function getAreaPopoutWindow(): Window | null {
  if (areaPopWindow && !areaPopWindow.closed) return areaPopWindow;
  return null;
}

export function getDistPopoutWindow(): Window | null {
  if (distPopWindow && !distPopWindow.closed) return distPopWindow;
  return null;
}

export function getVolPopoutWindow(): Window | null {
  if (volPopWindow && !volPopWindow.closed) return volPopWindow;
  return null;
}

export function closeAreaPopoutWindow() {
  if (areaPopWindow && !areaPopWindow.closed) {
    try {
      areaPopWindow.close();
    } catch (e) {}
  }
  areaPopWindow = null;
  if (unsubArea) {
    unsubArea();
    unsubArea = null;
  }
}

export function closeDistPopoutWindow() {
  if (distPopWindow && !distPopWindow.closed) {
    try {
      distPopWindow.close();
    } catch (e) {}
  }
  distPopWindow = null;
  if (unsubDist) {
    unsubDist();
    unsubDist = null;
  }
}

export function closeVolPopoutWindow() {
  if (volPopWindow && !volPopWindow.closed) {
    try {
      volPopWindow.close();
    } catch (e) {}
  }
  volPopWindow = null;
  if (unsubVol) {
    unsubVol();
    unsubVol = null;
  }
}

