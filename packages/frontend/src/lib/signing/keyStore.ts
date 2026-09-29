import { generateSigningKeyPkcs8, importSigningKeyPair, signingKeyFrom } from '@ubichill/loader';
import type { WorldSigningKey } from '@ubichill/shared';

/**
 * このブラウザの公開環境の署名鍵（IndexedDB）。
 *
 * サーバーは鍵を一切持たない。秘密鍵は取り出し不可の CryptoKey として保存する。バックアップは取らない:
 * 別の端末は自分の公開環境（鍵）を持ち、このブラウザのデータが消えたら次の公開で新しい鍵が自動で登録される。
 * CLI の鍵ファイル（`ubichill keygen`、PKCS8）は上級者向けに読み込める。
 */
const DB_NAME = 'ubichill-signing';
const STORE = 'keys';
const RECORD_KEY = 'author';

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
const snapshot: { publicKey: string | null; loaded: boolean } = { publicKey: null, loaded: false };

function publish(publicKey: string | null): void {
    snapshot.publicKey = publicKey;
    snapshot.loaded = true;
    for (const l of listeners) l();
}

export function subscribeSigningKey(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** 保存済み鍵の公開鍵（未ロード時は undefined、鍵なしは null）。 */
export function signingPublicKeySnapshot(): string | null | undefined {
    return snapshot.loaded ? snapshot.publicKey : undefined;
}

export async function loadSigningKey(): Promise<WorldSigningKey | null> {
    const stored = await withStore<StoredKey | undefined>('readonly', (s) => s.get(RECORD_KEY));
    publish(stored?.publicKey ?? null);
    return stored ? signingKeyFrom(stored.publicKey, stored.privateKey) : null;
}

async function store(pkcs8: string): Promise<string> {
    const pair = await importSigningKeyPair(pkcs8);
    await withStore('readwrite', (s) => s.put(pair satisfies StoredKey, RECORD_KEY));
    publish(pair.publicKey);
    return pair.publicKey;
}

/** 新しい鍵を作って保存する（秘密鍵は取り出し不可のまま保存し、外に出さない）。 */
export async function createSigningKey(): Promise<WorldSigningKey> {
    await store(await generateSigningKeyPkcs8());
    const key = await loadSigningKey();
    if (!key) throw new Error('鍵を保存できませんでした');
    return key;
}

/** `ubichill keygen` の鍵ファイル（PKCS8）の中身から取り込む（上級者向け）。 */
export function importSigningKeyFile(pkcs8: string): Promise<string> {
    return store(pkcs8);
}

export async function removeSigningKey(): Promise<void> {
    await withStore('readwrite', (s) => s.delete(RECORD_KEY));
    publish(null);
}
