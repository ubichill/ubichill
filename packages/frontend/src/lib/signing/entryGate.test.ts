import { describe, expect, it } from 'vitest';
import { acceptEntry, type EntryAcceptanceStore, hasAcceptedEntry, unverifiedEntryKey } from './entryGate';

const HASH_A = `sha256-${'A'.repeat(43)}=`;
const HASH_B = `sha256-${'B'.repeat(43)}=`;
const world = (identity?: Parameters<typeof unverifiedEntryKey>[0]['identity']) => ({
    id: 'w',
    displayName: 'W',
    source: { url: 'https://example.com/w.yaml' },
    identity,
});

function memoryStore(): EntryAcceptanceStore & { raw: Map<string, string> } {
    const raw = new Map<string, string>();
    return { raw, getItem: (k) => raw.get(k) ?? null, setItem: (k, v) => void raw.set(k, v) };
}

describe('unverifiedEntryKey', () => {
    it('署名検証済みなら確認不要', () => {
        expect(
            unverifiedEntryKey(
                world({ status: 'verified', worldId: 'ed25519:k/w', publicKey: 'k'.repeat(43), contentHash: HASH_A }),
            ),
        ).toBeNull();
    });

    it('未署名は確認が要る', () => {
        expect(unverifiedEntryKey(world({ status: 'unsigned', contentHash: HASH_A }))).not.toBeNull();
    });

    it('識別結果が無い（解決できなかった）場合も確認が要る（安全側）', () => {
        expect(unverifiedEntryKey(world(undefined))).not.toBeNull();
    });

    it('一度許可しても内容が変わったら別キー＝もう一度確認', () => {
        const a = unverifiedEntryKey(world({ status: 'unsigned', contentHash: HASH_A }));
        const b = unverifiedEntryKey(world({ status: 'unsigned', contentHash: HASH_B }));
        expect(a).not.toBe(b);
    });
});

describe('acceptEntry / hasAcceptedEntry', () => {
    it('許可したキーだけ記録される', () => {
        const store = memoryStore();
        acceptEntry(store, 'x');
        expect(hasAcceptedEntry(store, 'x')).toBe(true);
        expect(hasAcceptedEntry(store, 'y')).toBe(false);
    });

    it('壊れた保存値は「未許可」として扱う（許可済みに倒さない）', () => {
        const store = memoryStore();
        store.setItem('ubichill:accepted-unverified-worlds', '{"x":true}');
        expect(hasAcceptedEntry(store, 'x')).toBe(false);
        store.setItem('ubichill:accepted-unverified-worlds', 'not json');
        expect(hasAcceptedEntry(store, 'x')).toBe(false);
    });

    it('記録は上限で古いものから捨てる', () => {
        const store = memoryStore();
        for (const i of Array.from({ length: 60 }, (_, n) => n)) acceptEntry(store, `k${i}`);
        expect(hasAcceptedEntry(store, 'k0')).toBe(false);
        expect(hasAcceptedEntry(store, 'k59')).toBe(true);
    });
});
