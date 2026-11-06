import { CommandType } from '@ubichill/shared/mod/protocol';
import type { CanvasCursorData, CanvasStrokeData } from '@ubichill/shared/mod/types';
import type { SendFn } from '../types';

export type CanvasModule = {
    /**
     * 毎フレームのキャンバス描画状態をホストに送信する。
     * `cursors` は配列 (自分 + リモートユーザーぶん) を一度に渡す。
     */
    frame(targetId: string, options: { activeStroke?: CanvasStrokeData | null; cursors?: CanvasCursorData[] }): void;
    /** 確定したストロークを永続レイヤーの一番上に重ねる。 */
    commitStroke(targetId: string, stroke: CanvasStrokeData): void;
    /**
     * 永続レイヤーを消し、`strokes` をこの順で描き直す。消すストローク（`mode: 'erase'`）は重ねる順で
     * 結果が変わるので、先に描いたストロークの順番が後から決まったとき（サーバーの順と違った・保存に失敗した）に使う。
     */
    replaceStrokes(targetId: string, strokes: readonly CanvasStrokeData[]): void;
};

export function createCanvasModule(send: SendFn): CanvasModule {
    return {
        frame: (targetId, options) =>
            send({
                type: CommandType.CANVAS_FRAME,
                payload: {
                    targetId,
                    activeStroke: options.activeStroke ?? null,
                    cursors: options.cursors ?? [],
                },
            }),
        commitStroke: (targetId, stroke) =>
            send({ type: CommandType.CANVAS_COMMIT_STROKE, payload: { targetId, stroke } }),
        replaceStrokes: (targetId, strokes) =>
            send({ type: CommandType.CANVAS_REPLACE_STROKES, payload: { targetId, strokes: [...strokes] } }),
    };
}
