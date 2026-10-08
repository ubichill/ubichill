import { describe, expect, it } from 'vitest';
import {
    checkServiceTokenClaims,
    isServiceTokenClaims,
    normalizeServiceAudience,
    SERVICE_TOKEN_TTL_SECONDS,
    type ServiceTokenClaims,
    serviceTokenKeysUrl,
} from './serviceToken';

const AUDIENCE = 'https://videoplayer.example';
const NOW = 1_800_000_000;

function claims(overrides: Partial<ServiceTokenClaims> = {}): ServiceTokenClaims {
    return {
        iss: 'https://ubichill.example',
        aud: AUDIENCE,
        sub: 'pseudonym',
        mod: 'video-player',
        iat: NOW,
        exp: NOW + SERVICE_TOKEN_TTL_SECONDS,
        jti: 'jti-1',
        ...overrides,
    };
}

describe('normalizeServiceAudience', () => {
    it.each([
        ['https://videoplayer.example', 'https://videoplayer.example'],
        ['https://videoplayer.example/', 'https://videoplayer.example'],
        ['https://Video.Example:8443', 'https://video.example:8443'],
        ['https://video.example:443', 'https://video.example'],
        ['https://xn--r8jz45g.example', 'https://xn--r8jz45g.example'],
        ['http://localhost:8000', 'http://localhost:8000'],
        ['http://127.0.0.1:8000/', 'http://127.0.0.1:8000'],
    ])('オリジンとして受け付ける: %s', (input, expected) => {
        expect(normalizeServiceAudience(input)).toBe(expected);
    });

    it.each([
        'http://videoplayer.example',
        'https://videoplayer.example/api',
        'https://videoplayer.example/?q=1',
        'https://videoplayer.example/#x',
        'https://user:pass@videoplayer.example',
        'https://videoplayer.example:0',
        'https://videoplayer.example:70000',
        'https://.example',
        'https://a..example',
        'https://例え.example',
        'ftp://videoplayer.example',
        'videoplayer.example',
        ' https://videoplayer.example',
        '',
    ])('拒否する: %j', (input) => {
        expect(normalizeServiceAudience(input)).toBeNull();
    });
});

describe('checkServiceTokenClaims', () => {
    const rules = { audience: AUDIENCE, now: NOW + 10 };

    it('宛先・期限・mod が合えば null（受け付ける）', () => {
        expect(checkServiceTokenClaims(claims(), rules)).toBeNull();
    });

    it('別のサービス宛てのトークンは通らない', () => {
        expect(checkServiceTokenClaims(claims({ aud: 'https://other.example' }), rules)).toBe('wrong-audience');
    });

    it('期限切れ・未来の発行時刻は、時計のずれ（既定 30 秒）を超えたら拒否する', () => {
        const at = (now: number) => checkServiceTokenClaims(claims(), { audience: AUDIENCE, now });
        expect(at(NOW + SERVICE_TOKEN_TTL_SECONDS + 29)).toBeNull();
        expect(at(NOW + SERVICE_TOKEN_TTL_SECONDS + 30)).toBe('expired');
        expect(at(NOW - 31)).toBe('not-yet-valid');
    });

    it('allowedMods に無い mod は拒否する', () => {
        expect(checkServiceTokenClaims(claims({ mod: 'pen' }), { ...rules, allowedMods: ['video-player'] })).toBe(
            'mod-not-allowed',
        );
    });
});

describe('isServiceTokenClaims', () => {
    it('必要な項目がそろっていれば true', () => {
        expect(isServiceTokenClaims(claims())).toBe(true);
    });

    it.each([null, 'x', {}, { ...claims(), exp: '1' }, { ...claims(), sub: 1 }, { ...claims(), iat: Number.NaN }])(
        '欠けている・型が違えば false: %j',
        (value) => {
            expect(isServiceTokenClaims(value)).toBe(false);
        },
    );
});

describe('serviceTokenKeysUrl', () => {
    it('発行元のオリジンから公開鍵の URL を導く', () => {
        expect(serviceTokenKeysUrl('https://ubichill.example')).toBe(
            'https://ubichill.example/api/v1/service-tokens/keys',
        );
    });
});
