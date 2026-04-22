import type { CanvasCursorData, CanvasStrokeData } from '@ubichill/shared';
import type { SendFn } from '../types';

export type CanvasModule = {
    frame(
        targetId: string,
        options: { activeStroke?: CanvasStrokeData | null; cursor?: CanvasCursorData | null },
    ): void;
    commitStroke(targetId: string, stroke: CanvasStrokeData): void;
};

export function createCanvasModule(send: SendFn): CanvasModule {
    return {
        frame: (targetId, options) =>
            send({
                type: 'CANVAS_FRAME',
                payload: {
                    targetId,
                    activeStroke: options.activeStroke ?? null,
                    cursor: options.cursor ?? null,
                },
            }),
        commitStroke: (targetId, stroke) => send({ type: 'CANVAS_COMMIT_STROKE', payload: { targetId, stroke } }),
    };
}
