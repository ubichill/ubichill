import type { BotProtectionSettings } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { type BotProtectionDraft, botProtectionDraftState, canReuseSecret, draftFrom } from './botProtectionForm';

const off: BotProtectionSettings = { config: null, secretReadable: true, updatedAt: null };
const turnstile: BotProtectionSettings = {
    config: { provider: 'turnstile', siteKey: 'site-1' },
    secretReadable: true,
    updatedAt: '2026-11-21T00:00:00.000Z',
};
const draft = (overrides: Partial<BotProtectionDraft> = {}): BotProtectionDraft => ({
    provider: 'turnstile',
    siteKey: 'site-1',
    secret: '',
    token: null,
    ...overrides,
});

describe('botProtectionDraftState', () => {
    it('今の設定のままなら保存するものは無い（確認も要らない）', () => {
        expect(botProtectionDraftState(off, draftFrom(off))).toEqual({ kind: 'unchanged' });
        expect(botProtectionDraftState(turnstile, draftFrom(turnstile))).toEqual({ kind: 'unchanged' });
        // 前後の空白だけの違いも同じ
        expect(botProtectionDraftState(turnstile, draft({ siteKey: ' site-1 ' }))).toEqual({ kind: 'unchanged' });
    });

    it('使わないにするのは確認なしで送れる', () => {
        expect(botProtectionDraftState(turnstile, draft({ provider: null }))).toEqual({
            kind: 'ready',
            update: { provider: null },
        });
    });

    it('読めない設定が残っていれば、使わないにして消せる', () => {
        const unreadable: BotProtectionSettings = { config: null, secretReadable: false, updatedAt: null };
        expect(botProtectionDraftState(unreadable, draftFrom(unreadable))).toEqual({
            kind: 'ready',
            update: { provider: null },
        });
    });

    it('初めて使うときはサイトキー・シークレットキー・確認の順に求める', () => {
        expect(botProtectionDraftState(off, draft({ siteKey: '  ' }))).toEqual({
            kind: 'incomplete',
            missing: 'siteKey',
        });
        expect(botProtectionDraftState(off, draft())).toEqual({ kind: 'incomplete', missing: 'secret' });
        expect(botProtectionDraftState(off, draft({ secret: 'sec' }))).toEqual({
            kind: 'incomplete',
            missing: 'check',
        });
        expect(botProtectionDraftState(off, draft({ secret: ' sec ', token: 'tok' }))).toEqual({
            kind: 'ready',
            update: { provider: 'turnstile', siteKey: 'site-1', secret: 'sec', token: 'tok' },
        });
    });

    it('同じサービスでサイトキーだけ変えるなら、シークレットキーは送らない（保存済みのものを使う）', () => {
        expect(botProtectionDraftState(turnstile, draft({ siteKey: 'site-2', token: 'tok' }))).toEqual({
            kind: 'ready',
            update: { provider: 'turnstile', siteKey: 'site-2', token: 'tok' },
        });
    });

    it('シークレットキーだけ変えるときも、確かめてから', () => {
        expect(botProtectionDraftState(turnstile, draft({ secret: 'new' }))).toEqual({
            kind: 'incomplete',
            missing: 'check',
        });
    });

    it('別のサービスに変える・保存済みのものを開けないときは、シークレットキーを入れ直す', () => {
        expect(botProtectionDraftState(turnstile, draft({ provider: 'hcaptcha', token: 'tok' }))).toEqual({
            kind: 'incomplete',
            missing: 'secret',
        });
        const unreadable = { ...turnstile, secretReadable: false };
        expect(canReuseSecret(unreadable, 'turnstile')).toBe(false);
        expect(botProtectionDraftState(unreadable, draftFrom(unreadable))).toEqual({
            kind: 'incomplete',
            missing: 'secret',
        });
    });
});
