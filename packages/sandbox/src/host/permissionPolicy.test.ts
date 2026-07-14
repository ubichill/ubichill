import { describe, expect, it } from 'vitest';
import {
    capabilityNeedsConsent,
    DEFAULT_PERMISSION_POLICY,
    isCapabilityGranted,
    type PermissionPolicy,
    resolveCapabilities,
    resolveFetchDecision,
} from './permissionPolicy';

/** テスト用にポリシーを部分上書きするヘルパー。 */
function policy(overrides: Partial<PermissionPolicy> = {}): PermissionPolicy {
    return { ...DEFAULT_PERMISSION_POLICY, ...overrides };
}

describe('resolveCapabilities（既定ポリシー）', () => {
    it('safe/sensitive は付与し、dangerous は承認待ちにする', () => {
        const r = resolveCapabilities(['scene:read', 'scene:update', 'net:fetch'], DEFAULT_PERMISSION_POLICY, 'mod-a');
        expect(r.granted).toEqual(['scene:read', 'scene:update']);
        expect(r.pending).toEqual(['net:fetch']);
        expect(r.denied).toEqual([]);
    });

    it('未知の capability は dangerous 扱いで承認待ちになる', () => {
        const r = resolveCapabilities(['mystery:power'], DEFAULT_PERMISSION_POLICY, 'mod-a');
        expect(r.pending).toEqual(['mystery:power']);
        expect(r.granted).toEqual([]);
    });

    it('宣言されていない capability は結果に現れない', () => {
        const r = resolveCapabilities([], DEFAULT_PERMISSION_POLICY, 'mod-a');
        expect(r.granted).toEqual([]);
        expect(r.pending).toEqual([]);
        expect(r.denied).toEqual([]);
    });
});

describe('resolveCapabilities（mod別の確定判断が優先）', () => {
    it('allow された dangerous は即付与される', () => {
        const p = policy({ grants: { 'mod-a': { 'net:fetch': 'allow' } } });
        const r = resolveCapabilities(['net:fetch'], p, 'mod-a');
        expect(r.granted).toEqual(['net:fetch']);
        expect(r.pending).toEqual([]);
    });

    it('deny された safe は拒否される（ティア既定より優先）', () => {
        const p = policy({ grants: { 'mod-a': { 'scene:read': 'deny' } } });
        const r = resolveCapabilities(['scene:read'], p, 'mod-a');
        expect(r.denied).toEqual(['scene:read']);
        expect(r.granted).toEqual([]);
    });

    it('別modの grant は影響しない', () => {
        const p = policy({ grants: { 'mod-b': { 'net:fetch': 'allow' } } });
        const r = resolveCapabilities(['net:fetch'], p, 'mod-a');
        expect(r.pending).toEqual(['net:fetch']);
    });
});

describe('resolveCapabilities（ティア既定の変更）', () => {
    it('sensitive を ask にするとユーザー承認待ちになる', () => {
        const p = policy({ tierDefaults: { safe: 'allow', sensitive: 'ask', dangerous: 'ask' } });
        const r = resolveCapabilities(['scene:update'], p, 'mod-a');
        expect(r.pending).toEqual(['scene:update']);
    });

    it('safe を deny にすると全 safe が拒否される', () => {
        const p = policy({ tierDefaults: { safe: 'deny', sensitive: 'allow', dangerous: 'ask' } });
        const r = resolveCapabilities(['scene:read'], p, 'mod-a');
        expect(r.denied).toEqual(['scene:read']);
    });
});

describe('isCapabilityGranted（実行時ゲート・純粋）', () => {
    it('net:fetch は常に許可（capability レベル）', () => {
        expect(isCapabilityGranted(DEFAULT_PERMISSION_POLICY, 'p', 'net:fetch')).toBe(true);
    });
    it('safe/sensitive は既定許可、ask 未決の危険は false', () => {
        expect(isCapabilityGranted(DEFAULT_PERMISSION_POLICY, 'p', 'scene:read')).toBe(true);
        expect(isCapabilityGranted(DEFAULT_PERMISSION_POLICY, 'p', 'scene:update')).toBe(true);
        expect(isCapabilityGranted(DEFAULT_PERMISSION_POLICY, 'p', 'mystery:power')).toBe(false);
    });
    it('grant が最優先（deny なら safe でも false / allow なら未決でも true）', () => {
        expect(isCapabilityGranted(policy({ grants: { p: { 'scene:read': 'deny' } } }), 'p', 'scene:read')).toBe(false);
        expect(isCapabilityGranted(policy({ grants: { p: { 'mystery:power': 'allow' } } }), 'p', 'mystery:power')).toBe(
            true,
        );
    });
});

describe('capabilityNeedsConsent（読み込み時に確認が要るか・純粋）', () => {
    it('ask 未決のみ true。net:fetch と既決は false', () => {
        expect(capabilityNeedsConsent(DEFAULT_PERMISSION_POLICY, 'p', 'mystery:power')).toBe(true);
        expect(capabilityNeedsConsent(DEFAULT_PERMISSION_POLICY, 'p', 'scene:read')).toBe(false); // safe
        expect(capabilityNeedsConsent(DEFAULT_PERMISSION_POLICY, 'p', 'net:fetch')).toBe(false); // ドメイン単位
        expect(
            capabilityNeedsConsent(policy({ grants: { p: { 'mystery:power': 'deny' } } }), 'p', 'mystery:power'),
        ).toBe(false); // 既決
    });
});

describe('resolveFetchDecision（fetch ドメイン判定・純粋）', () => {
    it('既定（確認）は ask、記憶があればそれが優先', () => {
        expect(resolveFetchDecision(DEFAULT_PERMISSION_POLICY, 'p', 'api.example.com')).toBe('ask');
        expect(
            resolveFetchDecision(
                policy({ fetchGrants: { p: { 'api.example.com': 'allow' } } }),
                'p',
                'api.example.com',
            ),
        ).toBe('allow');
        expect(
            resolveFetchDecision(policy({ fetchGrants: { p: { 'api.example.com': 'deny' } } }), 'p', 'api.example.com'),
        ).toBe('deny');
    });
    it('シールド「なし」は allow、「拒否」は deny', () => {
        expect(
            resolveFetchDecision(
                policy({ tierDefaults: { safe: 'allow', sensitive: 'allow', dangerous: 'allow' } }),
                'p',
                'x.com',
            ),
        ).toBe('allow');
        expect(
            resolveFetchDecision(
                policy({ tierDefaults: { safe: 'allow', sensitive: 'deny', dangerous: 'deny' } }),
                'p',
                'x.com',
            ),
        ).toBe('deny');
    });
});
