/**
 * 認証と公開のサブコマンド（Node の実体）。手順は authorize.ts / publish.ts、保存は credentials.ts。
 *
 *   ubichill login     [--server=<url>] [--device] [--name=<表示名>] [--no-browser]
 *   ubichill logout    [--server=<url>]
 *   ubichill whoami    [--server=<url>]
 *   ubichill ci create --name=<表示名> [--server=<url>] [--device] [--no-browser]
 *   ubichill publish   <world.yaml>... [--server=<url>] [--out=<dir>] [--no-install] [--mods-dir=<dir>] [--base-url=<url>]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { generateSigningKeyPkcs8, importSigningKey, webWorldCrypto } from '@ubichill/loader';
import { runInstall } from '@ubichill/loader/install-dependencies';
import yaml from 'yaml';
import { type AuthorizeDeps, authorize, type HttpResponse, type LoopbackServer } from './authorize.ts';
import {
    type Credential,
    CREDENTIALS_ENV,
    encodeCiCredentials,
    normalizeServer,
    removeCredential,
    resolveCredential,
    saveCredential,
} from './credentials.ts';
import { publish } from './publish.ts';

export const DEFAULT_SERVER = 'https://ubichill.com';

const argValue = (argv: string[], name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function requestJson(
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    body?: unknown,
    token?: string,
): Promise<HttpResponse> {
    const res = await fetch(url, {
        method,
        headers: {
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: parsed };
}

/** ブラウザを開く（開けなければ false。URL は常に表示するので、開けなくても続けられる）。 */
function openBrowser(url: string): Promise<boolean> {
    const command =
        process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
    return new Promise((resolve) => {
        const child = spawn(command[0] as string, command.slice(1), { stdio: 'ignore', detached: true });
        child.on('error', () => resolve(false));
        child.on('spawn', () => {
            child.unref();
            resolve(true);
        });
    });
}

/** 127.0.0.1 の一時ポートで、承認後のリダイレクト（RFC 8252）を待つ。 */
function startLoopback(): Promise<LoopbackServer> {
    return new Promise((resolve, reject) => {
        const waiters: Array<(value: { code: string; state: string | undefined }) => void> = [];
        const server = createServer((req, res) => {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            const code = url.searchParams.get('code');
            if (url.pathname !== '/callback' || !code) {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<!doctype html><meta charset="utf-8"><title>ubichill</title><p>承認しました。CLI に戻ってください。このページは閉じてかまいません。</p>');
            for (const waiter of waiters.splice(0)) waiter({ code, state: url.searchParams.get('state') ?? undefined });
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('待ち受けのポートを開けませんでした'));
                return;
            }
            resolve({
                redirectUri: `http://127.0.0.1:${address.port}/callback`,
                waitForCallback: () => new Promise((done) => waiters.push(done)),
                close: () => server.close(),
            });
        });
    });
}

function authorizeDeps(argv: string[]): AuthorizeDeps {
    const noBrowser = argv.includes('--no-browser') || !!process.env.CI;
    return {
        post: (url, body) => requestJson('POST', url, body),
        generateKey: async () => {
            const pkcs8 = await generateSigningKeyPkcs8();
            return { pkcs8, key: await importSigningKey(pkcs8) };
        },
        openBrowser: (url) => (noBrowser ? Promise.resolve(false) : openBrowser(url)),
        startLoopback,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        now: Date.now,
        log: (message) => console.log(message),
    };
}

const serverOf = (argv: string[]) => normalizeServer(argValue(argv, 'server') ?? DEFAULT_SERVER);

export async function runLogin(argv: string[]): Promise<void> {
    const server = serverOf(argv);
    const previous = resolveCredential({ server, env: {} });
    const credential = await authorize(authorizeDeps(argv), {
        server,
        kind: 'cli',
        name: argValue(argv, 'name') ?? `ubichill CLI on ${hostname()}`,
        flow: argv.includes('--device') ? 'device' : 'loopback',
    });
    saveCredential(credential);
    // 以前の認証情報の公開環境は取り消す（使われない鍵を残さない）
    if (previous && previous.environmentId !== credential.environmentId) {
        await requestJson('POST', `${server}/api/v1/cli-auth/logout`, {}, previous.token).catch(() => undefined);
    }
    console.log(`✅ @${credential.account} としてログインしました（${server}）。ubichill publish で公開できます`);
}

