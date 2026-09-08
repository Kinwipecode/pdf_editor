// ──────────────────────────────────────────────
//  Tool Types
// ──────────────────────────────────────────────
export type ToolType =
  | 'cursor'
  | 'cursor-lasso'
  | 'hand'
  | 'text'
  | 'highlight'
  | 'freehand'
  | 'callout'
  | 'measure-distance'
  | 'measure-area'
  | 'measure-circle'
  | 'measure-magic-area'
  | 'measure-spray-area'
  | 'measure-rough-area'
  | 'measure-calibrate'
  | 'zoom-area'
  | 'direct-edit'
  | 'ocr-select'
  | 'eraser'
  | 'rect-shape'
  | 'circle-shape'
  | 'line-shape'
  | 'arrow-shape'
  | 'double-arrow-shape'
  | 'arrow-dashed'
  | 'arrow-filled'
  | 'arrow-measurement'
  | 'arrow-block'
  | 'arrow-curved'
  | 'arrow-zigzag'
  | 'fill-tool';

// ──────────────────────────────────────────────
//  Annotation Types
// ──────────────────────────────────────────────
export type AnnotationType =
  | 'highlight'
  | 'freehand'
  | 'callout'
  | 'text'
  | 'measure-distance'
  | 'measure-area'
  | 'measure-circle'
  | 'rect-shape'
  | 'circle-shape'
  | 'line-shape'
  | 'arrow-shape'
  | 'double-arrow-shape'
  | 'arrow-dashed'
  | 'arrow-filled'
  | 'arrow-measurement'
  | 'arrow-block'
  | 'arrow-curved'
  | 'arrow-zigzag';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BaseAnnotation {
  id: string;
  type: AnnotationType;
  page: number;
  color: string;       // Stroke color
  fillColor?: string;  // Fill color
  strokeWidth?: number;
  opacity: number;
  createdAt: number;
  selected?: boolean;
}

export interface HighlightAnnotation extends BaseAnnotation {
  type: 'highlight';
  rect: Rect;
}

export interface FreehandAnnotation extends BaseAnnotation {
  type: 'freehand';
  points: Point[];
  strokeWidth: number;
}

export interface CalloutAnnotation extends BaseAnnotation {
  type: 'callout';
  rect: Rect;
  tailPoint: Point;
  text: string;
  fontSize: number;
  hidden?: boolean;
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  position: Point;
  text: string;
  fontSize: number;
  isOcr?: boolean;
  width?: number;
  height?: number;
}

export interface MeasureDistanceAnnotation extends BaseAnnotation {
  type: 'measure-distance';
  points: Point[]; // Multi-point path
  displayValue: string;
  unit: string;
  calculations?: string[]; // Array of operations like ["x2", "+20"]
  isNegative?: boolean;
}

export interface MeasureAreaAnnotation extends BaseAnnotation {
  type: 'measure-area';
  points: Point[];
  displayValue: string;
  unit: string;
  calculations?: string[]; // Array of operations like ["*2", "+20"]
  isNegative?: boolean;
}

export interface MeasureCircleAnnotation extends BaseAnnotation {
  type: 'measure-circle';
  center: Point;
  radius: number;
  displayValue: string;
  unit: string;
  calculations?: string[];
  isNegative?: boolean;
}

export interface ShapeAnnotation extends BaseAnnotation {
  type:
  | 'rect-shape'
  | 'circle-shape'
  | 'line-shape'
  | 'arrow-shape'
  | 'double-arrow-shape'
  | 'arrow-dashed'
  | 'arrow-filled'
  | 'arrow-measurement'
  | 'arrow-block'
  | 'arrow-curved'
  | 'arrow-zigzag';
  start: Point;
  end: Point;
  doubleSided?: boolean;
  textContent?: string;
  textColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  textOffset?: number;
  headLength?: number;
  headWidth?: number;
  shaftWidth?: number;
  fontSize?: number;
}

export type Annotation =
  | HighlightAnnotation
  | FreehandAnnotation
  | CalloutAnnotation
  | TextAnnotation
  | MeasureDistanceAnnotation
  | MeasureAreaAnnotation
  | MeasureCircleAnnotation
  | ShapeAnnotation;

// ──────────────────────────────────────────────
//  Scale / Calibration
// ──────────────────────────────────────────────
export interface MeasureScale {
  pixelsPerUnit: number; // px / unit in PDF canvas space
  unit: string;          // e.g. "mm", "m", "ft", "in"
}

// ──────────────────────────────────────────────
//  Document / Tab State
// ──────────────────────────────────────────────
export interface OpenDocument {
  id: string;
  fileName: string;
  fileUrl: string;           // Object URL
  fileType: 'pdf' | 'image';
  pageCount: number;
  currentPage: number;
  zoom: number;              // 1.0 = 100%
  rotation: number;          // degrees
  annotations: Record<number, Annotation[]>;
  history: Array<Record<number, Annotation[]>>;
  historyIndex: number;
  scale: MeasureScale;
  thumbnailsReady: boolean;
  annotationsVisible: boolean;
  pageOrder: (number | string)[]; // original page numbers 1-indexed, or 'blank_uuid'
}