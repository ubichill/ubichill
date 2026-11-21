import { describe, expect, it } from 'vitest';
import { createSecretBox } from './secretBox';
import { serverKeysFrom } from './serverKeys';

const plain = new TextEncoder().encode('totp secret bytes');
const keys = serverKeysFrom('server-secret');

describe('secretBox', () => {
    it('同じ秘密・同じ context で開ける。毎回違う暗号文になり、どの秘密で作ったかを残す', () => {
        const box = createSecretBox(keys, 'two-factor/totp-secret');
        const a = box.seal(plain, 'user-1');
        const b = box.seal(plain, 'user-1');
        expect(a).not.toBe(b);
        expect(a.startsWith(`v1.${keys.current.id}.`)).toBe(true);
        expect(a).not.toContain('server-secret');
        expect(box.open(a, 'user-1')).toEqual(plain);
        expect(box.open(b, 'user-1')).toEqual(plain);
    });

    it('別のユーザー（context）・別の用途・知らない秘密では開けない', () => {
        const sealed = createSecretBox(keys, 'two-factor/totp-secret').seal(plain, 'user-1');
        expect(createSecretBox(keys, 'two-factor/totp-secret').open(sealed, 'user-2')).toBeNull();
        expect(createSecretBox(keys, 'other').open(sealed, 'user-1')).toBeNull();
        expect(
            createSecretBox(serverKeysFrom('another-secret'), 'two-factor/totp-secret').open(sealed, 'user-1'),
        ).toBeNull();
    });

    it('秘密を入れ替えても、古い秘密が一覧に残っていれば開ける。新しく作るのは今の秘密で。外すと開けない', () => {
        const before = createSecretBox(serverKeysFrom('old-secret'), 'p').seal(plain, 'u');
        const rotated = serverKeysFrom({
            keys: new Map([
                [2, 'new-secret'],
                [1, 'old-secret'],
            ]),
            currentVersion: 2,
        });
        const box = createSecretBox(rotated, 'p');
        expect(box.open(before, 'u')).toEqual(plain);
        expect(box.seal(plain, 'u').startsWith(`v1.${serverKeysFrom('new-secret').current.id}.`)).toBe(true);
        const retired = serverKeysFrom({ keys: new Map([[2, 'new-secret']]), currentVersion: 2 });
        expect(createSecretBox(retired, 'p').open(before, 'u')).toBeNull();
        // BETTER_AUTH_SECRET から BETTER_AUTH_SECRETS に移っても、前の秘密（legacySecret）で作ったものは開ける
        const migrated = serverKeysFrom({
            keys: new Map([[1, 'new-secret']]),
            currentVersion: 1,
            legacySecret: 'old-secret',
        });
        expect(createSecretBox(migrated, 'p').open(before, 'u')).toEqual(plain);
    });

    it('書き換えた・壊れた・形の違う値は開けない（投げずに null）', () => {
        const box = createSecretBox(keys, 'p');
        const sealed = box.seal(plain, 'u');
        const [version, keyId, iv, body, tag] = sealed.split('.');
        const flip = (s: string) => `${s.slice(0, -2)}${s.at(-2) === 'A' ? 'B' : 'A'}${s.at(-1)}`;
        for (const broken of [
            [version, keyId, iv, flip(body ?? ''), tag].join('.'),
            [version, keyId, iv, body, flip(tag ?? '')].join('.'),
            [version, keyId, flip(iv ?? ''), body, tag].join('.'),
            // 短いタグ（GCM のタグを切り詰めて当てやすくする）は受け付けない
            [version, keyId, iv, body, (tag ?? '').slice(0, 6)].join('.'),
            ['v2', keyId, iv, body, tag].join('.'),
            [version, 'unknown', iv, body, tag].join('.'),
            [version, keyId, iv, body].join('.'),
            [version, keyId, iv, body, tag, 'extra'].join('.'),
            '',
            'not-sealed',
        ]) {
            expect(box.open(broken, 'u')).toBeNull();
        }
    });
});
