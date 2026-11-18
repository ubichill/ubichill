// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputCollector } from './InputCollector';
import {
    acquireSharedInput,
    collectSharedInputFor,
    releaseSharedInput,
    setSharedScrollElement,
} from './SharedInputPool';

/** jsdom はレイアウトを持たないので scrollLeft/Top を差し替えたスクロール要素を作る。 */
function makeScrollEl(scrollLeft: number, scrollTop: number): Element {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
    document.body.appendChild(el);
    return el;
}

function pointerDown(clientX: number, clientY: number): void {
    const e = new MouseEvent('pointerdown', { bubbles: true, clientX, clientY });
    Object.defineProperty(e, 'pointerType', { value: 'touch' });
    document.body.dispatchEvent(e);
}

/** instanceKey が受け取った MOUSE_DOWN のワールド座標。 */
function worldPointOf(instanceKey: string): { x: number; y: number } | null {
    const down = collectSharedInputFor(instanceKey).find((ev) => ev.type === 'MOUSE_DOWN');
    if (!down) return null;
    const d = down.data as { x: number; y: number };
    return { x: d.x, y: d.y };
}

const acquired: string[] = [];

beforeEach(() => {
    document.body.innerHTML = '';
    document.elementFromPoint = () => null;
});

afterEach(() => {
    for (const key of acquired.splice(0)) releaseSharedInput(key);
    document.body.innerHTML = '';
});

function acquire(key: string): string {
    acquireSharedInput(key);
    acquired.push(key);
    return key;
}

describe('SharedInputPool: スクロール要素の共有', () => {
    it('登録した Worker 以外にもスクロール量が適用される（DOM リスナーは 1 セット）', () => {
        acquire('a');
        acquire('b');
        setSharedScrollElement('a', makeScrollEl(300, 120));

        pointerDown(40, 50);
        expect(worldPointOf('a')).toEqual({ x: 340, y: 170 });
        expect(worldPointOf('b')).toEqual({ x: 340, y: 170 });
    });

    it('1 つが null でも他の非 null があればそれを使う', () => {
        acquire('a');
        acquire('b');
        setSharedScrollElement('a', null);
        setSharedScrollElement('b', makeScrollEl(300, 120));

        pointerDown(40, 50);
        expect(worldPointOf('a')).toEqual({ x: 340, y: 170 });
    });

    // WorkerModHost はこの挙動を前提に、workerRevision が変わるたび再登録する。
    // 再登録を怠ると「スクロール量 0」に戻り、描いた線が指の位置からスクロール量だけずれる。
    it('Worker が作り直される（release → 新 key で acquire）と登録が失われる', () => {
        acquire('old');
        setSharedScrollElement('old', makeScrollEl(300, 120));

        pointerDown(40, 50);
        expect(worldPointOf('old')).toEqual({ x: 340, y: 170 });

        // 実際の再生成と同じ順序: 新しい manager が acquire し、古い manager が destroy される
        acquire('new');
        releaseSharedInput('old');
        acquired.splice(acquired.indexOf('old'), 1);

        pointerDown(40, 50);
        // 再登録しない限りスクロール量が 0 扱いに戻る（= 座標ずれ）
        expect(worldPointOf('new')).toEqual({ x: 40, y: 50 });

        // 再登録すれば復帰する（WorkerModHost が workerRevision の変化で行う）
        setSharedScrollElement('new', makeScrollEl(300, 120));
        pointerDown(40, 50);
        expect(worldPointOf('new')).toEqual({ x: 340, y: 170 });
    });

    it('後から acquire した Worker には、acquire より前の入力を渡さない', () => {
        acquire('early');
        Array.from({ length: 3000 }, (_, i) => pointerDown(i, i));
        acquire('late');
        pointerDown(1, 2);
        expect(collectSharedInputFor('late').filter((ev) => ev.type === 'MOUSE_DOWN')).toHaveLength(1);
        expect(collectSharedInputFor('early').filter((ev) => ev.type === 'MOUSE_DOWN')).toHaveLength(3001);
    });

    it('一度も収集しない Worker を release すれば、ほかの Worker の読んだ分は捨てられる', () => {
        const prune = vi.spyOn(InputCollector.prototype, 'pruneEventsBefore');
        acquire('reader');
        acquireSharedInput('never-ready');
        releaseSharedInput('never-ready');
        Array.from({ length: 10 }, (_, i) => pointerDown(i, i));
        collectSharedInputFor('reader');
        expect(prune).toHaveBeenLastCalledWith(10);
        prune.mockRestore();
    });

    it('同じ key を 2 回 release しても、ほかの Worker の collector を壊さない', () => {
        acquire('alive');
        acquireSharedInput('failed');
        releaseSharedInput('failed'); // 初期化の失敗で release
        releaseSharedInput('failed'); // destroy でもう一度 release
        pointerDown(40, 50);
        expect(worldPointOf('alive')).toEqual({ x: 40, y: 50 });
    });

    it('release 済みの key のスクロール要素は使わない', () => {
        acquire('alive');
        acquireSharedInput('gone');
        releaseSharedInput('gone');
        setSharedScrollElement('gone', makeScrollEl(300, 120));
        pointerDown(40, 50);
        expect(worldPointOf('alive')).toEqual({ x: 40, y: 50 });
    });

    it('全 Worker が release されると collector は破棄され、以降の収集は空になる', () => {
        acquire('a');
        pointerDown(40, 50);
        expect(worldPointOf('a')).not.toBeNull();

        releaseSharedInput('a');
        acquired.splice(acquired.indexOf('a'), 1);
        pointerDown(40, 50);
        expect(collectSharedInputFor('a')).toEqual([]);
    });
});
