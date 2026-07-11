// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { PermissionPolicy } from '@ubichill/sandbox';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PermissionProvider, useUbiPermissions } from './PermissionContext';

function setup(onPolicyChange?: (p: PermissionPolicy) => void) {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <PermissionProvider onPolicyChange={onPolicyChange}>{children}</PermissionProvider>
    );
    const { result } = renderHook(() => useUbiPermissions(), { wrapper });
    if (!result.current) throw new Error('permissions context is null');
    return result as { current: NonNullable<typeof result.current> };
}

describe('authorizeCapability', () => {
    it('safe / sensitive は既定で同期的に許可し、プロンプトを出さない', () => {
        const ctx = setup();
        expect(ctx.current.authorizeCapability('plugin-a', 'scene:read')).toBe(true);
        expect(ctx.current.authorizeCapability('plugin-a', 'scene:update')).toBe(true);
        expect(ctx.current.pendingPrompt).toBeNull();
    });

    it('net:fetch は capability レベルでは常に許可（承認はドメイン単位）', () => {
        const ctx = setup();
        expect(ctx.current.authorizeCapability('plugin-a', 'net:fetch')).toBe(true);
        expect(ctx.current.pendingPrompt).toBeNull();
    });

    it('危険な capability（未知含む）は承認プロンプトを出し、許可するまで解決しない', async () => {
        const onChange = vi.fn();
        const ctx = setup(onChange);

        let promise: boolean | Promise<boolean> = false;
        act(() => {
            promise = ctx.current.authorizeCapability('plugin-a', 'mystery:power'); // 未知 → dangerous
        });
        expect(ctx.current.pendingPrompt).toEqual({
            kind: 'capability',
            pluginId: 'plugin-a',
            capability: 'mystery:power',
        });

        act(() => {
            ctx.current.resolvePrompt('allow');
        });
        await expect(promise).resolves.toBe(true);
        expect(ctx.current.pendingPrompt).toBeNull();
        expect(onChange).toHaveBeenCalled();
        // 記憶され再プロンプトなし
        expect(ctx.current.authorizeCapability('plugin-a', 'mystery:power')).toBe(true);
    });

    it('拒否すると false を返し記憶される', async () => {
        const ctx = setup();
        let promise: boolean | Promise<boolean> = true;
        act(() => {
            promise = ctx.current.authorizeCapability('plugin-a', 'mystery:power');
        });
        act(() => {
            ctx.current.resolvePrompt('deny');
        });
        await expect(promise).resolves.toBe(false);
        expect(ctx.current.authorizeCapability('plugin-a', 'mystery:power')).toBe(false);
    });

    it('setTierDefaults で sensitive を ask にすると sensitive も承認待ちになる', () => {
        const ctx = setup();
        act(() => {
            ctx.current.setTierDefaults({ safe: 'allow', sensitive: 'ask', dangerous: 'ask' });
        });
        act(() => {
            void ctx.current.authorizeCapability('plugin-a', 'scene:update');
        });
        expect(ctx.current.pendingPrompt).toEqual({
            kind: 'capability',
            pluginId: 'plugin-a',
            capability: 'scene:update',
        });
    });

    it('revokeGrant で記憶した判断を取り消せる', async () => {
        const ctx = setup();
        let promise: boolean | Promise<boolean> = false;
        act(() => {
            promise = ctx.current.authorizeCapability('plugin-a', 'mystery:power');
        });
        act(() => {
            ctx.current.resolvePrompt('allow');
        });
        await promise;
        expect(ctx.current.authorizeCapability('plugin-a', 'mystery:power')).toBe(true);

        act(() => {
            ctx.current.revokeGrant('plugin-a', 'mystery:power');
        });
        act(() => {
            void ctx.current.authorizeCapability('plugin-a', 'mystery:power');
        });
        expect(ctx.current.pendingPrompt).toEqual({
            kind: 'capability',
            pluginId: 'plugin-a',
            capability: 'mystery:power',
        });
    });
});

describe('authorizeFetchDomain', () => {
    it('既定（確認シールド）はドメインごとにプロンプトを出し、許可するまで解決しない', async () => {
        const ctx = setup();
        let promise: boolean | Promise<boolean> = false;
        act(() => {
            promise = ctx.current.authorizeFetchDomain('plugin-a', 'api.example.com');
        });
        expect(ctx.current.pendingPrompt).toEqual({ kind: 'fetch', pluginId: 'plugin-a', domain: 'api.example.com' });

        act(() => {
            ctx.current.resolvePrompt('allow');
        });
        await expect(promise).resolves.toBe(true);
        // 記憶され再プロンプトなし
        expect(ctx.current.authorizeFetchDomain('plugin-a', 'api.example.com')).toBe(true);
    });

    it('拒否したドメインは false を返し記憶される', async () => {
        const ctx = setup();
        let promise: boolean | Promise<boolean> = true;
        act(() => {
            promise = ctx.current.authorizeFetchDomain('plugin-a', 'evil.example.com');
        });
        act(() => {
            ctx.current.resolvePrompt('deny');
        });
        await expect(promise).resolves.toBe(false);
        expect(ctx.current.authorizeFetchDomain('plugin-a', 'evil.example.com')).toBe(false);
    });

    it('シールド「なし」（dangerous=allow）は全ドメインを即許可・プロンプトなし', () => {
        const ctx = setup();
        act(() => {
            ctx.current.setTierDefaults({ safe: 'allow', sensitive: 'allow', dangerous: 'allow' });
        });
        expect(ctx.current.authorizeFetchDomain('plugin-a', 'api.example.com')).toBe(true);
        expect(ctx.current.pendingPrompt).toBeNull();
    });

    it('シールド「拒否」（dangerous=deny）は全ドメインを即拒否', () => {
        const ctx = setup();
        act(() => {
            ctx.current.setTierDefaults({ safe: 'allow', sensitive: 'deny', dangerous: 'deny' });
        });
        expect(ctx.current.authorizeFetchDomain('plugin-a', 'api.example.com')).toBe(false);
    });

    it('別ドメインは独立して承認される', async () => {
        const ctx = setup();
        let p1: boolean | Promise<boolean> = false;
        act(() => {
            p1 = ctx.current.authorizeFetchDomain('plugin-a', 'a.example.com');
        });
        act(() => {
            ctx.current.resolvePrompt('allow');
        });
        await p1;
        // a は許可済み・同期 true、b は未判断なので新たにプロンプト
        expect(ctx.current.authorizeFetchDomain('plugin-a', 'a.example.com')).toBe(true);
        act(() => {
            void ctx.current.authorizeFetchDomain('plugin-a', 'b.example.com');
        });
        expect(ctx.current.pendingPrompt).toEqual({ kind: 'fetch', pluginId: 'plugin-a', domain: 'b.example.com' });
    });

    it('revokeFetchGrant で記憶を取り消せる', async () => {
        const ctx = setup();
        let promise: boolean | Promise<boolean> = false;
        act(() => {
            promise = ctx.current.authorizeFetchDomain('plugin-a', 'api.example.com');
        });
        act(() => {
            ctx.current.resolvePrompt('allow');
        });
        await promise;
        act(() => {
            ctx.current.revokeFetchGrant('plugin-a', 'api.example.com');
        });
        act(() => {
            void ctx.current.authorizeFetchDomain('plugin-a', 'api.example.com');
        });
        expect(ctx.current.pendingPrompt).toEqual({ kind: 'fetch', pluginId: 'plugin-a', domain: 'api.example.com' });
    });
});
