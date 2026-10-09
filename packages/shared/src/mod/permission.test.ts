import { describe, expect, it } from 'vitest';
import {
    capabilityNeedsConsent,
    DEFAULT_PERMISSION_POLICY,
    isCapabilityGranted,
    type PermissionPolicy,
    parsePermissionSubject,
    permissionSubject,
    resolveCapabilities,
    resolveExternalDomainDecision,
} from './permission';

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

describe('resolveExternalDomainDecision（外部通信ドメイン判定・純粋）', () => {
    it('既定（確認）は ask、記憶があればそれが優先', () => {
        expect(resolveExternalDomainDecision(DEFAULT_PERMISSION_POLICY, 'p', 'api.example.com')).toBe('ask');
        expect(
            resolveExternalDomainDecision(
                policy({ fetchGrants: { p: { 'api.example.com': 'allow' } } }),
                'p',
                'api.example.com',
            ),
        ).toBe('allow');
        expect(
            resolveExternalDomainDecision(
                policy({ fetchGrants: { p: { 'api.example.com': 'deny' } } }),
                'p',
                'api.example.com',
            ),
        ).toBe('deny');
    });
    it('シールド「なし」は allow、「拒否」は deny', () => {
        expect(
            resolveExternalDomainDecision(
                policy({ tierDefaults: { safe: 'allow', sensitive: 'allow', dangerous: 'allow' } }),
                'p',
                'x.com',
            ),
        ).toBe('allow');
        expect(
            resolveExternalDomainDecision(
                policy({ tierDefaults: { safe: 'allow', sensitive: 'deny', dangerous: 'deny' } }),
                'p',
                'x.com',
            ),
        ).toBe('deny');
    });
});

describe('許可の対象（作者＋mod の ID）', () => {
    const ALICE = 'alice@example.com';
    const granted = (subject: string) => ({
        ...DEFAULT_PERMISSION_POLICY,
        grants: { [subject]: { 'identity:token': 'allow' as const } },
        fetchGrants: { [subject]: { 'api.example.com': 'allow' as const } },
    });

    it('同じ作者の同じ mod には許可が効く', () => {
        const policy = granted(permissionSubject('pen', ALICE));
        expect(isCapabilityGranted(policy, permissionSubject('pen', ALICE), 'identity:token')).toBe(true);
        expect(capabilityNeedsConsent(policy, permissionSubject('pen', ALICE), 'identity:token')).toBe(false);
        expect(resolveExternalDomainDecision(policy, permissionSubject('pen', ALICE), 'api.example.com')).toBe('allow');
    });

    it.each([
        ['同じ ID を名乗る別の作者', permissionSubject('pen', 'mallory@evil.example')],
        ['同じ ID の未署名 mod', permissionSubject('pen')],
        ['作者アカウントを ID に埋め込んだ未署名 mod', permissionSubject(`${ALICE}/pen`)],
        ['作者アカウントを ID に埋め込んだ別の作者の mod', permissionSubject(`${ALICE}/pen`, 'mallory@evil.example')],
        ['同じ作者の別の mod', permissionSubject('pen2', ALICE)],
        ['署名が必須になる前の記録のキー（ID だけ）', 'pen'],
    ])('%s は、許可を引き継がない', (_label, other) => {
        const policy = granted(permissionSubject('pen', ALICE));
        expect(other).not.toBe(permissionSubject('pen', ALICE));
        expect(isCapabilityGranted(policy, other, 'identity:token')).toBe(false);
        expect(capabilityNeedsConsent(policy, other, 'identity:token')).toBe(true);
        expect(resolveExternalDomainDecision(policy, other, 'api.example.com')).toBe('ask');
    });

    it('署名が必須になる前の記録（ID だけのキー）は、未署名の mod にも使われない', () => {
        const policy = granted('pen');
        expect(isCapabilityGranted(policy, permissionSubject('pen'), 'identity:token')).toBe(false);
        expect(isCapabilityGranted(policy, permissionSubject('pen', ALICE), 'identity:token')).toBe(false);
    });

    it('表示用に作者と ID へ戻せる（ID に / や @ があっても作者を取り違えない）', () => {
        expect(parsePermissionSubject(permissionSubject('pen', ALICE))).toEqual({ author: ALICE, modId: 'pen' });
        expect(parsePermissionSubject(permissionSubject('a/b@c', ALICE))).toEqual({ author: ALICE, modId: 'a/b@c' });
        expect(parsePermissionSubject(permissionSubject('pen'))).toEqual({ modId: 'pen' });
        expect(parsePermissionSubject(permissionSubject(`${ALICE}/pen`))).toEqual({ modId: `${ALICE}/pen` });
        expect(parsePermissionSubject('pen')).toEqual({ modId: 'pen' });
    });
});
