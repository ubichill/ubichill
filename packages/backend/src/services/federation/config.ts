/**
 * 連合の設定（env から）。本番は FEDERATION_KEY_SEED が要る（無ければ連合しない）。開発では BETTER_AUTH_SECRET から
 * 導いた種を使い、起動し直しても鍵が変わらないようにする（ほかのサーバーのキャッシュが無駄に失敗しない）。
 */
import { hkdfSync } from 'node:crypto';
import { ENV_KEYS, SERVER_CONFIG } from '@ubichill/shared';

export interface FederationConfig {
    /** 連合するか（種が無い本番・FEDERATION_ENABLED=false なら false） */
    enabled: boolean;
    /** このサーバーのオリジン（PUBLIC_BASE_URL） */
    origin: string;
    /** このサーバーのドメイン（ホスト。開発ではポート付き） */
    domain: string;
    /** http の相手を受けるか（開発で localhost の 2 台を試すときだけ。本番では受けない） */
    allowHttp: boolean;
    /** actor の鍵の種（HKDF の IKM） */
    seed: Uint8Array | null;
    /** 種をどこから得たか（起動時のログ用） */
    seedSource: 'configured' | 'derived' | 'none';
    /** 鍵の世代（FEDERATION_KEY_GENERATION。既定 1）。種を差し替えるときに 1 上げる */
    keyGeneration: number;
    /** 鍵の移行の間だけ: 前の世代の種（FEDERATION_KEY_SEED_PREVIOUS） */
    previousSeed: Uint8Array | null;
}

/** base64 か 16 進の 32 バイト以上。読めなければ null。 */
export function parseSeed(text: string): Uint8Array | null {
    const trimmed = text.trim();
    const bytes = /^[0-9a-fA-F]+$/.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
    return bytes.length >= 32 ? Uint8Array.from(bytes) : null;
}

export function federationConfigFromEnv(env: NodeJS.ProcessEnv): FederationConfig {
    const base = new URL(env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL);
    const production = env.NODE_ENV === 'production';
    const configured = env.FEDERATION_KEY_SEED ? parseSeed(env.FEDERATION_KEY_SEED) : null;
    if (env.FEDERATION_KEY_SEED && !configured)
        throw new Error('FEDERATION_KEY_SEED は 32 バイト以上の base64 か 16 進です');
    const derived =
        !configured && !production && env.BETTER_AUTH_SECRET
            ? Uint8Array.from(
                  Buffer.from(
                      hkdfSync('sha256', env.BETTER_AUTH_SECRET, 'ubichill federation dev seed', base.origin, 32),
                  ),
              )
            : null;
    const seed = configured ?? derived;
    const keyGeneration = env.FEDERATION_KEY_GENERATION ? Number(env.FEDERATION_KEY_GENERATION) : 1;
    if (!Number.isInteger(keyGeneration) || keyGeneration < 1)
        throw new Error('FEDERATION_KEY_GENERATION は 1 以上の整数です');
    const previousSeed = env.FEDERATION_KEY_SEED_PREVIOUS ? parseSeed(env.FEDERATION_KEY_SEED_PREVIOUS) : null;
    if (env.FEDERATION_KEY_SEED_PREVIOUS && !previousSeed)
        throw new Error('FEDERATION_KEY_SEED_PREVIOUS は 32 バイト以上の base64 か 16 進です');
    if (previousSeed && keyGeneration < 2)
        throw new Error(
            'FEDERATION_KEY_SEED_PREVIOUS を置くときは、FEDERATION_KEY_GENERATION を 2 以上に上げてください',
        );
    return {
        enabled: seed !== null && env.FEDERATION_ENABLED !== 'false',
        origin: base.origin,
        domain: base.host.toLowerCase(),
        allowHttp: !production && env.FEDERATION_ALLOW_HTTP === 'true',
        seed,
        seedSource: configured ? 'configured' : derived ? 'derived' : 'none',
        keyGeneration,
        previousSeed,
    };
}
