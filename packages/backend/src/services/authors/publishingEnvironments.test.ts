import { describe, expect, it } from 'vitest';
import {
    browserEnvironmentName,
    newEnvironmentNotice,
    registrationOutcome,
    signingKeyListOf,
} from './publishingEnvironments';

const K1 = 'A'.repeat(43);
const K2 = 'B'.repeat(43);
const _K3 = 'C'.repeat(43);
const at = (iso: string) => new Date(iso);

describe('registrationOutcome', () => {
    it('未登録の鍵は新しい公開環境として受け付ける', () => {
        expect(registrationOutcome(undefined, 'u1')).toBe('new');
    });

    it('本人の有効な鍵は登録済み（同じブラウザからの再登録で重複させない）', () => {
        expect(registrationOutcome({ userId: 'u1', revokedAt: null }, 'u1')).toBe('already-registered');
    });

    it('取り消した鍵は本人でも二度と有効にしない', () => {
        expect(registrationOutcome({ userId: 'u1', revokedAt: at('2026-09-01T00:00:00Z') }, 'u1')).toBe('revoked');
    });

    it('他人の鍵は受け付けない（取り消し済みでも）', () => {
        expect(registrationOutcome({ userId: 'u2', revokedAt: null }, 'u1')).toBe('taken');
        expect(registrationOutcome({ userId: 'u2', revokedAt: at('2026-09-01T00:00:00Z') }, 'u1')).toBe('taken');
    });
});

describe('signingKeyListOf', () => {
    it('取り消した鍵も revokedAt 付きで残す（取り消しと取得失敗を区別できるように）', () => {
        const list = signingKeyListOf(
            'youkan@ubichill.com',
            [
                {
                    id: 'e1',
                    userId: 'u1',
                    kind: 'browser',
                    name: 'Chrome on Mac',
                    publicKey: K1,
                    createdAt: at('2026-09-01T00:00:00Z'),
                    lastUsedAt: null,
                    revokedAt: at('2026-09-02T00:00:00Z'),
                },
                {
                    id: 'e2',
                    userId: 'u1',
                    kind: 'cli',
                    name: 'CLI',
                    publicKey: K2,
                    createdAt: at('2026-09-03T00:00:00Z'),
                    lastUsedAt: null,
                    revokedAt: null,
                },
            ],
            at('2026-09-29T00:00:00Z'),
        );
        expect(list).toEqual({
            account: 'youkan@ubichill.com',
            issuedAt: '2026-09-29T00:00:00.000Z',
            keys: [
                { publicKey: K1, addedAt: '2026-09-01T00:00:00.000Z', revokedAt: '2026-09-02T00:00:00.000Z' },
                { publicKey: K2, addedAt: '2026-09-03T00:00:00.000Z' },
            ],
        });
    });
});

describe('browserEnvironmentName', () => {
    it('ブラウザと OS から見分けやすい名前を作る', () => {
        expect(
            browserEnvironmentName(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
            ),
        ).toBe('Chrome on Mac');
        expect(
            browserEnvironmentName(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
            ),
        ).toBe('Edge on Windows');
        expect(
            browserEnvironmentName(
                'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            ),
        ).toBe('Safari on iPhone');
    });

    it('分からなければ「ブラウザ」', () => {
        expect(browserEnvironmentName(undefined)).toBe('ブラウザ');
        expect(browserEnvironmentName('curl/8.0')).toBe('ブラウザ');
    });
});

describe('newEnvironmentNotice（乗っ取りに気付けるように）', () => {
    it('追加された環境の名前と、心当たりがないときの対処（漏えいとして取り消す・パスワード変更・ログアウト）を伝える', () => {
        const notice = newEnvironmentNotice({
            displayName: 'ようかん',
            environmentName: 'Chrome on Windows',
            siteUrl: 'https://ubichill.com/',
            at: new Date('2026-10-01T00:00:00Z'),
        });
        expect(notice.subject).toContain('新しい公開環境');
        expect(notice.text).toContain('Chrome on Windows');
        expect(notice.text).toContain('https://ubichill.com/ を開き、設定の「公開」');
        expect(notice.text).toContain('心当たりのない環境');
        expect(notice.text).toContain('パスワード');
        expect(notice.text).toContain('ログアウト');
    });
});
