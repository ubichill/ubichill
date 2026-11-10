import { describe, expect, it } from 'vitest';
import { CliAuthRequestInputSchema, cliAuthProofMessage, isLoopbackRedirectUri, normalizeUserCode } from './cliAuth';

describe('isLoopbackRedirectUri（認可コードを任意のホストへ送らせない）', () => {
    it('http の 127.0.0.1 / localhost / [::1] でポート付きだけ受け付ける', () => {
        for (const ok of ['http://127.0.0.1:53682/callback', 'http://localhost:8080/cb', 'http://[::1]:9000/']) {
            expect(isLoopbackRedirectUri(ok)).toBe(true);
        }
    });

    it('外部ホスト・https・ポートなし・資格情報や fragment 付き・それっぽいホスト名は拒否する', () => {
        for (const bad of [
            'http://evil.example:8080/cb',
            'https://127.0.0.1:8080/cb',
            'http://127.0.0.1/cb',
            'http://user:pw@127.0.0.1:8080/cb',
            'http://127.0.0.1:8080/cb#x',
            'http://127.0.0.1.evil.example:8080/cb',
            'http://localhost.evil.example:8080/cb',
            'javascript:alert(1)',
            'not a url',
        ]) {
            expect(isLoopbackRedirectUri(bad)).toBe(false);
        }
    });
});

describe('cliAuthProofMessage', () => {
    it('要求ごとに違う文になる（ほかの要求の証明を使い回せない）', () => {
        expect(cliAuthProofMessage('a')).not.toBe(cliAuthProofMessage('b'));
    });
});

describe('normalizeUserCode', () => {
    it('大文字小文字・ハイフン・空白の揺れを許して XXXX-XXXX にする', () => {
        expect(normalizeUserCode('bcdf-ghjk')).toBe('BCDF-GHJK');
        expect(normalizeUserCode(' BCDF GHJK ')).toBe('BCDF-GHJK');
    });

    it('使わない文字（母音・数字）や長さ違いは null', () => {
        expect(normalizeUserCode('ABCD-EFGH')).toBeNull();
        expect(normalizeUserCode('BCDF-GHJ1')).toBeNull();
        expect(normalizeUserCode('BCDF-GHJ')).toBeNull();
    });
});

describe('CliAuthRequestInputSchema', () => {
    const base = { kind: 'cli', name: 'ubichill CLI on work-pc', publicKey: 'A'.repeat(43) };

    it('デバイス認可（redirectUri なし）とループバック（redirectUri と codeChallenge）を受け付ける', () => {
        expect(CliAuthRequestInputSchema.safeParse(base).success).toBe(true);
        expect(
            CliAuthRequestInputSchema.safeParse({
                ...base,
                redirectUri: 'http://127.0.0.1:5000/cb',
                codeChallenge: 'B'.repeat(43),
            }).success,
        ).toBe(true);
    });

    it('種類は cli / ci だけ。browser・legacy の公開環境は CLI からは作らせない', () => {
        expect(CliAuthRequestInputSchema.safeParse({ ...base, kind: 'browser' }).success).toBe(false);
        expect(CliAuthRequestInputSchema.safeParse({ ...base, kind: 'legacy' }).success).toBe(false);
    });
});
