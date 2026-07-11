import { describe, expect, it } from 'vitest';
import { DEFAULT_PERMISSION_POLICY, type PermissionPolicy, resolveCapabilities } from './permissionPolicy';

/** テスト用にポリシーを部分上書きするヘルパー。 */
function policy(overrides: Partial<PermissionPolicy> = {}): PermissionPolicy {
    return { ...DEFAULT_PERMISSION_POLICY, ...overrides };
}

describe('resolveCapabilities（既定ポリシー）', () => {
    it('safe/sensitive は付与し、dangerous は承認待ちにする', () => {
        const r = resolveCapabilities(
            ['scene:read', 'scene:update', 'net:fetch'],
            DEFAULT_PERMISSION_POLICY,
            'plugin-a',
        );
        expect(r.granted).toEqual(['scene:read', 'scene:update']);
        expect(r.pending).toEqual(['net:fetch']);
        expect(r.denied).toEqual([]);
    });

    it('未知の capability は dangerous 扱いで承認待ちになる', () => {
        const r = resolveCapabilities(['mystery:power'], DEFAULT_PERMISSION_POLICY, 'plugin-a');
        expect(r.pending).toEqual(['mystery:power']);
        expect(r.granted).toEqual([]);
    });

    it('宣言されていない capability は結果に現れない', () => {
        const r = resolveCapabilities([], DEFAULT_PERMISSION_POLICY, 'plugin-a');
        expect(r.granted).toEqual([]);
        expect(r.pending).toEqual([]);
        expect(r.denied).toEqual([]);
    });
});

describe('resolveCapabilities（プラグイン別の確定判断が優先）', () => {
    it('allow された dangerous は即付与される', () => {
        const p = policy({ grants: { 'plugin-a': { 'net:fetch': 'allow' } } });
        const r = resolveCapabilities(['net:fetch'], p, 'plugin-a');
        expect(r.granted).toEqual(['net:fetch']);
        expect(r.pending).toEqual([]);
    });

    it('deny された safe は拒否される（ティア既定より優先）', () => {
        const p = policy({ grants: { 'plugin-a': { 'scene:read': 'deny' } } });
        const r = resolveCapabilities(['scene:read'], p, 'plugin-a');
        expect(r.denied).toEqual(['scene:read']);
        expect(r.granted).toEqual([]);
    });

    it('別プラグインの grant は影響しない', () => {
        const p = policy({ grants: { 'plugin-b': { 'net:fetch': 'allow' } } });
        const r = resolveCapabilities(['net:fetch'], p, 'plugin-a');
        expect(r.pending).toEqual(['net:fetch']);
    });
});

describe('resolveCapabilities（ティア既定の変更）', () => {
    it('sensitive を ask にするとユーザー承認待ちになる', () => {
        const p = policy({ tierDefaults: { safe: 'allow', sensitive: 'ask', dangerous: 'ask' } });
        const r = resolveCapabilities(['scene:update'], p, 'plugin-a');
        expect(r.pending).toEqual(['scene:update']);
    });

    it('safe を deny にすると全 safe が拒否される', () => {
        const p = policy({ tierDefaults: { safe: 'deny', sensitive: 'allow', dangerous: 'ask' } });
        const r = resolveCapabilities(['scene:read'], p, 'plugin-a');
        expect(r.denied).toEqual(['scene:read']);
    });
});
