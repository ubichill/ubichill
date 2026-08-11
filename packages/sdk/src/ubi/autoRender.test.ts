/**
 * `Ubi.ui.render` の自動再描画（依存追跡）の統合テスト。
 * `Ubi.state` と `Ubi.ui` は別モジュールだが、`reactiveTracking` を介して結合する
 * ため、実際の `UbiSDK` と同じ形で両方を組んでテストする。
 */
import type { ComponentInstance } from '@ubichill/shared/mod/entities';
import { describe, expect, it, vi } from 'vitest';
import { createEventModule } from './event';
import { createGripModule } from './grip';
import { createStateModule, type StateModuleDeps } from './state';
import { createUiModule } from './ui';

function makeHarness() {
    const sent: unknown[] = [];
    const initialEntities: ComponentInstance[] = [
        { id: 'ent-1', type: 'thing', entityId: 'go-1', data: {} } as ComponentInstance,
    ];
    const isTicking = false;

    const ui = createUiModule(
        (cmd) => sent.push(cmd),
        () => isTicking,
        () => {},
        () => {},
    );

    const deps: StateModuleDeps = {
        send: (cmd) => sent.push(cmd),
        updateEntity: async () => {},
        getMyUserId: () => 'me',
        getEntityId: () => undefined,
        getModId: () => 'mod',
        getComponentType: () => undefined,
        getWatchEntityTypes: () => ['thing'],
        getPresenceUsers: () => new Map(),
        getLocalSharedState: () => ({}),
        getScrollX: () => 0,
        getScrollY: () => 0,
        getForEachUserComponents: () => new Set(),
        registerPendingFlush: () => {},
        getInitialEntities: () => initialEntities,
        beginRender: () => {},
        queueUiRender: ui._queueUiRender,
        unmountUi: ui._unmountUi,
        recordUiRenderCost: ui._recordUiRenderCost,
        buildEntityTargetId: ui._buildEntityTargetId,
    };
    const state = createStateModule(deps);

    return { ui, state, sent };
}

/**
 * grip.isMine 等が state 経由で自動追跡されることを確認するためのハーネス。
 * getInitialEntities を空にする: makeHarness の fixture entity (type: 'thing') は
 * grip 内部の state.define({ holder }) の watchType マッチ対象とは無関係だが、
 * 同じ type 名でマッチしてしまうと holder の初期値（null）が意図せず上書きされてしまうため。
 */
function makeGripHarness() {
    const sent: unknown[] = [];
    const isTicking = false;
    const ui = createUiModule(
        (cmd) => sent.push(cmd),
        () => isTicking,
        () => {},
        () => {},
    );
    const deps: StateModuleDeps = {
        send: (cmd) => sent.push(cmd),
        updateEntity: async () => {},
        getMyUserId: () => 'me',
        getEntityId: () => undefined,
        getModId: () => 'mod',
        getComponentType: () => undefined,
        getWatchEntityTypes: () => [],
        getPresenceUsers: () => new Map(),
        getLocalSharedState: () => ({}),
        getScrollX: () => 0,
        getScrollY: () => 0,
        getForEachUserComponents: () => new Set(),
        registerPendingFlush: () => {},
        getInitialEntities: () => [],
        beginRender: () => {},
        queueUiRender: ui._queueUiRender,
        unmountUi: ui._unmountUi,
        recordUiRenderCost: ui._recordUiRenderCost,
        buildEntityTargetId: ui._buildEntityTargetId,
    };
    const state = createStateModule(deps);
    const event = createEventModule({ send: () => {}, registerSystem: () => {} });
    const grip = createGripModule({
        state,
        event,
        getMyUserId: () => 'me',
        getComponentInstanceId: () => 'self-1',
        getComponentType: () => 'thing',
        getEntityId: () => 'go-1',
        listenMouseUp: () => () => {},
        sendGripCommand: () => {},
        bringToFront: async () => {},
    });
    return { ui, state, grip, sent };
}

/** UI_RENDER で送られた vnode のうち、直近1件を返す。 */
function lastRenderedVNode(sent: unknown[], targetId: string): unknown {
    const matches = sent.filter(
        (c): c is { type: string; payload: { targetId: string; vnode: unknown } } =>
            typeof c === 'object' && c !== null && (c as { type?: string }).type === 'UI_RENDER',
    );
    return matches.filter((c) => c.payload.targetId === targetId).at(-1)?.payload.vnode;
}

