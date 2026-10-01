import { generateSigningKeyPkcs8, importSigningKeyPair, signingKeyFrom } from '@ubichill/loader';
import type { WorldSigningKey } from '@ubichill/shared';

/**
 * このブラウザの公開環境の署名鍵（IndexedDB）。
 *
 * サーバーは鍵を一切持たない。秘密鍵は取り出し不可の CryptoKey としてアカウント（userId）ごとに保存する
 * （同じブラウザで別のアカウントに切り替えても、互いの鍵を使い回さない）。バックアップは取らない:
 * 別の端末は自分の公開環境（鍵）を持ち、このブラウザのデータが消えたら次の公開で新しい鍵が自動で登録される。
 * CLI の鍵ファイル（`ubichill keygen`、PKCS8）は上級者向けに読み込める。
 */
const DB_NAME = 'ubichill-signing';
const STORE = 'keys';

interface StoredKey {
    publicKey: string;
    privateKey: CryptoKey;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const req = run(db.transaction(STORE, mode).objectStore(STORE));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } finally {
        db.close();
    }
}

const listeners = new Set<() => void>();
/** アカウントごとの公開鍵（未ロードは undefined、鍵なしは null）。 */
const snapshots = new Map<string, string | null>();

function publish(userId: string, publicKey: string | null): void {
    snapshots.set(userId, publicKey);
    for (const l of listeners) l();
}

export function subscribeSigningKey(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** 保存済み鍵の公開鍵（未ロード時は undefined、鍵なしは null）。 */
export function signingPublicKeySnapshot(userId: string): string | null | undefined {
    return snapshots.get(userId);
}

export async function loadSigningKey(userId: string): Promise<WorldSigningKey | null> {
    const stored = await withStore<StoredKey | undefined>('readonly', (s) => s.get(userId));
    publish(userId, stored?.publicKey ?? null);
    return stored ? signingKeyFrom(stored.publicKey, stored.privateKey) : null;
}

async function store(userId: string, pkcs8: string): Promise<string> {
    const pair = await importSigningKeyPair(pkcs8);
    await withStore('readwrite', (s) => s.put(pair satisfies StoredKey, userId));
    publish(userId, pair.publicKey);
    return pair.publicKey;
}

/** 新しい鍵を作って保存する（秘密鍵は取り出し不可のまま保存し、外に出さない）。 */
export async function createSigningKey(userId: string): Promise<WorldSigningKey> {
    await store(userId, await generateSigningKeyPkcs8());
    const key = await loadSigningKey(userId);
    if (!key) throw new Error('鍵を保存できませんでした');
    return key;
}

/** `ubichill keygen` の鍵ファイル（PKCS8）の中身から取り込む（上級者向け）。 */
export function importSigningKeyFile(userId: string, pkcs8: string): Promise<string> {
    return store(userId, pkcs8);
}

export async function removeSigningKey(userId: string): Promise<void> {
    await withStore('readwrite', (s) => s.delete(userId));
    publish(userId, null);
}
