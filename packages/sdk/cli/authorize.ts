/**
 * `ubichill login` / `ubichill ci create` の認可の手順（手順は docs/design/author-publishing.md §9）。
 * ネットワーク・ブラウザ・ループバックの待ち受け・時計は注入する（テストで差し替えられるように）。
 *
 * - ループバック（既定、RFC 8252）: 127.0.0.1 の一時ポートで待ち、ブラウザの承認後のリダイレクトで認可コードを受け取る。
 *   認可コードは PKCE（S256）で要求に結び付けるので、横取りされても引き換えられない。
 * - デバイス認可（--device、RFC 8628）: 表示したコードを別の端末のブラウザで承認し、CLI はポーリングで待つ。
 * どちらも、引き換え時に要求の鍵で署名して鍵の所有を証明する。秘密鍵はサーバーに送らない。
 */
import { createHash, randomBytes } from 'node:crypto';
import { type CliAuthKind, cliAuthProofMessage, type WorldSigningKey } from '@ubichill/shared';
import type { Credential } from './credentials.ts';

export interface HttpResponse {
    status: number;
    body: Record<string, unknown>;
}

export interface LoopbackServer {
    redirectUri: string;
    /** 承認後のリダイレクトで届く認可コードと state を待つ。 */
    waitForCallback: () => Promise<{ code: string; state: string | undefined }>;
    close: () => void;
}

export interface AuthorizeDeps {
    post: (url: string, body: unknown) => Promise<HttpResponse>;
    generateKey: () => Promise<{ pkcs8: string; key: WorldSigningKey }>;
    openBrowser: (url: string) => Promise<boolean>;
    startLoopback: () => Promise<LoopbackServer>;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    log: (message: string) => void;
    random?: (bytes: number) => string;
}

export interface AuthorizeOptions {
    server: string;
    kind: CliAuthKind;
    name: string;
    flow: 'loopback' | 'device';
}

const base64UrlRandom = (bytes: number) => randomBytes(bytes).toString('base64url');
const sha256Base64Url = (value: string) => createHash('sha256').update(value).digest('base64url');

function errorOf(res: HttpResponse, fallback: string): Error {
    const message = typeof res.body.error === 'string' ? res.body.error : `${fallback}（HTTP ${res.status}）`;
    return new Error(message);
}

function credentialFrom(res: HttpResponse, pkcs8: string, server: string): Credential {
    const { token, account, environment } = res.body as {
        token?: unknown;
        account?: unknown;
        environment?: { id?: unknown };
    };
    if (typeof token !== 'string' || typeof account !== 'string' || typeof environment?.id !== 'string') {
        throw new Error('サーバーの応答を読めません');
    }
    return { server, account, token, key: pkcs8, environmentId: environment.id };
}

/** 認可して、公開環境の認証情報（鍵とトークン）を得る。 */
export async function authorize(deps: AuthorizeDeps, options: AuthorizeOptions): Promise<Credential> {
    const random = deps.random ?? base64UrlRandom;
    const { pkcs8, key } = await deps.generateKey();
    // 要求 ID は要求を作った後に決まる。引き換えのたびに、その要求の鍵の所有を署名で示す
    const requestIdOf = { value: '' };
    const proof = () => key.sign(cliAuthProofMessage(requestIdOf.value));
    const api = (path: string) => `${options.server}${path}`;

    if (options.flow === 'loopback') {
        const loopback = await deps.startLoopback();
        try {
            const verifier = random(32);
            const state = random(16);
            const created = await deps.post(api('/api/v1/cli-auth/requests'), {
                kind: options.kind,
                name: options.name,
                publicKey: key.publicKey,
                redirectUri: loopback.redirectUri,
                codeChallenge: sha256Base64Url(verifier),
            });
            if (created.status !== 201) throw errorOf(created, '認可の要求を作れませんでした');
            requestIdOf.value = String(created.body.requestId);
            const url = `${String(created.body.approveUrl)}&state=${encodeURIComponent(state)}`;
            deps.log(`ブラウザで承認してください: ${url}`);
            if (!(await deps.openBrowser(url))) deps.log('（ブラウザを開けませんでした。上の URL を開いてください）');
            const callback = await loopback.waitForCallback();
            // 別の要求のリダイレクトを受け取らない（CSRF 対策の state、RFC 8252 §8.9）
            if (callback.state !== state) throw new Error('承認の応答が一致しません（state が違います）。もう一度実行してください');
            const exchanged = await deps.post(api('/api/v1/cli-auth/token'), {
                requestId: requestIdOf.value,
                code: callback.code,
                codeVerifier: verifier,
                signature: await proof(),
            });
            if (exchanged.status !== 200) throw errorOf(exchanged, '認証情報を受け取れませんでした');
            return credentialFrom(exchanged, pkcs8, options.server);
        } finally {
            loopback.close();
        }
    }

    const created = await deps.post(api('/api/v1/cli-auth/requests'), {
        kind: options.kind,
        name: options.name,
        publicKey: key.publicKey,
    });
    if (created.status !== 201) throw errorOf(created, '認可の要求を作れませんでした');
    requestIdOf.value = String(created.body.requestId);
    const deviceCode = String(created.body.deviceCode);
    const intervalMs = Number(created.body.interval ?? 3) * 1000;
    const deadline = deps.now() + Number(created.body.expiresIn ?? 600) * 1000;
    deps.log(`別の端末のブラウザで ${String(created.body.approveUrl)} を開き、コード ${String(created.body.userCode)} を確かめて承認してください`);
    await deps.openBrowser(String(created.body.approveUrl));

    const poll = async (): Promise<Credential> => {
        if (deps.now() > deadline) throw new Error('承認されないまま期限が切れました。もう一度実行してください');
        const res = await deps.post(api('/api/v1/cli-auth/token'), {
            requestId: requestIdOf.value,
            deviceCode,
            signature: await proof(),
        });
        if (res.status === 428) {
            await deps.sleep(intervalMs);
            return poll();
        }
        if (res.status !== 200) throw errorOf(res, '認証情報を受け取れませんでした');
        return credentialFrom(res, pkcs8, options.server);
    };
    return poll();
}
