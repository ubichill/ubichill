import { CommandType, type ComponentInstance } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import type { OmitId } from '../types';
import { createStateModule, type StateModuleDeps } from './index';

type SentCommand = OmitId<Parameters<StateModuleDeps['send']>[0]>;

interface Harness {
    sent: SentCommand[];
    updateCalls: Array<{ id: string; patch: Record<string, unknown> }>;
    localSharedState: Record<string, unknown>;
    presence: Map<string, { id: string; worldX: number; worldY: number; sharedState: Record<string, unknown> }>;
    /** registerPendingFlush で予約された flush をまとめて実行する（tick 末尾を模倣）。 */
    flush(): void;
}

/**
 * StateModuleDeps を組む。既定は「watchType='thing' の ComponentInstance ent-1 に同期」。
 * componentType は既定 undefined（define 時の EDITOR_SCHEMA 送信ノイズを避ける）。
 */
function makeDeps(overrides: Partial<StateModuleDeps> = {}): { deps: StateModuleDeps; h: Harness } {
    const sent: SentCommand[] = [];
    const updateCalls: Harness['updateCalls'] = [];
    const localSharedState: Record<string, unknown> = {};
    const presence: Harness['presence'] = new Map([['me', { id: 'me', worldX: 100, worldY: 50, sharedState: {} }]]);
    const flushes = new Set<() => void>();
    const initialEntities: ComponentInstance[] = [
        { id: 'ent-1', type: 'thing', entityId: 'go-1', data: {} } as ComponentInstance,
    ];

    const deps: StateModuleDeps = {
        send: (cmd) => {
            sent.push(cmd);
        },
        updateEntity: async (id, patch) => {
            updateCalls.push({ id, patch: patch as Record<string, unknown> });
        },
        getMyUserId: () => 'me',
        getEntityId: () => undefined,
        getModId: () => 'mod',
        getComponentType: () => undefined,
        getWatchEntityTypes: () => ['thing'],
        getPresenceUsers: () => presence,
        getLocalSharedState: () => localSharedState,
        getScrollX: () => 10,
        getScrollY: () => 20,
        getForEachUserComponents: () => new Set(),
        registerPendingFlush: (fn) => flushes.add(fn),
        getInitialEntities: () => initialEntities,
        beginRender: () => {},
        queueUiRender: () => {},
        unmountUi: () => {},
        recordUiRenderCost: () => {},
        buildEntityTargetId: (entityId, componentName) => `${entityId}#${componentName}`,
        ...overrides,
    };

    const flush = (): void => {
        const fns = [...flushes];
        flushes.clear();
        for (const fn of fns) fn();
    };

    return { deps, h: { sent, updateCalls, localSharedState, presence, flush } };
}

describe('createStateModule / sync + define', () => {
    it('マーカー無しのローカル値は書き込んでも何も送らない', () => {
        const { deps, h } = makeDeps();
        const mod = createStateModule(deps);
        const state = mod.define({ count: 0 });
        state.local.count = 5;
        h.flush();
        expect(state.local.count).toBe(5);
        expect(h.sent).toHaveLength(0);
        expect(h.updateCalls).toHaveLength(0);
    });

    it('persistent (既定) の書き込みは flush で updateEntity(data) になる', () => {
        const { deps, h } = makeDeps();
        const mod = createStateModule(deps);
        const state = mod.define({ score: mod.sync(0) });
        state.local.score = 42;
        expect(h.updateCalls).toHaveLength(0); // flush 前は未送信
        h.flush();
        expect(h.updateCalls).toEqual([{ id: 'ent-1', patch: { data: { score: 42 } } }]);
    });

    it('ephemeral (shared) の書き込みは NETWORK_BROADCAST + localSharedState 反映', () => {
        const { deps, h } = makeDeps();
        const mod = createStateModule(deps);
        const state = mod.define({ cursor: mod.sync('default', { ephemeral: true }) });
        state.local.cursor = 'grab';
        h.flush();
        expect(h.localSharedState.cursor).toBe('grab');
        expect(h.presence.get('me')?.sharedState.cursor).toBe('grab');
        expect(h.sent).toEqual([
            {
                type: CommandType.NETWORK_BROADCAST,
                payload: { type: 'presence:sharedState', data: { sharedState: { cursor: 'grab' } } },
            },
        ]);
    });

    it('perUser (persistMine) は data キーを field:myUserId にする', () => {
        const { deps, h } = makeDeps();
        const mod = createStateModule(deps);
        const state = mod.define({ volume: mod.sync(0.5, { perUser: true }) });
        state.local.volume = 0.8;
        h.flush();
        expect(h.updateCalls).toEqual([{ id: 'ent-1', patch: { data: { 'volume:me': 0.8 } } }]);
    });

    it('topLevel は data ではなく top-level フィールドへ patch する', () => {
        const { deps, h } = makeDeps();
        const mod = createStateModule(deps);
        const state = mod.define({ lockedBy: mod.sync<string | null>(null, { topLevel: 'lockedBy' }) });
        state.local.lockedBy = 'me';
        h.flush();
        expect(h.updateCalls).toEqual([{ id: 'ent-1', patch: { lockedBy: 'me' } }]);
    });

    it('複数スコープを 1 回の flush でまとめる (data と top-level が 1 patch に)', () => {
        const { deps, h } = makeDeps();
        const mod = createStateModule(deps);
        const state = mod.define({
            score: mod.sync(0),
            lockedBy: mod.sync<string | null>(null, { topLevel: 'lockedBy' }),
        });
        state.local.score = 1;
        state.local.lockedBy = 'me';
        h.flush();
        expect(h.updateCalls).toEqual([{ id: 'ent-1', patch: { lockedBy: 'me', data: { score: 1 } } }]);
    });
});

