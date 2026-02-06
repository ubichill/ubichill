import type { WorldEntity } from '@ubichill/shared';
// React is peer dependency
import type React from 'react';
import type { ReactNode } from 'react';

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
    type: 'pen:pen';
}

export interface StrokeEntity extends WorldEntity<StrokeData> {
    type: 'stroke';
}

export interface WidgetDefinition<T = unknown> {
    id: string;
    name: string;
    icon: ReactNode;
    defaultSize: { w: number; h: number };
    defaultData: T;
    Component: React.FC<{
        entity: WorldEntity<T>;
        isLocked: boolean;
        update: (patch: Partial<WorldEntity<T>>) => void;
        ephemeral?: unknown;
        broadcast?: (data: unknown) => void;
    }>;
    SingletonComponent?: React.FC;
}
