/**
 * usePluginCanvas
 *
 * Worker の canvas.*  RPC（CANVAS_FRAME / CANVAS_COMMIT_STROKE）を受け取り
 * ホスト側 HTMLCanvasElement に描画する。
 *
 * 責務:
 * - 永続レイヤー（OffscreenCanvas）へのストローク蓄積
 * - 毎フレームの合成描画（永続 + アクティブストローク + カーソル）
 * - ResizeObserver によるリサイズ追従（ストロークデータから再構築）
 * - アンマウント時のリソース解放
 *
 * カーソル描画はデータ駆動（CanvasCursorData.shape === 'custom' で
 * pathFills / pathStrokes / rotation を使用）。Host はペン形状を知らない。
 */

import type { CanvasCursorData, CanvasStrokeData } from '@ubichill/shared';
import type React from 'react';
import { useEffect, useRef } from 'react';
import type { WorkerPluginDefinition } from '../types';
import type { PluginWorkerHandlers } from '../usePluginWorker';

// ── 描画ヘルパー ─────────────────────────────────────────────────

function drawStroke(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, stroke: CanvasStrokeData): void {
    if (stroke.points.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(stroke.points[0][0], stroke.points[0][1]);
    for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i][0], stroke.points[i][1]);
    }
    ctx.stroke();
}

function drawCursor(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, cursor: CanvasCursorData): void {
    if (cursor.shape === 'custom') {
        ctx.save();
        ctx.translate(cursor.x, cursor.y);
        if (cursor.rotation !== undefined) ctx.rotate(cursor.rotation);
        for (const { d, fill } of cursor.pathFills ?? []) {
            ctx.fillStyle = fill;
            ctx.fill(new Path2D(d));
        }
        for (const { d, stroke, lineWidth } of cursor.pathStrokes ?? []) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lineWidth;
            ctx.stroke(new Path2D(d));
        }
        ctx.restore();
        return;
    }
    // デフォルト: 二重リング円形カーソル
    const r = Math.max(4, cursor.size / 2);
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = cursor.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, r + 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────

export interface UsePluginCanvasResult {
    /** canvas 要素の ref コールバック。JSX の ref prop に直接渡す。 */
    getCanvasRef: (targetId: string) => (el: HTMLCanvasElement | null) => void;
    /** usePluginWorker の handlers に spread する */
    canvasHandlers: Pick<PluginWorkerHandlers, 'onCanvasFrame' | 'onCanvasCommitStroke'>;
}

export function usePluginCanvas(
    definition: WorkerPluginDefinition,
    hostDivRef: React.RefObject<HTMLDivElement | null>,
): UsePluginCanvasResult {
    const canvasElemsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
    const permanentCanvasesRef = useRef<Map<string, OffscreenCanvas>>(new Map());
    const committedStrokesRef = useRef<Map<string, CanvasStrokeData[]>>(new Map());

    // ResizeObserver: canvas サイズをコンテナに追従させ、ストロークデータから再構築
    useEffect(() => {
        if (!definition.canvasTargets?.length || !hostDivRef.current) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = Math.round(entry.contentRect.width);
                const h = Math.round(entry.contentRect.height);
                for (const targetId of definition.canvasTargets ?? []) {
                    const canvas = canvasElemsRef.current.get(targetId);
                    if (!canvas || (canvas.width === w && canvas.height === h)) continue;
                    canvas.width = w;
                    canvas.height = h;
                    const newPerm = new OffscreenCanvas(w, h);
                    const ctx = newPerm.getContext('2d');
                    if (ctx) {
                        for (const s of committedStrokesRef.current.get(targetId) ?? []) {
                            drawStroke(ctx, s);
                        }
                    }
                    permanentCanvasesRef.current.set(targetId, newPerm);
                }
            }
        });
        // canvas は position:absolute で normal flow から外れるため hostDivRef の高さが 0 になる。
        // 代わりに entity wrapper（親要素）を観測してサイズを正しく取得する。
        observer.observe(hostDivRef.current.parentElement ?? hostDivRef.current);
        return () => observer.disconnect();
    }, [definition.canvasTargets, hostDivRef]);

    // アンマウント時のリソース解放
    useEffect(() => {
        return () => {
            permanentCanvasesRef.current.clear();
            committedStrokesRef.current.clear();
        };
    }, []);

    // ref コールバックをキャッシュして参照を安定化させる。
    // 毎レンダーで新関数を返すと React が旧コールバック(null)→新コールバック(el) を再実行し、
    // permanentCanvasesRef / committedStrokesRef が不意に消去されるのを防ぐ。
    const stableRefCallbacksRef = useRef<Map<string, (el: HTMLCanvasElement | null) => void>>(new Map());

    const getCanvasRef = (targetId: string): ((el: HTMLCanvasElement | null) => void) => {
        let cb = stableRefCallbacksRef.current.get(targetId);
        if (!cb) {
            cb = (el: HTMLCanvasElement | null) => {
                if (el) {
                    canvasElemsRef.current.set(targetId, el);
                } else {
                    canvasElemsRef.current.delete(targetId);
                    permanentCanvasesRef.current.delete(targetId);
                    committedStrokesRef.current.delete(targetId);
                }
            };
            stableRefCallbacksRef.current.set(targetId, cb);
        }
        return cb;
    };

    const canvasHandlers: Pick<PluginWorkerHandlers, 'onCanvasFrame' | 'onCanvasCommitStroke'> = {
        onCanvasFrame: (targetId, activeStroke, cursor) => {
            const canvas = canvasElemsRef.current.get(targetId);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const perm = permanentCanvasesRef.current.get(targetId);
            if (perm) ctx.drawImage(perm, 0, 0);
            if (activeStroke) drawStroke(ctx, activeStroke);
            if (cursor) drawCursor(ctx, cursor);
        },
        onCanvasCommitStroke: (targetId, stroke) => {
            const strokes = committedStrokesRef.current.get(targetId) ?? [];
            strokes.push(stroke);
            committedStrokesRef.current.set(targetId, strokes);
            const canvas = canvasElemsRef.current.get(targetId);
            if (!canvas) return;
            let perm = permanentCanvasesRef.current.get(targetId);
            if (!perm) {
                perm = new OffscreenCanvas(canvas.width || 1, canvas.height || 1);
                permanentCanvasesRef.current.set(targetId, perm);
            }
            const ctx = perm.getContext('2d');
            if (ctx) drawStroke(ctx, stroke);
        },
    };

    return { getCanvasRef, canvasHandlers };
}
