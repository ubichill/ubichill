import type { CanvasStrokeData } from 'ubichill';
import { describe, expect, it } from 'vitest';
import {
    type CanvasUpdate,
    confirmStroke,
    drawPending,
    dropPending,
    EMPTY_STROKE_ORDER,
    type StrokeOrder,
    type StrokeOrderStep,
    sameStroke,
    strokesInOrder,
} from './strokeOrder';

const stroke = (name: string, mode?: 'erase'): CanvasStrokeData => ({
    points: [
        [0, 0, 1],
        [name.length, 1, 1],
    ],
    color: name,
    size: 4,
    ...(mode ? { mode } : {}),
});

/** 1 人のクライアント: 順番の状態と、Host の永続レイヤーに実際に重なったストローク。 */
interface Client {
    order: StrokeOrder;
    canvas: readonly CanvasStrokeData[];
}

const applyToCanvas = (canvas: readonly CanvasStrokeData[], update: CanvasUpdate): readonly CanvasStrokeData[] => {
    if (update.kind === 'append') return [...canvas, update.stroke];
    if (update.kind === 'redraw') return update.strokes;
    return canvas;
};

const step = (client: Client, next: StrokeOrderStep): Client => ({
    order: next.order,
    canvas: applyToCanvas(client.canvas, next.update),
});

type ClientEvent =
    | { type: 'draw'; id: string; stroke: CanvasStrokeData }
    | { type: 'arrive'; id?: string; stroke: CanvasStrokeData }
    | { type: 'fail'; id: string };

const run = (events: readonly ClientEvent[]): Client =>
    events.reduce<Client>(
        (client, e) =>
            step(
                client,
                e.type === 'draw'
                    ? drawPending(client.order, { strokeId: e.id, stroke: e.stroke })
                    : e.type === 'arrive'
                      ? confirmStroke(client.order, e.stroke, e.id)
                      : dropPending(client.order, e.id),
            ),
        { order: EMPTY_STROKE_ORDER, canvas: [] },
    );

const a = stroke('a');
const b = stroke('b');
const eraseA = stroke('erase-a', 'erase');

