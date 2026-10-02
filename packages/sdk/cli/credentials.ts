/**
 * CLI・CI の認証情報（`ubichill login` / `ubichill ci create` で得る）。
 *
 * - 手元: `~/.config/ubichill/credentials.json`（0600）。サーバーごとに 1 つ。秘密鍵（PKCS8）と API トークンを含むので
 *   リポジトリに置かない。
 * - CI: env `UBICHILL_CREDENTIALS` に、同じ内容を 1 本の文字列にしたもの（`ubichill ci create` が表示する）。
 * 秘密鍵はサーバーに送らない。トークンは公開環境そのもので、公開環境を取り消すと使えなくなる。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Credential {
    /** サーバーのオリジン（例 https://ubichill.com）。 */
    server: string;
    /** 作者アカウント（handle@domain）。 */
    account: string;
    /** API トークン（ubi_…）。 */
    token: string;
    /** 署名鍵（PKCS8、base64）。 */
    key: string;
    environmentId: string;
}

interface CredentialsFile {
    version: 1;
    /** サーバーを指定しないときに使うサーバー（最後にログインしたもの）。 */
    default?: string;
    servers: Record<string, Credential>;
}

export const CREDENTIALS_ENV = 'UBICHILL_CREDENTIALS';
/** CI 用の文字列の接頭辞（Secret スキャンで見分けやすくするため）。 */
export const CI_CREDENTIALS_PREFIX = 'ubichill_ci_';

export const defaultCredentialsPath = (): string => join(homedir(), '.config', 'ubichill', 'credentials.json');

/** サーバーの指定（URL・ホスト名）をオリジンにそろえる。 */
export function normalizeServer(input: string): string {
    const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const url = new URL(withScheme);
    return url.origin;
}

function isCredential(value: unknown): value is Credential {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return ['server', 'account', 'token', 'key', 'environmentId'].every((k) => typeof v[k] === 'string');
}

/** CI 用の 1 本の文字列にする。 */
export function encodeCiCredentials(credential: Credential): string {
    return `${CI_CREDENTIALS_PREFIX}${Buffer.from(JSON.stringify({ version: 1, ...credential })).toString('base64url')}`;
}

/** CI 用の文字列を読む。形式が違えば理由つきで失敗する（Secret の貼り間違いに気付けるように）。 */
export function decodeCiCredentials(text: string): Credential {
    const trimmed = text.trim();
    if (!trimmed.startsWith(CI_CREDENTIALS_PREFIX)) {
        throw new Error(`${CREDENTIALS_ENV} の形式が違います（${CI_CREDENTIALS_PREFIX} で始まる文字列を設定してください）`);
    }
    const json = (() => {
        try {
            return JSON.parse(Buffer.from(trimmed.slice(CI_CREDENTIALS_PREFIX.length), 'base64url').toString('utf-8')) as unknown;
        } catch {
            return undefined;
        }
    })();
    if (!isCredential(json)) throw new Error(`${CREDENTIALS_ENV} を読めません（ubichill ci create で作り直してください）`);
    const { server, account, token, key, environmentId } = json;
    return { server: normalizeServer(server), account, token, key, environmentId };
}

function readFile(path: string): CredentialsFile {
    if (!existsSync(path)) return { version: 1, servers: {} };
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<CredentialsFile>;
    const servers = Object.fromEntries(
        Object.entries(parsed.servers ?? {}).filter(([, v]) => isCredential(v)),
    ) as Record<string, Credential>;
    return { version: 1, default: parsed.default, servers };
}

function writeFile(path: string, file: CredentialsFile): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    chmodSync(path, 0o600);
}

/**
 * 使う認証情報を決める。env `UBICHILL_CREDENTIALS`（CI）があればそれ、無ければ手元のファイルの
 * 指定したサーバー（指定が無ければ最後にログインしたサーバー）。
 */
export function resolveCredential(options: {
    server?: string;
    env?: NodeJS.ProcessEnv;
    path?: string;
}): Credential | undefined {
    const env = options.env ?? process.env;
    const fromEnv = env[CREDENTIALS_ENV];
    if (fromEnv) {
        const credential = decodeCiCredentials(fromEnv);
        if (options.server && normalizeServer(options.server) !== credential.server) {
            throw new Error(`${CREDENTIALS_ENV} は ${credential.server} の認証情報です（--server=${options.server} と違います）`);
        }
        return credential;
    }
    const file = readFile(options.path ?? defaultCredentialsPath());
    const server = options.server ? normalizeServer(options.server) : file.default;
    return server ? file.servers[server] : undefined;
}

export function saveCredential(credential: Credential, path = defaultCredentialsPath()): void {
    const file = readFile(path);
    writeFile(path, { version: 1, default: credential.server, servers: { ...file.servers, [credential.server]: credential } });
}

export function removeCredential(server: string, path = defaultCredentialsPath()): void {
    const file = readFile(path);
    const { [server]: _removed, ...rest } = file.servers;
    const nextDefault = file.default === server ? Object.keys(rest)[0] : file.default;
    writeFile(path, { version: 1, ...(nextDefault ? { default: nextDefault } : {}), servers: rest });
}
