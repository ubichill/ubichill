import { describe, expect, it } from 'vitest';
import {
    contactEmailOf,
    displayNameCandidateOf,
    fediverseHostOf,
    fediverseProviderId,
    fediverseSignInErrorMessage,
    handleCandidateOf,
    isPlaceholderEmail,
    isReservedEmail,
    parseFediverseServer,
    placeholderEmail,
    safeReturnTo,
} from './fediverseSignIn';

describe('parseFediverseServer', () => {
    it('ドメイン・URL・ハンドルのどれからでもホストを取り出す', () => {
        for (const input of [
            'mastodon.social',
            ' Mastodon.Social ',
            'https://mastodon.social/',
            'https://mastodon.social',
            '@alice@mastodon.social',
            'alice@mastodon.social',
        ]) {
            expect(parseFediverseServer(input)).toEqual({ ok: true, host: 'mastodon.social' });
        }
    });

    it('IDN は punycode にし、開発用のポートは残す', () => {
        expect(parseFediverseServer('みすきー.example')).toEqual({ ok: true, host: 'xn--w8jxa7itv.example' });
        expect(parseFediverseServer('localhost:3000')).toEqual({ ok: true, host: 'localhost:3000' });
    });

    it('パス・クエリ・資格情報・空は拒否する（別の URL に飛ばさせない）', () => {
        for (const input of [
            '',
            '  ',
            'https://mastodon.social/@alice',
            'https://mastodon.social/?x=1',
            'https://user:pass@mastodon.social',
            'mastodon social',
            'https://mastodon.social#x',
        ]) {
            expect(parseFediverseServer(input).ok).toBe(false);
        }
    });
});

describe('providerId', () => {
    it('origin と往復でき、ほかの方式は null', () => {
        expect(fediverseHostOf(fediverseProviderId('https://mi.example'))).toBe('mi.example');
        expect(fediverseHostOf('credential')).toBeNull();
        expect(fediverseHostOf('fediverse:not a url')).toBeNull();
    });
});

describe('メールなしユーザーの内部値', () => {
    it('予約ドメインは連絡先にならない（確認済みでも）', () => {
        const email = placeholderEmail('ABC123');
        expect(email).toBe('abc123@sso.invalid');
        expect(isPlaceholderEmail(email.toUpperCase())).toBe(true);
        expect(contactEmailOf({ email, emailVerified: true })).toBeNull();
    });

    it('未確認の実アドレスも連絡先にならない', () => {
        expect(contactEmailOf({ email: 'a@example.com', emailVerified: false })).toBeNull();
        expect(contactEmailOf({ email: 'a@example.com', emailVerified: true })).toBe('a@example.com');
    });

    it('.invalid のアドレスは登録で受け付けない', () => {
        expect(isReservedEmail('x@sso.invalid')).toBe(true);
        expect(isReservedEmail('x@other.INVALID ')).toBe(true);
        expect(isReservedEmail('x@invalid.example')).toBe(false);
    });
});

describe('handleCandidateOf', () => {
    it('使えない文字を _ にし、小文字・30 文字にする', () => {
        expect(handleCandidateOf('Alice.Bob-1')).toBe('alice_bob_1');
        expect(handleCandidateOf('x'.repeat(40))).toBe('x'.repeat(30));
    });

    it('短すぎる・予約語・日本語だけは候補を出さない', () => {
        expect(handleCandidateOf('ab')).toBe('');
        expect(handleCandidateOf('admin')).toBe('');
        expect(handleCandidateOf('ようかん')).toBe('');
        expect(handleCandidateOf('__')).toBe('');
    });
});

describe('displayNameCandidateOf', () => {
    it('カスタム絵文字を外し、空ならユーザー名', () => {
        expect(displayNameCandidateOf(':blobcat: ようかん :party:', 'youkan')).toBe('ようかん');
        expect(displayNameCandidateOf(':blobcat:', 'youkan')).toBe('youkan');
        expect(displayNameCandidateOf(null, 'youkan')).toBe('youkan');
    });

    it('長い名前は文字単位で切る（サロゲートペアを壊さない）', () => {
        const name = displayNameCandidateOf('𩸽'.repeat(40), 'x');
        expect(Array.from(name)).toHaveLength(30);
        expect(name.endsWith('𩸽')).toBe(true);
    });

    it('制御文字を含む名前は使わない', () => {
        expect(displayNameCandidateOf('a\u0007b', 'youkan')).toBe('youkan');
    });
});

describe('safeReturnTo', () => {
    it('相対 URL はそのまま', () => {
        expect(safeReturnTo('/@alice/world?x=1#y')).toBe('/@alice/world?x=1#y');
    });

    it('外への URL・プロトコル相対・バックスラッシュ・制御文字は / にする', () => {
        for (const raw of [
            'https://evil.example',
            '//evil.example',
            '/\\evil.example',
            'javascript:alert(1)',
            '/a\nb',
            '',
            undefined,
            42,
            `/${'a'.repeat(2001)}`,
        ]) {
            expect(safeReturnTo(raw)).toBe('/');
        }
    });
});

describe('fediverseSignInErrorMessage', () => {
    it('知らないコードは一般的な失敗にする（任意の文字列を画面に出さない）', () => {
        expect(fediverseSignInErrorMessage('<script>')).toBe(fediverseSignInErrorMessage('failed'));
        expect(fediverseSignInErrorMessage(null)).toBeNull();
    });
});
