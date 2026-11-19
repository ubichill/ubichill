import { describe, expect, it } from 'vitest';
import { createLoginPolicy } from './loginPolicy';

const base = { fediverseEnabled: true, allowedServers: new Set<string>(), isBlocked: () => false };

describe('createLoginPolicy', () => {
    it('パスワードは常に使え、知らない方式は使えない', () => {
        const usable = createLoginPolicy({ ...base, fediverseEnabled: false });
        expect(usable('credential')).toBe(true);
        expect(usable('github')).toBe(false);
        expect(usable('fediverse:not a url')).toBe(false);
    });

    it('無効化・許可外・block の外部アカウントは使えない', () => {
        expect(createLoginPolicy({ ...base, fediverseEnabled: false })('fediverse:https://mi.example')).toBe(false);
        const limited = createLoginPolicy({ ...base, allowedServers: new Set(['mi.example']) });
        expect(limited('fediverse:https://mi.example')).toBe(true);
        expect(limited('fediverse:https://other.example')).toBe(false);
        const blocked = createLoginPolicy({ ...base, isBlocked: (host) => host === 'bad.example' });
        expect(blocked('fediverse:https://bad.example')).toBe(false);
        expect(blocked('fediverse:https://mi.example')).toBe(true);
    });
});
