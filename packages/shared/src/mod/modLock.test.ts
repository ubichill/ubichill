import { describe, expect, it } from 'vitest';
import type { ModLockEntry } from '../schemas/modLock.schema';
import { WorldSourceKind } from '../schemas/world.schema';
import { formatIntegrity, integrityEquals, requiresLock, resolveLockedMod } from './modLock';

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

describe('requiresLock（provenance 別 enforcement）', () => {
    it('local / registry(official) は lock 不要', () => {
        expect(requiresLock(WorldSourceKind.Local)).toBe(false);
        expect(requiresLock(WorldSourceKind.Registry)).toBe(false);
    });

    it('github / remote-instance / url は lock 必須', () => {
        expect(requiresLock(WorldSourceKind.GitHub)).toBe(true);
        expect(requiresLock(WorldSourceKind.RemoteInstance)).toBe(true);
        expect(requiresLock(WorldSourceKind.Url)).toBe(true);
    });

    it('未知の kind は安全側で lock 必須', () => {
        expect(requiresLock('totally-unknown')).toBe(true);
    });
});

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
        const v = resolveLockedMod({ ...base, lockEntry: lockEntry(), sourceKind: WorldSourceKind.GitHub });
        expect(v).toEqual({ status: 'verified', capabilities: ['scene:read', 'media:control'] });
    });

    it('lock に記載が無い外部 mod は lock-missing で rejected', () => {
        const v = resolveLockedMod({ ...base, lockEntry: undefined, sourceKind: WorldSourceKind.Url });
        expect(v).toEqual({ status: 'rejected', reason: 'lock-missing' });
    });

    it('lock に記載が無くても local なら unlocked（従来挙動で続行）', () => {
        const v = resolveLockedMod({ ...base, lockEntry: undefined, sourceKind: WorldSourceKind.Local });
        expect(v).toEqual({ status: 'unlocked' });
    });

    it('entityType が lock の components に無ければ（別 component）外部は lock-missing', () => {
        const v = resolveLockedMod({
            ...base,
            entityType: 'video-player:controls',
            lockEntry: lockEntry(),
            sourceKind: WorldSourceKind.GitHub,
        });
        expect(v).toEqual({ status: 'rejected', reason: 'lock-missing' });
    });

    it('manifest hash 不一致は worker より先に manifest-mismatch を返す', () => {
        const v = resolveLockedMod({
            ...base,
            manifestIntegrity: 'sha256-TAMPERED',
            workerIntegrity: 'sha256-ALSO-BAD',
            lockEntry: lockEntry(),
            sourceKind: WorldSourceKind.GitHub,
        });
        expect(v).toEqual({ status: 'rejected', reason: 'manifest-mismatch' });
    });

    it('worker バイト列差し替えは integrity-mismatch', () => {
        const v = resolveLockedMod({
            ...base,
            workerIntegrity: 'sha256-SWAPPED',
            lockEntry: lockEntry(),
            sourceKind: WorldSourceKind.GitHub,
        });
        expect(v).toEqual({ status: 'rejected', reason: 'integrity-mismatch' });
    });

    it('配布者が manifest で権限を増やしても lock 天井のみが採用される（昇格不能）', () => {
        // lock は scene:read/media:control のみ。manifest 側の申告は resolveLockedMod に渡らず、
        // verified の capabilities は lock の 2 件に固定される。
        const v = resolveLockedMod({ ...base, lockEntry: lockEntry(), sourceKind: WorldSourceKind.RemoteInstance });
        expect(v.status).toBe('verified');
        if (v.status === 'verified') {
            expect(v.capabilities).not.toContain('net:fetch');
            expect([...v.capabilities].sort()).toEqual(['media:control', 'scene:read']);
        }
    });

    it('local でも lock 記載があれば hash 照合し、不一致は rejected（続行判断は loader）', () => {
        const v = resolveLockedMod({
            ...base,
            workerIntegrity: 'sha256-LOCAL-TAMPER',
            lockEntry: lockEntry(),
            sourceKind: WorldSourceKind.Local,
        });
        expect(v).toEqual({ status: 'rejected', reason: 'integrity-mismatch' });
    });
});
