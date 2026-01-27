import type { WorldEntity } from '@ubichill/shared';

export interface PenData {
    color: string;
    strokeWidth: number;
    isHeld: boolean;
}

export interface StrokeData {
    points: number[][];
    color: string;
    size: number;
}

// Legacy alias if needed, or just replace usage
// export type Stroke = StrokeData;

export interface PenStream {
    currentPoints?: number[][];
    penPosition?: { x: number; y: number };
}

export interface DrawingData {
    points: number[][];
    color: string;
    size: number;
}

export interface PenEntity extends WorldEntity<PenData> {
    type: 'pen';
}

export interface StrokeEntity extends WorldEntity<StrokeData> {
    type: 'stroke';
}
