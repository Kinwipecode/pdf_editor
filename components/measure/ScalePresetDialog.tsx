'use client';
import { useState } from 'react';

interface ScalePresetDialogProps {
  onConfirm: (pixelsPerUnit: number, unit: string, ratio: number) => void;
  onCancel: () => void;
  initialRatio?: number;
  initialUnit?: string;
}

const COMMON_PRESETS = [
  { label: '1:1', ratio: 1, desc: 'Original (1:1)' },
  { label: '1:10', ratio: 10, desc: 'Detail 1:10' },
  { label: '1:20', ratio: 20, desc: 'Detail 1:20' },
  { label: '1:25', ratio: 25, desc: 'Detail 1:25' },
  { label: '1:50', ratio: 50, desc: 'Ausführung 1:50' },
  { label: '1:100', ratio: 100, desc: 'Grundriss 1:100' },
  { label: '1:200', ratio: 200, desc: 'Übersicht 1:200' },
  { label: '1:500', ratio: 500, desc: 'Lageplan 1:500' },
  { label: '1:1000', ratio: 1000, desc: 'Kataster 1:1000' },
];

export function calculateScalePixelsPerUnit(ratio: number, unit: string): number {
  const BASE_POINTS_PER_MM = 2.834645669291339; // 72 / 25.4
  const BASE_POINTS_PER_CM = 28.346456692913388;
  const BASE_POINTS_PER_M = 2834.6456692913388;

  const validRatio = Math.max(0.0001, ratio);

  if (unit === 'mm') return BASE_POINTS_PER_MM / validRatio;
  if (unit === 'cm') return BASE_POINTS_PER_CM / validRatio;
  // default to meters
  return BASE_POINTS_PER_M / validRatio;
}

export function ScalePresetDialog({
  onConfirm,
  onCancel,
  initialRatio = 100,
  initialUnit = 'm',
}: ScalePresetDialogProps) {
  const [ratioInput, setRatioInput] = useState<string>(String(initialRatio));
  const [unit, setUnit] = useState<string>(initialUnit || 'm');

  const numericRatio = parseFloat(ratioInput) || 100;
  const pixelsPerUnit = calculateScalePixelsPerUnit(numericRatio, unit);

  const handleConfirm = () => {
    const r = parseFloat(ratioInput);
    if (isNaN(r) || r <= 0) return;
    const pxPerUnit = calculateScalePixelsPerUnit(r, unit);
    onConfirm(pxPerUnit, unit, r);
  };

  // Preview info text: 1 cm on paper equals X meters in reality
  const realValInUnit = (1 * numericRatio) / (unit === 'm' ? 100 : unit === 'mm' ? 10 : 1);
  const previewText = `1 cm auf dem Papier = ${realValInUnit.toLocaleString('de-DE', { maximumFractionDigits: 3 })} ${unit} in Wirklichkeit`;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ minWidth: 420, maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
        <h3>Architekten-Maßstab einstellen (1:X)</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Wählen Sie den Maßstab des Dokuments oder geben Sie das Verhältnis direkt ein (z.&nbsp;B. 1:100 für Grundrisse, 1:50 für Ausführungspläne).
        </p>

        {/* Schnell-Auswahl Tasten */}
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6, fontWeight: 600 }}>
            HÄUFIGE MAßSTÄBE:
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {COMMON_PRESETS.map((p) => {
              const isSelected = numericRatio === p.ratio;
              return (
                <button
                  key={p.ratio}
                  type="button"
                  onClick={() => setRatioInput(String(p.ratio))}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: `1px solid ${isSelected ? '#4f8ef7' : 'var(--border)'}`,
                    background: isSelected ? 'rgba(79, 142, 247, 0.25)' : 'var(--bg-app)',
                    color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                    fontWeight: isSelected ? 600 : 400,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{p.label}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{p.desc.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Eigene Eingabe */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Verhältnis (1 : X)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>1 :</span>
              <input
                autoFocus
                type="number"
                min="0.1"
                step="any"
                className="modal-input"
                value={ratioInput}
                onChange={(e) => setRatioInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                placeholder="z.B. 100"
              />
            </div>
          </div>

          <div style={{ width: 120 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Messeinheit
            </label>
            <select
              className="modal-select"
              style={{ width: '100%' }}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              <option value="m">Meter (m)</option>
              <option value="cm">Zentimeter (cm)</option>
              <option value="mm">Millimeter (mm)</option>
            </select>
          </div>
        </div>

        {/* Vorschau-Box */}
        <div style={{
          marginTop: 12,
          padding: '10px 12px',
          background: 'rgba(79, 142, 247, 0.1)',
          border: '1px solid rgba(79, 142, 247, 0.3)',
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--text-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4
        }}>
          <div style={{ fontWeight: 600, color: '#4f8ef7' }}>
            📐 Vorschau: Maßstab 1:{numericRatio}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
            • {previewText}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 10, fontFamily: 'monospace' }}>
            Rechnerisch: {pixelsPerUnit.toFixed(2)} px / {unit} (72 DPI Referenz)
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-secondary" onClick={onCancel}>Abbrechen</button>
          <button className="btn-primary" onClick={handleConfirm}>Maßstab übernehmen</button>
        </div>
      </div>
    </div>
  );
}
