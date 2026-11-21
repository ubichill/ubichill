import { describe, expect, it, vi } from 'vitest';
import { botCheckHeaders, botWidgetOptions } from './botProtection';

vi.mock('@/lib/api', () => ({ API_BASE: '' }));

describe('botWidgetOptions', () => {
    const handlers = () => ({ onToken: vi.fn(), onError: vi.fn() });

    it('Turnstile には action を渡し、幅いっぱいに広げる', () => {
        const options = botWidgetOptions({ provider: 'turnstile', siteKey: 'site' }, 'sign-in', handlers());
        expect(options).toMatchObject({ sitekey: 'site', action: 'sign-in', size: 'flexible', theme: 'light' });
    });

    it('hCaptcha には action を渡さない（受け付けない）', () => {
        const options = botWidgetOptions({ provider: 'hcaptcha', siteKey: 'site' }, 'sign-up', handlers());
        expect(options).toMatchObject({ sitekey: 'site' });
        expect(options).not.toHaveProperty('action');
    });

    it('トークンが届いたら渡し、期限切れ・失敗では null を渡す', () => {
        const h = handlers();
        const options = botWidgetOptions({ provider: 'turnstile', siteKey: 'site' }, 'sign-in', h);
        const call = (name: string, ...args: unknown[]) => (options[name] as (...a: unknown[]) => void)(...args);
        call('callback', 'token-1');
        call('callback', '');
        call('expired-callback');
        call('timeout-callback');
        call('error-callback');
        expect(h.onToken.mock.calls).toEqual([['token-1'], [null], [null], [null], [null]]);
        expect(h.onError).toHaveBeenCalledTimes(1);
    });
});

describe('botCheckHeaders', () => {
    it('トークンが無ければヘッダーを付けない', () => {
        expect(botCheckHeaders(null)).toEqual({});
        expect(botCheckHeaders('t')).toEqual({ 'x-bot-check': 't' });
    });
});
