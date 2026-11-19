/**
 * ログインの前に、入力したユーザー ID のサーバーとアカウントを見た目で確かめるための公開情報を集める。
 * Ubichill に登録済みかは返さない（外部アカウントと Ubichill のアカウントの結び付きを、認証の前に明かさない）。
 *
 * 1. `@you@example.com` は WebFinger で actor を引き、actor のホストを認証サーバーにする（ドメインの委任に対応）
 * 2. 認証サーバーのメタデータで種類を判定する（discovery.ts と同じ）
 * 3. 種類ごとの公開 API でサーバーの名前・アイコンと、アカウントの表示名・アバターを取る（取れなければ null）
 */
import {
    type FediversePreview,
    type FediverseSignInError,
    parseFediverseAccount,
    webfingerActorUrl,
} from '@ubichill/shared';
import { z } from 'zod';
import type { AuthorizationServer } from './discovery';
import { type FediverseHttp, HttpStatusError } from './protocol';

export interface LookupDeps {
    http: FediverseHttp;
    discover(host: string): Promise<AuthorizationServer | 'unsupported' | 'unreachable'>;
    serverAllowed(host: string): Promise<boolean>;
    enabled: boolean;
}

export type LookupOutcome = { ok: true; preview: FediversePreview } | { ok: false; error: FediverseSignInError };

const httpsUrl = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const url = URL.parse(value);
    return url?.protocol === 'https:' ? url.href : null;
};

/** カスタム絵文字の `:name:` と制御文字を外す（画面ではそのまま文字として出す）。 */
const cleanName = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const cleaned = Array.from(value.replace(/:[a-zA-Z0-9_]+:/g, ''))
        .filter((ch) => (ch.codePointAt(0) ?? 0) >= 0x20)
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
    return cleaned || null;
};

const MastodonInstanceSchema = z.object({
    title: z.string().nullish(),
    icon: z.array(z.object({ src: z.string(), size: z.string().optional() })).nullish(),
    thumbnail: z.object({ url: z.string() }).nullish(),
});
const MastodonAccountSchema = z.object({
    username: z.string(),
    display_name: z.string().nullish(),
    avatar: z.string().nullish(),
});
const MisskeyMetaSchema = z.object({ name: z.string().nullish(), iconUrl: z.string().nullish() });
const MisskeyUserSchema = z.object({
    username: z.string(),
    name: z.string().nullish(),
    avatarUrl: z.string().nullish(),
});

const jsonBody = (body: unknown) => ({
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
});

async function serverInfo(http: FediverseHttp, server: AuthorizationServer): Promise<FediversePreview['server']> {
    const base = { host: server.host, software: server.software };
    try {
        if (server.software === 'mastodon') {
            const info = MastodonInstanceSchema.parse(
                await http.json(`${server.origin}/api/v2/instance`, {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                }),
            );
            const icon = [...(info.icon ?? [])].sort(
                (a, b) => parseInt(b.size ?? '0', 10) - parseInt(a.size ?? '0', 10),
            )[0];
            return { ...base, name: cleanName(info.title), iconUrl: httpsUrl(icon?.src ?? info.thumbnail?.url) };
        }
        const meta = MisskeyMetaSchema.parse(await http.json(`${server.origin}/api/meta`, jsonBody({ detail: false })));
        return { ...base, name: cleanName(meta.name), iconUrl: httpsUrl(meta.iconUrl) };
    } catch {
        return { ...base, name: null, iconUrl: null };
    }
}

async function accountInfo(
    http: FediverseHttp,
    server: AuthorizationServer,
    username: string,
): Promise<NonNullable<FediversePreview['account']>> {
    try {
        if (server.software === 'mastodon') {
            const account = MastodonAccountSchema.parse(
                await http.json(`${server.origin}/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`, {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                }),
            );
            return {
                username: account.username,
                displayName: cleanName(account.display_name),
                avatarUrl: httpsUrl(account.avatar),
            };
        }
        const user = MisskeyUserSchema.parse(
            await http.json(`${server.origin}/api/users/show`, jsonBody({ username, host: null })),
        );
        return { username: user.username, displayName: cleanName(user.name), avatarUrl: httpsUrl(user.avatarUrl) };
    } catch {
        // 公開 API を閉じているサーバーもある。WebFinger で存在は確かめたので、名前だけで続ける
        return { username, displayName: null, avatarUrl: null };
    }
}

/** WebFinger で actor のホストを引く。null はアカウントが無い。 */
async function actorHostOf(
    http: FediverseHttp,
    username: string,
    host: string,
): Promise<string | null | 'unreachable'> {
    try {
        const jrd = await http.json(
            `https://${host}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${username}@${host}`)}`,
            { method: 'GET', headers: { Accept: 'application/jrd+json, application/json' } },
        );
        const actor = httpsUrl(webfingerActorUrl(jrd));
        return actor ? new URL(actor).host : null;
    } catch (error) {
        return error instanceof HttpStatusError && error.status >= 300 && error.status < 500 ? null : 'unreachable';
    }
}

export async function lookupFediverse(input: string, deps: LookupDeps): Promise<LookupOutcome> {
    if (!deps.enabled) return { ok: false, error: 'disabled' };
    const parsed = parseFediverseAccount(input);
    if (!parsed.ok) return { ok: false, error: 'unsupported-server' };
    const host = parsed.username ? await actorHostOf(deps.http, parsed.username, parsed.host) : parsed.host;
    if (host === 'unreachable') return { ok: false, error: 'server-unreachable' };
    if (host === null) return { ok: false, error: 'account-not-found' };
    if (!(await deps.serverAllowed(host))) return { ok: false, error: 'server-not-allowed' };
    const server = await deps.discover(host);
    if (server === 'unsupported') return { ok: false, error: 'unsupported-server' };
    if (server === 'unreachable') return { ok: false, error: 'server-unreachable' };
    const [info, account] = await Promise.all([
        serverInfo(deps.http, server),
        parsed.username ? accountInfo(deps.http, server, parsed.username) : Promise.resolve(null),
    ]);
    return { ok: true, preview: { server: info, account } };
}

/** 同じ入力の問い合わせを短い間だけ覚える（入力のたびに相手のサーバーへ何度も送らない）。 */
export function createLookupCache(options: { ttlMs: number; max: number; now: () => number }) {
    const entries = new Map<string, { at: number; value: LookupOutcome }>();
    return async (key: string, load: () => Promise<LookupOutcome>): Promise<LookupOutcome> => {
        const normalized = key.trim().toLowerCase();
        const hit = entries.get(normalized);
        if (hit && options.now() - hit.at < options.ttlMs) return hit.value;
        const value = await load();
        // 接続できなかった結果は覚えない（すぐ直ることがある）
        if (value.ok || value.error !== 'server-unreachable') {
            entries.delete(normalized);
            entries.set(normalized, { at: options.now(), value });
            if (entries.size > options.max) entries.delete(entries.keys().next().value ?? '');
        }
        return value;
    };
}
