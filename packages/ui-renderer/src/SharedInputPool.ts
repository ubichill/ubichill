/**
 * SharedInputPool — 全 Worker で 1 つの InputCollector を共有する仕組み (infra 層)。
 *
 * DOM のマウス/キーボード入力は 1 度だけ収集し、各 Worker は自分の「読み取りカーソル」
 * から未読分だけを受け取る。これにより N 個の Worker が居ても DOM リスナーは 1 セットで済む。
 *
 * - acquire/release : 読み手（カーソル）が 1 つ以上ある間だけ InputCollector を持つ。
 *                     acquire より前の入力は渡さない。同じ key の release は 2 回目以降は何もしない
 * - collectFor      : instanceKey のカーソル以降の入力を返し、全 Worker が読んだ分を prune
 * - setScrollElement: ワールドスクロール供給要素を登録 (どれか 1 つが有効ならそれを使う)
 */
import type { InputFrameEvent } from '@ubichill/shared';
import { InputCollector } from './InputCollector';

let _collector: InputCollector | null = null;
const _cursor = new Map<string, number>();
const _scrollElementByInstance = new Map<string, Element | null>();

export function acquireSharedInput(instanceKey: string): void {
    if (!_collector) {
        _collector = new InputCollector();
    }
    // 0 から読ませると、読み始めない Worker が全体の prune を止め、過去の入力を後から再生してしまう
    _cursor.set(instanceKey, _collector.lastSeq);
    _scrollElementByInstance.set(instanceKey, null);
}

export function releaseSharedInput(instanceKey: string): void {
    if (!_cursor.delete(instanceKey)) return;
    _scrollElementByInstance.delete(instanceKey);
    _applyScrollElement();

    if (_cursor.size === 0) {
        _collector?.destroy();
        _collector = null;
        _scrollElementByInstance.clear();
    }
}

export function setSharedScrollElement(instanceKey: string, el: Element | null): void {
    if (!_collector || !_cursor.has(instanceKey)) return;
    _scrollElementByInstance.set(instanceKey, el);
    _applyScrollElement();
}

export function collectSharedInputFor(instanceKey: string): InputFrameEvent[] {
    const collector = _collector;
    if (!collector) return [];

    const lastSeq = _cursor.get(instanceKey) ?? 0;
    const { events, lastSeq: nextSeq } = collector.collectSince(lastSeq);
    _cursor.set(instanceKey, nextSeq);

    // 全 Worker が読み終わった seq までは破棄してメモリを解放する
    let minSeq = Number.POSITIVE_INFINITY;
    for (const seq of _cursor.values()) {
        if (seq < minSeq) minSeq = seq;
    }
    if (Number.isFinite(minSeq)) {
        collector.pruneEventsBefore(minSeq);
    }

    return events;
}

/** 登録された scroll element のうち最初の非 null を採用して collector に渡す。 */
function _applyScrollElement(): void {
    if (!_collector) return;
    let scrollElement: Element | null = null;
    for (const candidate of _scrollElementByInstance.values()) {
        if (candidate) {
            scrollElement = candidate;
            break;
        }
    }
    _collector.setScrollElement(scrollElement);
}
