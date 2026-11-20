import { describe, expect, it } from 'vitest';
import { createSecretBox } from './secretBox';

const plain = new TextEncoder().encode('totp secret bytes');

describe('secretBox', () => {
    it('同じ鍵・同じ context で開ける。毎回違う暗号文になる', () => {
        const box = createSecretBox('server-secret', 'two-factor/totp-secret');
        const a = box.seal(plain, 'user-1');
        const b = box.seal(plain, 'user-1');
        expect(a).not.toBe(b);
        expect(a.startsWith('v1.')).toBe(true);
        expect(box.open(a, 'user-1')).toEqual(plain);
        expect(box.open(b, 'user-1')).toEqual(plain);
    });

    it('別のユーザー（context）・別の用途・別のサーバーの秘密では開けない', () => {
        const sealed = createSecretBox('server-secret', 'two-factor/totp-secret').seal(plain, 'user-1');
        expect(createSecretBox('server-secret', 'two-factor/totp-secret').open(sealed, 'user-2')).toBeNull();
        expect(createSecretBox('server-secret', 'other').open(sealed, 'user-1')).toBeNull();
        expect(createSecretBox('rotated-secret', 'two-factor/totp-secret').open(sealed, 'user-1')).toBeNull();
    });

    it('書き換えた・壊れた・形の違う値は開けない（投げずに null）', () => {
        const box = createSecretBox('server-secret', 'p');
        const sealed = box.seal(plain, 'u');
        const [version, iv, body, tag] = sealed.split('.');
        const flip = (s: string) => `${s.slice(0, -2)}${s.at(-2) === 'A' ? 'B' : 'A'}${s.at(-1)}`;
        for (const broken of [
            [version, iv, flip(body ?? ''), tag].join('.'),
            [version, iv, body, flip(tag ?? '')].join('.'),
            [version, flip(iv ?? ''), body, tag].join('.'),
            ['v2', iv, body, tag].join('.'),
            [version, iv, body].join('.'),
            '',
            'not-sealed',
        ]) {
            expect(box.open(broken, 'u')).toBeNull();
        }
    });
});
