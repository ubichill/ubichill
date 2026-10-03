import { describe, expect, it } from 'vitest';
import type { ModLockEntry } from '../schemas/modLock.schema';
import { formatIntegrity, integrityEquals, resolveLockedMod } from './modLock';

const WORKER_OK = 'sha256-AAAA';
const MANIFEST_OK = 'sha256-BBBB';

/** テスト用の lock エントリ。既定は video-player:screen を 1 つ持つ。 */
function lockEntry(overrides: Partial<ModLockEntry> = {}): ModLockEntry {
    return {
        id: 'video-player',
        version: '2.1.0',
        manifestIntegrity: MANIFEST_OK,
        components: {
            'video-player:screen': {
                workerUrl: './screen/index.abc.js',
                integrity: WORKER_OK,
                capabilities: ['scene:read', 'media:control'],
            },
        },
        ...overrides,
    };
}

describe('integrityEquals / formatIntegrity', () => {
    it('formatIntegrity は sha256- を前置する', () => {
        expect(formatIntegrity('Zm9v')).toBe('sha256-Zm9v');
    });

    it('前後空白を無視して一致する', () => {
        expect(integrityEquals(' sha256-Zm9v ', 'sha256-Zm9v')).toBe(true);
    });

    it('undefined 同士・片側 undefined は不一致（フェイルセーフ）', () => {
        expect(integrityEquals(undefined, undefined)).toBe(false);
        expect(integrityEquals('sha256-Zm9v', undefined)).toBe(false);
    });

    it('アルゴリズム前置が違えば不一致（部分一致を許さない）', () => {
        expect(integrityEquals('sha256-Zm9v', 'Zm9v')).toBe(false);
    });
});

describe('resolveLockedMod', () => {
    const base = {
        entityType: 'video-player:screen',
        workerIntegrity: WORKER_OK,
        manifestIntegrity: MANIFEST_OK,
    };

    it('全一致で verified、capabilities は lock 天井を採用', () => {
        const v = resolveLockedMod({ ...base, lockEntry: lockEntry() });
        expect(v).toEqual({ status: 'verified', capabilities: ['scene:read', 'media:control'] });
    });

    it('lock に記載が無い mod は、ワールドの置き場所に関係なく lock-missing で rejected（本体のワールドも緩めない）', () => {
        const v = resolveLockedMod({ ...base, lockEntry: undefined });
        expect(v).toEqual({ status: 'rejected', reason: 'lock-missing' });
    });

    it('entityType が lock の components に無ければ（別 component）lock-missing', () => {
        const v = resolveLockedMod({
            ...base,
            entityType: 'video-player:controls',
            lockEntry: lockEntry(),
        });
        expect(v).toEqual({ status: 'rejected', reason: 'lock-missing' });
    });

    it('manifest hash 不一致は worker より先に manifest-mismatch を返す', () => {
        const v = resolveLockedMod({
            ...base,
            manifestIntegrity: 'sha256-TAMPERED',
            workerIntegrity: 'sha256-ALSO-BAD',
            lockEntry: lockEntry(),
        });
        expect(v).toEqual({ status: 'rejected', reason: 'manifest-mismatch' });
    });

    it('worker バイト列差し替えは integrity-mismatch', () => {
        const v = resolveLockedMod({
            ...base,
            workerIntegrity: 'sha256-SWAPPED',
            lockEntry: lockEntry(),
        });
        expect(v).toEqual({ status: 'rejected', reason: 'integrity-mismatch' });
    });

    it('配布者が manifest で権限を増やしても lock 天井のみが採用される（昇格不能）', () => {
        // lock は scene:read/media:control のみ。manifest 側の申告は resolveLockedMod に渡らず、
        // verified の capabilities は lock の 2 件に固定される。
        const v = resolveLockedMod({ ...base, lockEntry: lockEntry() });
        expect(v.status).toBe('verified');
        if (v.status === 'verified') {
            expect(v.capabilities).not.toContain('net:fetch');
            expect([...v.capabilities].sort()).toEqual(['media:control', 'scene:read']);
        }
    });

    it('hash が一致しなければ、どこに置いたワールドでも rejected', () => {
        const v = resolveLockedMod({
            ...base,
            workerIntegrity: 'sha256-LOCAL-TAMPER',
            lockEntry: lockEntry(),
        });
        expect(v).toEqual({ status: 'rejected', reason: 'integrity-mismatch' });
    });
});
