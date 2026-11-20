/**
 * ログインの前に、選んだサーバーを見た目で確かめるための公開情報（名前・アイコン・種類）を集める。
 * 種類はログインと同じくメタデータで判定し、名前とアイコンは種類ごとの公開 API で取る（取れなければ null）。
 */
import { type FediverseServerInfo, type FediverseSignInError, parseFediverseServer } from '@ubichill/shared';
import { z } from 'zod';
import type { AuthorizationServer } from './discovery';
import type { FediverseHttp } from './protocol';

export interface LookupDeps {
    http: FediverseHttp;
    discover(host: string): Promise<AuthorizationServer | 'unsupported' | 'unreachable'>;
    serverAllowed(host: string): Promise<boolean>;
    enabled: boolean;
}

export type LookupOutcome = { ok: true; server: FediverseServerInfo } | { ok: false; error: FediverseSignInError };

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
const MisskeyMetaSchema = z.object({ name: z.string().nullish(), iconUrl: z.string().nullish() });

async function serverInfo(http: FediverseHttp, server: AuthorizationServer): Promise<FediverseServerInfo> {
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
        const meta = MisskeyMetaSchema.parse(
            await http.json(`${server.origin}/api/meta`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ detail: false }),
            }),
        );
        return { ...base, name: cleanName(meta.name), iconUrl: httpsUrl(meta.iconUrl) };
    } catch {
        return { ...base, name: null, iconUrl: null };
    }
}

export async function lookupFediverseServer(input: string, deps: LookupDeps): Promise<LookupOutcome> {
    if (!deps.enabled) return { ok: false, error: 'disabled' };
    const parsed = parseFediverseServer(input);
    if (!parsed.ok) return { ok: false, error: 'invalid-server' };
    if (!(await deps.serverAllowed(parsed.host))) return { ok: false, error: 'server-not-allowed' };
    const server = await deps.discover(parsed.host);
    if (server === 'unsupported') return { ok: false, error: 'unsupported-server' };
    if (server === 'unreachable') return { ok: false, error: 'server-unreachable' };
    return { ok: true, server: await serverInfo(deps.http, server) };
}

/** 同じサーバーの問い合わせを短い間だけ覚える（画面を開くたびに相手のサーバーへ送らない）。 */
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
