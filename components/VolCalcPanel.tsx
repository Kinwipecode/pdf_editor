'use client';
import { useAppStore, useActiveDocument } from '@/store/useAppStore';
import { MdClose, MdAdd, MdRemove, MdDelete, MdOpenInNew } from 'react-icons/md';
import React, { useState, useMemo, useRef, memo } from 'react';
import type { MeasureVolumeAnnotation } from '@/types';
import { getVolPopoutWindow, openVolPopoutWindow, closeVolPopoutWindow } from '@/lib/popoutManager';

function VolCalcPanelInternal() {
    const {
        volCalculatorOpen, setVolCalculatorOpen, volCalculatorColCount, setVolCalculatorColCount,
        defaultRoomHeight, setDefaultRoomHeight,
        updateAnnotation, selectAnnotation, deleteAnnotation
    } = useAppStore();
    const activeDoc = useActiveDocument();

    const [isDragging, setIsDragging] = useState(false);
    const [isPopout, setIsPopout] = useState(true);
    const [pos, setPos] = useState({ x: 200, y: 220 });
    const dragStart = useRef({ x: 0, y: 0, startX: 0, startY: 0 });

    const popWin = getVolPopoutWindow();
    const activeIsPopout = isPopout && !!popWin && !popWin.closed;

    // Find all volume annotations across all pages
    const volumeAnnotations = useMemo(() => {
        if (!activeDoc) return [];
        const all: MeasureVolumeAnnotation[] = [];
        Object.values(activeDoc.annotations).forEach((pageAnns) => {
            pageAnns.forEach((ann) => {
                if (ann.type === 'measure-volume') {
                    all.push(ann as MeasureVolumeAnnotation);
                }
            });
        });
        return all.sort((a, b) => a.createdAt - b.createdAt);
    }, [activeDoc?.annotations]);

    if (!volCalculatorOpen || !activeDoc) return null;

    // If popout window is active, popoutManager renders inside popWin HTML document
    if (activeIsPopout) return null;

    const handleDragDown = (e: React.PointerEvent) => {
        setIsDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY, startX: pos.x, startY: pos.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handleDragMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        setPos({ x: dragStart.current.startX + dx, y: dragStart.current.startY + dy });
    };

    const handleDragUp = (e: React.PointerEvent) => {
        setIsDragging(false);
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    };

    const handleTogglePopout = () => {
        openVolPopoutWindow();
        setIsPopout(true);
    };

    const handleClosePanel = () => {
        closeVolPopoutWindow();
        setVolCalculatorOpen(false);
    };

    const parseAndEval = (startVal: number, calculations: string[]) => {
        let current = startVal;
        (calculations || []).forEach(opStr => {
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
    };

    const formatNum = (num: number) => {
        return num.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const results = volumeAnnotations.map(ann => {
        const baseArea = parseFloat(ann.displayValue.replace(/[^\d.]/g, '')) || 0;
        const height = ann.height ?? (defaultRoomHeight || 2.50);
        const baseVol = baseArea * height;

        const calcList = ann.calculations || [];
        const paddedCalcs = [...calcList];
        while (paddedCalcs.length < volCalculatorColCount) paddedCalcs.push('');

        const finalResult = parseAndEval(baseVol, paddedCalcs.slice(0, volCalculatorColCount)) * (ann.isNegative ? -1 : 1);
        return { ann, baseArea, height, paddedCalcs, finalResult };
    });

    const totalSum = results.reduce((sum, r) => sum + r.finalResult, 0);

    const updateHeight = (ann: MeasureVolumeAnnotation, val: number) => {
        updateAnnotation(activeDoc.id, ann.page, { ...ann, height: val } as any);
    };

    const updateCalc = (ann: MeasureVolumeAnnotation, index: number, val: string) => {
        const newCalcs = [...(ann.calculations || [])];
        while (newCalcs.length <= index) newCalcs.push('');
        newCalcs[index] = val;
        updateAnnotation(activeDoc.id, ann.page, { ...ann, calculations: newCalcs } as any);
    };

    const unit = activeDoc.scale?.unit || 'm';

    const handleDropArea = (e: React.DragEvent) => {
        e.preventDefault();
        const dataStr = e.dataTransfer.getData('application/json');
        if (!dataStr) return;
        try {
            const data = JSON.parse(dataStr);
            if (data.annId && data.from === 'area') {
                const pageAnns = activeDoc.annotations[data.page] || [];
                const ann = pageAnns.find((a) => a.id === data.annId);
                if (ann) {
                    updateAnnotation(activeDoc.id, data.page, {
                        ...ann,
                        type: 'measure-volume',
                        height: (ann as any).height ?? (defaultRoomHeight || 2.50)
                    } as any);
                }
            }
        } catch (err) {}
    };

    return (
        <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropArea}
            style={{
                position: 'fixed',
                left: pos.x,
                top: pos.y,
                width: 'fit-content',
                minWidth: '450px',
                maxWidth: '95vw',
                maxHeight: '80vh',
                backgroundColor: '#232029',
                border: '1px solid #3d3e47',
                borderRadius: '12px',
                boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 100000,
                overflow: 'hidden',
                color: '#e8eaed'
            }}
        >
            {/* Header */}
            <div
                onPointerDown={handleDragDown}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragUp}
                style={{
                    padding: '12px 16px',
                    background: '#1a1721',
                    borderBottom: '1px solid #3d3e47',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    userSelect: 'none'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>Volumen (∑)</span>
                    <span style={{ fontSize: '11px', color: '#d8b4fe', background: '#3b284c', border: '1px solid #6b21a8', padding: '2px 8px', borderRadius: '4px' }}>
                        {volumeAnnotations.length} Räume
                    </span>
                    <span style={{ fontSize: '11px', color: '#9aa0ac', marginLeft: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Std.-Höhe:
                        <input
                            type="number"
                            step="0.01"
                            min="0.1"
                            value={defaultRoomHeight || 2.50}
                            onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val) && val > 0) setDefaultRoomHeight(val);
                            }}
                            style={{
                                width: '55px',
                                background: '#15131b',
                                border: '1px solid #9333ea',
                                borderRadius: '4px',
                                padding: '2px 4px',
                                color: '#a855f7',
                                fontWeight: 'bold',
                                fontSize: '11px',
                                textAlign: 'right',
                                outline: 'none'
                            }}
                        /> m
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        onClick={handleTogglePopout}
                        title="Als Pop-up-Fenster auf 2. Bildschirm öffnen"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#9aa0ac',
                            padding: '4px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        <MdOpenInNew size={16} />
                    </button>
                    <button
                        onClick={() => setVolCalculatorColCount(Math.max(1, volCalculatorColCount - 1))}
                        title="Spalte entfernen"
                        style={{
                            background: '#3d3e47',
                            border: 'none',
                            borderRadius: '4px',
                            width: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: '#fff'
                        }}
                    >
                        <MdRemove size={14} />
                    </button>
                    <button
                        onClick={() => setVolCalculatorColCount(volCalculatorColCount + 1)}
                        title="Spalte hinzufügen"
                        style={{
                            background: '#3d3e47',
                            border: 'none',
                            borderRadius: '4px',
                            width: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: '#fff'
                        }}
                    >
                        <MdAdd size={14} />
                    </button>
                    <div style={{ width: '1px', height: '16px', backgroundColor: '#3d3e47', margin: '0 4px' }} />
                    <button
                        onClick={handleClosePanel}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#9aa0ac',
                            padding: '4px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        <MdClose size={18} />
                    </button>
                </div>
            </div>

            {/* Table Area */}
            <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>
                <div style={{
                    padding: '8px 12px',
                    background: 'rgba(147, 51, 234, 0.12)',
                    border: '1px dashed #9333ea',
                    borderRadius: '6px',
                    marginBottom: '12px',
                    fontSize: '11px',
                    color: '#c084fc',
                    textAlign: 'center'
                }}>
                    📦 <b>Drag & Drop:</b> Gezeichnete Flächen aus dem Flächen-Fenster hierher ziehen!
                </div>

                {volumeAnnotations.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 20px', color: '#9aa0ac', fontSize: '13px', border: '2px dashed #3d3e47', borderRadius: '8px' }}>
                        Keine Raum-Volumen vorhanden.<br />
                        Zeichnen Sie mit dem <b>Volumen-Werkzeug</b> oder ziehen Sie Flächen hier hinein.
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                            <tr style={{ color: '#9aa0ac', borderBottom: '1px solid #3d3e47', textAlign: 'left' }}>
                                <th style={{ padding: '8px 4px', width: '30px' }}></th>
                                <th style={{ padding: '8px 4px', width: '40px', textAlign: 'center' }}>Mode</th>
                                <th style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>Seite</th>
                                <th style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>Grundfläche ({unit}²)</th>
                                <th style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>Lichte Höhe (m)</th>
                                {Array.from({ length: volCalculatorColCount }).map((_, i) => (
                                    <th key={i} style={{ padding: '8px 4px', width: '90px' }}>Faktor {i + 1}</th>
                                ))}
                                <th style={{ padding: '8px 4px', textAlign: 'right', color: '#a855f7', minWidth: '90px' }}>Volumen ({unit}³)</th>
                                <th style={{ padding: '8px 4px', width: '40px' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map(({ ann, baseArea, height, paddedCalcs, finalResult }) => (
                                <tr
                                    key={ann.id}
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('application/json', JSON.stringify({
                                            annId: ann.id,
                                            page: ann.page,
                                            from: 'vol'
                                        }));
                                    }}
                                    onClick={() => selectAnnotation(activeDoc.id, ann.page, ann.id)}
                                    style={{
                                        borderBottom: '1px solid #32333b',
                                        backgroundColor: ann.selected ? 'rgba(147, 51, 234, 0.22)' : 'transparent',
                                        cursor: 'grab'
                                    }}
                                >
                                    <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: ann.color || '#a855f7', margin: '0 auto' }} />
                                    </td>
                                    <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                updateAnnotation(activeDoc.id, ann.page, { ...ann, isNegative: !ann.isNegative } as any);
                                            }}
                                            style={{
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                border: 'none',
                                                fontSize: '10px',
                                                fontWeight: 'bold',
                                                cursor: 'pointer',
                                                color: '#fff',
                                                backgroundColor: ann.isNegative ? '#ea4335' : '#34a853',
                                                minWidth: '24px'
                                            }}
                                        >
                                            {ann.isNegative ? '-' : '+'}
                                        </button>
                                    </td>
                                    <td style={{ padding: '8px 4px', color: '#9aa0ac' }}>S. {ann.page + 1}</td>
                                    <td style={{ padding: '8px 4px', fontWeight: 'bold' }}>{formatNum(baseArea)} {unit}²</td>
                                    <td style={{ padding: '4px' }}>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0.1"
                                            value={height}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value);
                                                if (!isNaN(val) && val > 0) updateHeight(ann, val);
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                                width: '68px',
                                                backgroundColor: '#15131b',
                                                border: '1px solid #9333ea',
                                                borderRadius: '4px',
                                                padding: '4px 6px',
                                                color: '#a855f7',
                                                fontWeight: 'bold',
                                                fontSize: '12px',
                                                outline: 'none',
                                                textAlign: 'right'
                                            }}
                                        />
                                    </td>
                                    {Array.from({ length: volCalculatorColCount }).map((_, cIdx) => (
                                        <td key={cIdx} style={{ padding: '4px' }}>
                                            <input
                                                type="text"
                                                value={paddedCalcs[cIdx] || ''}
                                                onChange={(e) => updateCalc(ann, cIdx, e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                                placeholder="z.B. x2"
                                                style={{
                                                    width: '80px',
                                                    backgroundColor: '#15131b',
                                                    border: '1px solid #3d3e47',
                                                    borderRadius: '4px',
                                                    padding: '4px 8px',
                                                    color: '#fff',
                                                    fontSize: '11px',
                                                    outline: 'none'
                                                }}
                                            />
                                        </td>
                                    ))}
                                    <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 'bold', color: '#c084fc', minWidth: '90px', fontSize: '13px' }}>
                                        {formatNum(finalResult)} {unit}³
                                    </td>
                                    <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteAnnotation(activeDoc.id, ann.page, ann.id);
                                            }}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                color: '#9aa0ac',
                                                padding: '4px',
                                                borderRadius: '4px'
                                            }}
                                            title="Löschen"
                                        >
                                            <MdDelete size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr style={{ borderTop: '2px solid #a855f7', fontWeight: 'bold', fontSize: '14px' }}>
                                <td colSpan={volCalculatorColCount + 5} style={{ padding: '16px 4px' }}>GESAMTVOLUMEN</td>
                                <td style={{ padding: '16px 4px', textAlign: 'right', color: '#c084fc', fontSize: '16px' }}>{formatNum(totalSum)} {unit}³</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                )}
            </div>

            {/* Footer */}
            <div style={{ padding: '8px 16px', background: '#1a1721', fontSize: '10px', color: '#9aa0ac', borderTop: '1px solid #3d3e47' }}>
                Tipp: Geben Sie in der Spalte 'Lichte Höhe (m)' die jeweilige Raumhöhe ein. Das Volumen wird automatisch berechnet.
            </div>
        </div>
    );
}

export const VolCalcPanel = memo(VolCalcPanelInternal);