describe('Ubi.ui.render の自動再描画', () => {
    it('読んだ state キーが変わると、明示的に呼び直さなくても再描画される', async () => {
        const { ui, state, sent } = makeHarness();
        const s = state.define({ color: state.sync('#fff') });

        ui.render(() => ({ type: 'div', props: { color: s.local.color }, children: [] }) as never, 'target');
        await Promise.resolve(); // queueMicrotask の flush 待ち
        expect(lastRenderedVNode(sent, 'target')).toEqual({ type: 'div', props: { color: '#fff' }, children: [] });

        sent.length = 0;
        s.local.color = '#000';
        await Promise.resolve();

        expect(lastRenderedVNode(sent, 'target')).toEqual({ type: 'div', props: { color: '#000' }, children: [] });
    });

    it('factory が読まなかったキーの変化では再描画されない', async () => {
        const { ui, state, sent } = makeHarness();
        const s = state.define({ color: state.sync('#fff'), unrelated: state.sync(0) });

        ui.render(() => ({ type: 'div', props: { color: s.local.color }, children: [] }) as never, 'target');
        await Promise.resolve();
        sent.length = 0;

        s.local.unrelated = 42;
        await Promise.resolve();

        expect(sent.filter((c) => (c as { type?: string }).type === 'UI_RENDER')).toHaveLength(0);
    });

    it('条件分岐で読むキーが変わる場合、動的に依存を追跡し直す', async () => {
        const { ui, state, sent } = makeHarness();
        const s = state.define({ mode: state.sync('a'), a: state.sync(1), b: state.sync(2) });

        const factory = () =>
            ({ type: 'div', props: { value: s.local.mode === 'a' ? s.local.a : s.local.b }, children: [] }) as never;
        ui.render(factory, 'target');
        await Promise.resolve();
        expect(lastRenderedVNode(sent, 'target')).toEqual({ type: 'div', props: { value: 1 }, children: [] });

        // 現在は mode==='a' なので b の変化は無視されるはず
        sent.length = 0;
        s.local.b = 999;
        await Promise.resolve();
        expect(sent.filter((c) => (c as { type?: string }).type === 'UI_RENDER')).toHaveLength(0);

        // mode を切り替えると b が依存になり、以後 b の変化で再描画される
        sent.length = 0;
        s.local.mode = 'b';
        await Promise.resolve();
        expect(lastRenderedVNode(sent, 'target')).toEqual({ type: 'div', props: { value: 999 }, children: [] });

        sent.length = 0;
        s.local.a = 12345;
        await Promise.resolve();
        expect(sent.filter((c) => (c as { type?: string }).type === 'UI_RENDER')).toHaveLength(0);
    });

    it('unmount すると自動再描画の購読も解除される', async () => {
        const { ui, state, sent } = makeHarness();
        const s = state.define({ color: state.sync('#fff') });

        ui.render(() => ({ type: 'div', props: { color: s.local.color }, children: [] }) as never, 'target');
        await Promise.resolve();

        ui.unmount('target');
        await Promise.resolve(); // unmount 自体が積む null-vnode の UI_RENDER を先に flush させる
        sent.length = 0;

        s.local.color = '#000';
        await Promise.resolve();

        expect(sent.filter((c) => (c as { type?: string }).type === 'UI_RENDER')).toHaveLength(0);
    });

    it('明示的な onChange 併用は害にならない（重複呼び出しでも最終送信は最新値の1件）', async () => {
        const { ui, state, sent } = makeHarness();
        const s = state.define({ color: state.sync('#fff') });
        const render = () =>
            ui.render(() => ({ type: 'div', props: { color: s.local.color }, children: [] }) as never, 'target');
        s.onChange('color', render); // 旧パターン: 手動で結線したままでも動く
        render();
        await Promise.resolve();
        sent.length = 0;

        s.local.color = '#abc';
        await Promise.resolve();

        const renders = sent.filter((c) => (c as { type?: string }).type === 'UI_RENDER');
        // 手動 onChange + 自動追跡が両方トリガーされても、同一 targetId は Map 上書きで
        // postMessage は最終的に1回にまとまる。
        expect(renders).toHaveLength(1);
        expect(lastRenderedVNode(sent, 'target')).toEqual({ type: 'div', props: { color: '#abc' }, children: [] });
    });

    it('factory の呼び出し回数でも確認する（無関係なキー変化では再実行されない）', async () => {
        const { ui, state } = makeHarness();
        const s = state.define({ color: state.sync('#fff'), unrelated: state.sync(0) });
        const factory = vi.fn(() => ({ type: 'div', props: { color: s.local.color }, children: [] }) as never);

        ui.render(factory, 'target');
        await Promise.resolve();
        expect(factory).toHaveBeenCalledTimes(1);

        s.local.unrelated = 1;
        await Promise.resolve();
        expect(factory).toHaveBeenCalledTimes(1); // 未読のキーなので再実行されない

        s.local.color = '#000';
        await Promise.resolve();
        expect(factory).toHaveBeenCalledTimes(2); // 読んだキーなので再実行される
    });

    it('grip.isMine は内部で Ubi.state を読むため、明示的な grip.onChange なしでも自動再描画される', async () => {
        const { ui, grip, sent } = makeGripHarness();
        const g = grip.exclusive({ mode: 'manual', bringToFront: false });
        const factory = vi.fn(() => ({ type: 'div', props: { held: g.isMine }, children: [] }) as never);

        // grip.onChange は一切呼ばない。factory 内で g.isMine を読むだけで依存追跡される。
        ui.render(factory, 'target');
        await Promise.resolve();
        expect(lastRenderedVNode(sent, 'target')).toEqual({ type: 'div', props: { held: false }, children: [] });

        sent.length = 0;
        g.acquire();
        await Promise.resolve();
        expect(lastRenderedVNode(sent, 'target')).toEqual({ type: 'div', props: { held: true }, children: [] });

        sent.length = 0;
        g.release();
        await Promise.resolve();
        expect(lastRenderedVNode(sent, 'target')).toEqual({ type: 'div', props: { held: false }, children: [] });
    });
});
