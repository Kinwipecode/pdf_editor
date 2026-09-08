'use client';
import { useAppStore, useActiveDocument } from '@/store/useAppStore';
import { MdClose, MdAdd, MdRemove, MdDelete, MdOpenInNew } from 'react-icons/md';
import React, { useState, useMemo, useEffect, useRef, memo } from 'react';
import type { MeasureAreaAnnotation, MeasureCircleAnnotation } from '@/types';
import { getAreaPopoutWindow, openAreaPopoutWindow, closeAreaPopoutWindow } from '@/lib/popoutManager';

function KropfPanelInternal() {
    const {
        calculatorOpen, setCalculatorOpen, calculatorColCount, setCalculatorColCount,
        updateAnnotation, selectAnnotation, deleteAnnotation
    } = useAppStore();
    const activeDoc = useActiveDocument();

    const [isDragging, setIsDragging] = useState(false);
    const [isPopout, setIsPopout] = useState(true);
    const [pos, setPos] = useState({ x: 100, y: 150 });
    const dragStart = useRef({ x: 0, y: 0, startX: 0, startY: 0 });

    const popWin = getAreaPopoutWindow();
    const activeIsPopout = isPopout && !!popWin && !popWin.closed;

    // Find all area annotations across all pages
    const areaAnnotations = useMemo(() => {
        if (!activeDoc) return [];
        const all: (MeasureAreaAnnotation | MeasureCircleAnnotation)[] = [];
        Object.values(activeDoc.annotations).forEach((pageAnns) => {
            pageAnns.forEach((ann) => {
                if (ann.type === 'measure-area' || ann.type === 'measure-circle') {
                    all.push(ann as any);
                }
            });
        });
        return all.sort((a, b) => a.createdAt - b.createdAt);
    }, [activeDoc?.annotations]);

    if (!calculatorOpen || !activeDoc) return null;

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
        openAreaPopoutWindow();
        setIsPopout(true);
    };

    const handleClosePanel = () => {
        closeAreaPopoutWindow();
        setCalculatorOpen(false);
    };

    const parseAndEval = (startVal: number, calculations: string[]) => {
        let current = startVal;
        calculations.forEach(opStr => {
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

    const results = areaAnnotations.map(ann => {
        const base = parseFloat(ann.displayValue.replace(/[^\d.]/g, '')) || 0;
        const calcList = ann.calculations || [];
        const paddedCalcs = [...calcList];
        while (paddedCalcs.length < calculatorColCount) paddedCalcs.push('');

        const finalResult = parseAndEval(base, paddedCalcs.slice(0, calculatorColCount)) * (ann.isNegative ? -1 : 1);
        return { ann, base, paddedCalcs, finalResult };
    });

    const totalSum = results.reduce((sum, r) => sum + r.finalResult, 0);

    const updateCalc = (ann: MeasureAreaAnnotation | MeasureCircleAnnotation, index: number, val: string) => {
        const newCalcs = [...(ann.calculations || [])];
        while (newCalcs.length <= index) newCalcs.push('');
        newCalcs[index] = val;
        updateAnnotation(activeDoc.id, ann.page, { ...ann, calculations: newCalcs } as any);
    };

    return (
        <div
            style={{
                position: 'fixed',
                left: pos.x,
                top: pos.y,
                width: 'fit-content',
                minWidth: '400px',
                maxWidth: '95vw',
                maxHeight: '80vh',
                backgroundColor: '#2a2b30',
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
                    background: '#1e1f24',
                    borderBottom: '1px solid #3d3e47',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    userSelect: 'none'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>Flächen (∑)</span>
                    <span style={{ fontSize: '11px', color: '#9aa0ac', background: '#3d3e47', padding: '2px 6px', borderRadius: '4px' }}>
                        {areaAnnotations.length} Flächen
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => {
                            if (confirm("Alle Flächenmessungen in diesem Dokument löschen?")) {
                                areaAnnotations.forEach(ann => deleteAnnotation(activeDoc.id, ann.page, ann.id));
                            }
                        }}
                        style={{
                            background: 'transparent', border: 'none', cursor: 'pointer', color: '#9aa0ac',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}
                        title="Alle Flächen löschen"
                    >
                        <MdDelete size={18} />
                    </button>
                    <div style={{ width: '1px', height: '16px', background: '#3d3e47', margin: '0 4px' }} />
                    <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setCalculatorColCount(Math.max(1, calculatorColCount - 1))}
                        style={{
                            background: '#3d3e47', border: 'none', borderRadius: '4px', width: '24px', height: '24px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff'
                        }}
                        title="Spalte entfernen"
                    >
                        <MdRemove size={16} />
                    </button>
                    <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setCalculatorColCount(calculatorColCount + 1)}
                        style={{
                            background: '#3d3e47', border: 'none', borderRadius: '4px', width: '24px', height: '24px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff'
                        }}
                        title="Spalte hinzufügen"
                    >
                        <MdAdd size={16} />
                    </button>
                    <div style={{ width: '1px', height: '16px', background: '#3d3e47', margin: '0 4px' }} />
                    <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={handleTogglePopout}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '3px 6px',
                            cursor: 'pointer',
                            color: '#9aa0ac',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            fontSize: '11px',
                            fontWeight: 500
                        }}
                        title="Als eigenes App-Fenster (auf 2. Bildschirm) öffnen"
                    >
                        <MdOpenInNew size={16} />
                        <span>Pop-out</span>
                    </button>
                    <div style={{ width: '1px', height: '16px', background: '#3d3e47', margin: '0 4px' }} />
                    <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={handleClosePanel}
                        style={{
                            background: 'transparent', border: 'none', cursor: 'pointer', color: '#9aa0ac'
                        }}
                    >
                        <MdClose size={20} />
                    </button>
                </div>
            </div>

            {/* Table Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                        <tr style={{ color: '#9aa0ac', borderBottom: '1px solid #3d3e47', textAlign: 'left' }}>
                            <th style={{ padding: '8px 4px', fontWeight: 500, width: '30px' }}></th>
                            <th style={{ padding: '8px 4px', fontWeight: 500, width: '40px' }}>Mode</th>
                            <th style={{ padding: '8px 4px', fontWeight: 500, whiteSpace: 'nowrap' }}>Seite</th>
                            <th style={{ padding: '8px 4px', fontWeight: 500, whiteSpace: 'nowrap' }}>Fläche ({activeDoc.scale.unit}²)</th>
                            {Array.from({ length: calculatorColCount }).map((_, i) => (
                                <th key={i} style={{ padding: '8px 4px', fontWeight: 500, width: '90px' }}>Faktor {i + 1}</th>
                            ))}
                            <th style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 600, color: '#4f8ef7', minWidth: '80px' }}>Resultat</th>
                            <th style={{ padding: '8px 4px', width: '40px' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {results.map(({ ann, base, paddedCalcs, finalResult }) => (
                            <tr
                                key={ann.id}
                                onClick={() => selectAnnotation(activeDoc.id, ann.page, ann.id)}
                                style={{
                                    borderBottom: '1px solid #32333b',
                                    transition: 'background 0.1s',
                                    backgroundColor: ann.selected ? 'rgba(79, 142, 247, 0.15)' : 'transparent',
                                    cursor: 'pointer'
                                }}
                            >
                                <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: ann.color, margin: '0 auto' }} />
                                </td>
                                <td style={{ padding: '8px 4px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                    <button
                                        onClick={() => updateAnnotation(activeDoc.id, ann.page, { ...ann, isNegative: !ann.isNegative } as any)}
                                        style={{
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            background: ann.isNegative ? '#ea4335' : '#34a853',
                                            color: '#fff',
                                            border: 'none',
                                            fontSize: '10px',
                                            fontWeight: 'bold',
                                            cursor: 'pointer',
                                            minWidth: '24px'
                                        }}
                                    >
                                        {ann.isNegative ? '-' : '+'}
                                    </button>
                                </td>
                                <td style={{ padding: '8px 4px', color: '#5f6368' }}>S. {ann.page + 1}</td>
                                <td style={{ padding: '8px 4px', fontWeight: 'bold' }}>{base.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                {Array.from({ length: calculatorColCount }).map((_, colIndex) => (
                                    <td key={colIndex} style={{ padding: '4px' }} onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="text"
                                            value={paddedCalcs[colIndex] || ''}
                                            onChange={(e) => updateCalc(ann, colIndex, e.target.value)}
                                            placeholder="z.B. x2"
                                            style={{
                                                width: '80px',
                                                background: '#1a1b1e',
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
                                <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 'bold', color: '#fff' }}>
                                    {finalResult.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deleteAnnotation(activeDoc.id, ann.page, ann.id); }}
                                        style={{ background: 'transparent', border: 'none', color: '#5f6368', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                        title="Löschen"
                                    >
                                        <MdDelete size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr style={{ borderTop: '2px solid #4f8ef7' }}>
                            <td colSpan={calculatorColCount + 4} style={{ padding: '16px 4px', fontWeight: 'bold', fontSize: '14px' }}>GESAMTSUMME</td>
                            <td style={{ padding: '16px 4px', textAlign: 'right', fontWeight: 'bold', fontSize: '14px', color: '#4f8ef7' }}>
                                {totalSum.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                        </tr>
                    </tfoot>
                </table>

                {areaAnnotations.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#5f6368' }}>
                        Keine Flächenmessungen gefunden. Messen Sie zuerst einige Flächen.
                    </div>
                )}
            </div>

            {/* Footer Info */}
            <div style={{ padding: '8px 16px', background: '#1e1f24', fontSize: '10px', color: '#5f6368', borderTop: '1px solid #3d3e47' }}>
                Tipp: Geben Sie Operationen wie 'x2', '+10', '-5' oder ':2' in die Felder ein.
            </div>
        </div>
    );
}

export const KropfPanel = memo(KropfPanelInternal);
