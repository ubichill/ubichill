import type { WorldEntity } from '@ubichill/shared';

export interface CursorData {
    url: string;
    hotspot?: { x: number; y: number };
}

export interface CursorEntity extends WorldEntity<CursorData> {
    type: 'cursor';
}
