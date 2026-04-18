/**
 * Pen Plugin - 描画状態の型定義。
 * canvas.worker.ts の Ubi.state.define で使用する。
 */

export interface DrawStateData {
    heldPenId: string | null;
    color: string;
    strokeWidth: number;
    isDrawing: boolean;
    currentStroke: Array<[x: number, y: number, pressure: number]>;
    cursorX: number;
    cursorY: number;
}