export async function runCiCreate(argv: string[]): Promise<void> {
    const name = argValue(argv, 'name');
    if (!name) throw new Error('--name=<表示名>（例: "GitHub Actions: owner/repo"）を指定してください');
    const credential = await authorize(authorizeDeps(argv), {
        server: serverOf(argv),
        kind: 'ci',
        name,
        flow: argv.includes('--device') ? 'device' : 'loopback',
    });
    console.log(`\n✅ CI 用の公開環境「${name}」を作りました（@${credential.account}）。`);
    console.log(`次の値を CI の Secret（環境変数 ${CREDENTIALS_ENV}）に設定してください。この場限りの表示で、どこにも保存しません。\n`);
    console.log(encodeCiCredentials(credential));
    console.log('\n漏れたら、設定の「公開」（公開できるブラウザ・CLI・CI）で取り消し、ubichill ci create で作り直してください。');
}

function requireCredential(argv: string[]): Credential {
    const credential = resolveCredential({ server: argValue(argv, 'server') });
    if (!credential) throw new Error(`ログインしていません。ubichill login（CI は env ${CREDENTIALS_ENV}）で認証してください`);
    return credential;
}

export async function runWhoami(argv: string[]): Promise<void> {
    const credential = requireCredential(argv);
    const me = await requestJson('GET', `${credential.server}/api/v1/users/me`, undefined, credential.token);
    if (me.status !== 200) {
        throw new Error('認証情報が使えません（公開環境が取り消された可能性があります）。ubichill login し直してください');
    }
    console.log(`@${credential.account}（${credential.server}、公開環境 ${credential.environmentId}）`);
}

export async function runLogout(argv: string[]): Promise<void> {
    if (process.env[CREDENTIALS_ENV]) throw new Error(`${CREDENTIALS_ENV} の認証情報は CI の Secret から消し、画面で取り消してください`);
    const credential = requireCredential(argv);
    await requestJson('POST', `${credential.server}/api/v1/cli-auth/logout`, {}, credential.token).catch(() => undefined);
    removeCredential(credential.server);
    console.log(`この端末の公開環境を取り消し、認証情報を消しました（${credential.server}）`);
}

/** `ubichill publish <world.yaml>...`。CI では `worlds/*.yaml --out=<dir>` のように複数まとめて署名・書き出しできる。 */
export async function runPublish(argv: string[]): Promise<void> {
    const worldPaths = argv.filter((a) => !a.startsWith('--'));
    if (worldPaths.length === 0) {
        throw new Error('usage: ubichill publish <world.yaml>... [--server=<url>] [--out=<dir>] [--no-install]');
    }
    const credential = requireCredential(argv);
    const key = await importSigningKey(credential.key);
    const deps = {
        fs: {
            readText: (path: string) => (existsSync(path) ? readFileSync(path, 'utf-8') : undefined),
            writeText: (path: string, text: string) => writeFileSync(path, text, 'utf-8'),
            mkdir: (path: string) => mkdirSync(path, { recursive: true }),
        },
        request: (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) =>
            requestJson(method, `${credential.server}${path}`, body, credential.token),
        key,
        crypto: webWorldCrypto,
        parseYaml: (text: string) => yaml.parse(text) as unknown,
        log: (message: string) => console.log(message),
    };
    for (const worldPath of worldPaths) {
        if (!argv.includes('--no-install')) {
            // mod を固定する（install と同じ）。署名は下でログインしたアカウントで行うので、ここでは署名しない
            const passthrough = argv.filter((a) => a.startsWith('--mods-dir=') || a.startsWith('--base-url='));
            await runInstall([worldPath, '--no-sign', ...passthrough]);
            if (process.exitCode) throw new Error(`${worldPath}: mod を固定できなかったので公開しません`);
        }
        await publish(deps, { worldPath, credential, outDir: argValue(argv, 'out') });
    }
}