describe('createStateModule / onChange + batch', () => {
    it('onChange は値変化で (next, prev) を受け取り、同値では発火しない', () => {
        const { deps } = makeDeps();
        const mod = createStateModule(deps);
        const state = mod.define({ n: mod.sync(0) });
        const listener = vi.fn();
        state.onChange('n', listener);
        state.local.n = 1;
        state.local.n = 1; // 同値 → 発火しない
        state.local.n = 2;
        expect(listener.mock.calls).toEqual([
            [1, 0],
            [2, 1],
        ]);
    });

    it('batch は同一キーの複数書き込みを (最初のprev, 最後のnext) 1 回に畳む', () => {
        const { deps } = makeDeps();
        const mod = createStateModule(deps);
        const state = mod.define({ n: mod.sync(0) });
        const listener = vi.fn();
        state.onChange('n', listener);
        state.batch(() => {
            state.local.n = 1;
            state.local.n = 2;
            state.local.n = 3;
        });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(3, 0);
    });

    it('batch 内で最終的に元の値へ戻ると発火しない', () => {
        const { deps } = makeDeps();
        const mod = createStateModule(deps);
        const state = mod.define({ n: mod.sync(0) });
        const listener = vi.fn();
        state.onChange('n', listener);
        state.batch(() => {
            state.local.n = 5;
            state.local.n = 0;
        });
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('createStateModule / applyEntityData + for', () => {
    it('applyEntityData は persistent の local を更新し onChange を発火する', () => {
        const { deps } = makeDeps();
        const mod = createStateModule(deps);
        const state = mod.define({ score: mod.sync(0) });
        const listener = vi.fn();
        state.onChange('score', listener);
        mod._getStateBindings()[0].applyEntityData({ score: 7 });
        expect(state.local.score).toBe(7);
        expect(listener).toHaveBeenCalledWith(7, 0);
    });

    it('for(userId) は shared を presence から、viewport をスクロール補正して返す', () => {
        const { deps, h } = makeDeps();
        h.presence.set('u2', { id: 'u2', worldX: 200, worldY: 80, sharedState: { cursor: 'grab' } });
        const mod = createStateModule(deps);
        const state = mod.define({ cursor: mod.sync('default', { ephemeral: true }) });
        const view = state.for('u2');
        expect(view.cursor).toBe('grab');
        expect(view.worldX).toBe(200);
        expect(view.viewportX).toBe(190); // worldX - scrollX(10)
        expect(view.viewportY).toBe(60); // worldY - scrollY(20)
    });

    it('persistMine: 他ユーザー分は for(userId) から読める', () => {
        const { deps } = makeDeps();
        const mod = createStateModule(deps);
        const state = mod.define({ volume: mod.sync(0.5, { perUser: true }) });
        mod._getStateBindings()[0].applyEntityData({ 'volume:u2': 0.9 });
        // 他人分は local を汚さない
        expect(state.local.volume).toBe(0.5);
        expect(state.for('u2').volume).toBe(0.9);
    });
});

describe('createStateModule / editor schema', () => {
    it('componentType があると同期フィールドの EDITOR_SCHEMA を型推論付きで報告する', () => {
        const { deps, h } = makeDeps({ getComponentType: () => 'mod:comp' });
        const mod = createStateModule(deps);
        mod.define({
            localOnly: 123, // 非同期は出さない
            title: mod.sync('hello'),
            bg: mod.sync('#1a1a1a'),
            count: mod.sync(3),
            enabled: mod.sync(true),
            hidden: mod.sync('x', { editable: false }), // 除外
        });
        const schemaMsg = h.sent.find((c) => c.type === 'EDITOR_SCHEMA');
        expect(schemaMsg).toBeDefined();
        const schema = (schemaMsg?.payload as { schema: Record<string, { type: string; default: unknown }> }).schema;
        expect(Object.keys(schema).sort()).toEqual(['bg', 'count', 'enabled', 'title']);
        expect(schema.title.type).toBe('string');
        expect(schema.bg.type).toBe('color'); // hex は color 推論
        expect(schema.count.type).toBe('number');
        expect(schema.enabled.type).toBe('boolean');
    });
});
