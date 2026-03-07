import type { WorldEntity } from '@ubichill/sdk';

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
    type: 'pen:pen';
}

export interface StrokeEntity extends WorldEntity<StrokeData> {
    type: 'stroke';
}
