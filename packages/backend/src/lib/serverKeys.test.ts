import { describe, expect, it } from 'vitest';
import { keyedHmac, matchesKeyedHmac, serverKeysFrom } from './serverKeys';

describe('serverKeys', () => {
    it('今の秘密は BETTER_AUTH_SECRETS の今の版（無ければ BETTER_AUTH_SECRET）。指紋に秘密そのものは出ない', () => {
        expect(serverKeysFrom('only').current.secret).toBe('only');
        const keys = serverKeysFrom({
            keys: new Map([
                [3, 'three'],
                [2, 'two'],
            ]),
            currentVersion: 3,
            legacySecret: 'legacy',
        });
        expect(keys.current.secret).toBe('three');
        expect(keys.current.id).not.toContain('three');
        for (const secret of ['two', 'legacy']) {
            expect(keys.find(serverKeysFrom(secret).current.id)?.secret).toBe(secret);
        }
        expect(keys.find('nope')).toBeUndefined();
        expect(() => serverKeysFrom({ keys: new Map(), currentVersion: 1 })).toThrow();
    });

    it('HMAC は作った秘密が一覧に残っている間だけ合う。言葉が違えば合わない', () => {
        const old = serverKeysFrom('old');
        const stored = keyedHmac(old, 'message');
        const rotated = serverKeysFrom({
            keys: new Map([
                [2, 'new'],
                [1, 'old'],
            ]),
            currentVersion: 2,
        });
        expect(matchesKeyedHmac(rotated, 'message', stored)).toBe(true);
        expect(matchesKeyedHmac(rotated, 'other', stored)).toBe(false);
        expect(matchesKeyedHmac(serverKeysFrom('new'), 'message', stored)).toBe(false);
        for (const broken of ['', 'x', `${old.current.id}.`, `${old.current.id}.abc`, `${stored}.extra`]) {
            expect(matchesKeyedHmac(rotated, 'message', broken)).toBe(false);
        }
    });
});
