/**
 * サーバーの秘密の一覧（better-auth の secretConfig）。DB に長く残す値（二段階認証の鍵など）は、どの秘密で作ったかを
 * 指紋で残し、秘密を入れ替えても古い秘密が BETTER_AUTH_SECRETS に残っている間は読めるようにする。
 * 新しく作る値はいつも今の秘密（BETTER_AUTH_SECRETS の先頭、無ければ BETTER_AUTH_SECRET）で作る。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ServerKey {
    /** 秘密の指紋（秘密そのものは出さない） */
    id: string;
    secret: string;
}

export interface ServerKeys {
    current: ServerKey;
    find(id: string): ServerKey | undefined;
}

/** better-auth の secretConfig（文字列か、版ごとの秘密の一覧） */
export type SecretConfigLike =
    | string
    | { keys: ReadonlyMap<number, string>; currentVersion: number; legacySecret?: string };

const keyOf = (secret: string): ServerKey => ({
    id: createHmac('sha256', secret).update('ubichill/server-key-id').digest('base64url').slice(0, 12),
    secret,
});

export function serverKeysFrom(config: SecretConfigLike): ServerKeys {
    const currentSecret = typeof config === 'string' ? config : config.keys.get(config.currentVersion);
    if (!currentSecret) throw new Error('今のサーバーの秘密がありません');
    const all = typeof config === 'string' ? [config] : [currentSecret, ...config.keys.values(), config.legacySecret];
    const keys = new Map(
        all.filter((s): s is string => typeof s === 'string' && s.length > 0).map((s) => [keyOf(s).id, keyOf(s)]),
    );
    return { current: keyOf(currentSecret), find: (id) => keys.get(id) };
}

/** 今の秘密で HMAC を取り、どの秘密かの指紋を前に付ける（`<指紋>.<HMAC>`）。 */
export function keyedHmac(keys: ServerKeys, message: string): string {
    return `${keys.current.id}.${hmacWith(keys.current, message)}`;
}

/** `keyedHmac` で作った値と合うか（作った秘密が今の一覧に無ければ合わない）。 */
export function matchesKeyedHmac(keys: ServerKeys, message: string, stored: string): boolean {
    const [id, mac, ...rest] = stored.split('.');
    const key = id ? keys.find(id) : undefined;
    if (!key || !mac || rest.length > 0) return false;
    const expected = Buffer.from(hmacWith(key, message));
    const presented = Buffer.from(mac);
    return expected.length === presented.length && timingSafeEqual(expected, presented);
}

const hmacWith = (key: ServerKey, message: string) =>
    createHmac('sha256', key.secret).update(message).digest('base64url');