describe('strokeOrder', () => {
    it('自分の線は保存を待たずに重ね、届いたら何もしない（描き直さない）', () => {
        const drawn = drawPending(EMPTY_STROKE_ORDER, { strokeId: 'a', stroke: a });
        expect(drawn.update).toEqual({ kind: 'append', stroke: a });
        expect(confirmStroke(drawn.order, a, 'a').update).toEqual({ kind: 'none' });
    });

    it('自分の線が無いときに届いた線は上に重ねるだけ', () => {
        expect(confirmStroke(EMPTY_STROKE_ORDER, a, undefined).update).toEqual({ kind: 'append', stroke: a });
        expect(confirmStroke(EMPTY_STROKE_ORDER, a, 'someone-else').update).toEqual({ kind: 'append', stroke: a });
    });

    it('同時に描いて他人の消しゴムが先に確定したら、自分の画面もサーバーの順に描き直す（後から入った人と同じ絵）', () => {
        // サーバーの順: A の消しゴム → B の線。B は自分の線を先に描いている
        const alice = run([
            { type: 'draw', id: 'ea', stroke: eraseA },
            { type: 'arrive', id: 'ea', stroke: eraseA },
            { type: 'arrive', id: 'b', stroke: b },
        ]);
        const bob = run([
            { type: 'draw', id: 'b', stroke: b },
            { type: 'arrive', id: 'ea', stroke: eraseA },
            { type: 'arrive', id: 'b', stroke: b },
        ]);
        const lateJoiner = run([
            { type: 'arrive', id: 'ea', stroke: eraseA },
            { type: 'arrive', id: 'b', stroke: b },
        ]);
        expect(lateJoiner.canvas).toEqual([eraseA, b]);
        expect(alice.canvas).toEqual(lateJoiner.canvas);
        expect(bob.canvas).toEqual(lateJoiner.canvas);
        expect(bob.order.pending).toEqual([]);
    });

    it('他人の線が割り込んだときは、まだ届いていない自分の線をその上に描き直す', () => {
        const bob = run([
            { type: 'draw', id: 'b', stroke: b },
            { type: 'arrive', id: 'a', stroke: a },
        ]);
        expect(bob.canvas).toEqual([a, b]);
    });

    it('自分の後の線が先に届いても（前の線がまだ）、画面は確定した順 + 残りの自分の線', () => {
        const me = run([
            { type: 'draw', id: '1', stroke: a },
            { type: 'draw', id: '2', stroke: b },
            { type: 'arrive', id: '2', stroke: b },
        ]);
        expect(me.canvas).toEqual([b, a]);
    });

    it('保存に失敗した線は自分の画面からも消す（誰の画面にも残らない線を自分だけが見ない）', () => {
        const me = run([
            { type: 'draw', id: '1', stroke: a },
            { type: 'draw', id: '2', stroke: eraseA },
            { type: 'fail', id: '1' },
            { type: 'arrive', id: '2', stroke: eraseA },
        ]);
        expect(me.canvas).toEqual([eraseA]);
        expect(me.canvas).toEqual(run([{ type: 'arrive', id: '2', stroke: eraseA }]).canvas);
    });

    it('知らない線の失敗・2 回目の失敗は何もしない', () => {
        const drawn = drawPending(EMPTY_STROKE_ORDER, { strokeId: '1', stroke: a });
        expect(dropPending(drawn.order, 'unknown')).toEqual({ order: drawn.order, update: { kind: 'none' } });
        const dropped = dropPending(drawn.order, '1');
        expect(dropPending(dropped.order, '1').update).toEqual({ kind: 'none' });
    });

    it('失敗とみなした線があとから届いても、確定した線として同じ順に入る', () => {
        const me = run([
            { type: 'draw', id: '1', stroke: a },
            { type: 'fail', id: '1' },
            { type: 'arrive', id: '1', stroke: a },
        ]);
        expect(me.canvas).toEqual([a]);
        expect(me.order).toEqual({ confirmed: [a], pending: [] });
    });

    it('他人が自分の strokeId を名乗っても、届いた順に確定して自分の線は外す（届いた data が正）', () => {
        const forged = stroke('forged');
        const me = run([
            { type: 'draw', id: 'mine', stroke: a },
            { type: 'arrive', id: 'mine', stroke: forged },
            { type: 'arrive', id: 'mine', stroke: a },
        ]);
        // 後から入った人と同じ（サーバーの順に 2 本）
        expect(me.canvas).toEqual([forged, a]);
    });

    it('どんな到着順でも、自分の線が全部確定すれば画面はサーバーの順と同じ', () => {
        const strokes = ['1', '2', '3', '4'].map((id) => ({
            id,
            stroke: stroke(`s${id}`, id === '3' ? 'erase' : undefined),
        }));
        // サーバーの順は 1,2,3,4。自分（mine）が描いたのは 2 と 4
        const mine = new Set(['2', '4']);
        const serverOrder = strokes.map((s) => s.stroke);
        const drawFirst = strokes.filter((s) => mine.has(s.id)).map((s): ClientEvent => ({ type: 'draw', ...s }));
        const arrivals = strokes.map((s): ClientEvent => ({ type: 'arrive', ...s }));
        // 描いた線を先に全部描く場合・確定と交互になる場合
        const interleaved: ClientEvent[] = [
            arrivals[0] as ClientEvent,
            drawFirst[0] as ClientEvent,
            arrivals[1] as ClientEvent,
            drawFirst[1] as ClientEvent,
            arrivals[2] as ClientEvent,
            arrivals[3] as ClientEvent,
        ];
        for (const events of [[...drawFirst, ...arrivals], interleaved]) {
            const client = run(events);
            expect(client.canvas).toEqual(serverOrder);
            expect(strokesInOrder(client.order)).toEqual(serverOrder);
        }
    });

    it('sameStroke は点・色・太さ・mode のどれかが違えば別の線（mode 省略は draw と同じ）', () => {
        expect(sameStroke(a, structuredClone(a))).toBe(true);
        expect(sameStroke(a, { ...a, mode: 'draw' })).toBe(true);
        expect(sameStroke(a, { ...a, mode: 'erase' })).toBe(false);
        expect(sameStroke(a, { ...a, color: '#fff' })).toBe(false);
        expect(sameStroke(a, { ...a, size: 5 })).toBe(false);
        expect(sameStroke(a, { ...a, points: [a.points[0] as [number, number, number], [9, 9, 1]] })).toBe(false);
        expect(sameStroke(a, { ...a, points: [...a.points, [9, 9, 1]] })).toBe(false);
    });

    it('状態を書き換えない（前の状態を持っている人に影響しない）', () => {
        const drawn = drawPending(EMPTY_STROKE_ORDER, { strokeId: '1', stroke: a });
        const snapshot = structuredClone(drawn.order);
        confirmStroke(drawn.order, b, undefined);
        confirmStroke(drawn.order, a, '1');
        dropPending(drawn.order, '1');
        expect(drawn.order).toEqual(snapshot);
        expect(EMPTY_STROKE_ORDER).toEqual({ confirmed: [], pending: [] });
    });
});
