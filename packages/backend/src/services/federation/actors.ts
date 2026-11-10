/**
 * ほかのサーバーの actor を引く（取りに行って確かめ、キャッシュする）。
 *
 * - 1 時間以内に取ったものはそのまま使い、24 時間以内なら使いながら裏で取り直す（stale-while-revalidate）
 * - 初めての actor は WebFinger を往復して確かめる（`acct:<preferredUsername>@<ホスト>` の self が actor の id と同じ）
 * - Application actor（サーバー自身）は `/ap/actor` だけ。account はホスト（ユーザーのアカウントと取り違えない）
 * - 410 は消えた印を付ける。ドメインの方針が block なら取りに行かない。初めての取得はドメインごとに回数を絞る
 */
import type { RemoteActorInput, RemoteActorRecord } from '@ubichill/db';
import {
    createFetchGuard,
    type DomainPolicy,
    ed25519Multikey,
    FEDERATION_LIMITS,
    FEDERATION_PATHS,
    formatAuthorAccount,
    hostOf,
    isActivityMediaType,
    originForDomain,
    parseAuthorAccount,
    parseFederationUrl,
    readActorDocument,
    webfingerActorUrl,
} from '@ubichill/shared';
import type { FederationIdentity } from './identity';
import type { Transport } from './transport';

export interface ActorDirectoryDeps {
    identity: FederationIdentity;
    allowHttp: boolean;
    repo: {
        findById(id: string): Promise<RemoteActorRecord | undefined>;
        findByAccount(account: string): Promise<RemoteActorRecord | undefined>;
        upsert(actor: RemoteActorInput): Promise<RemoteActorRecord>;
        markDeleted(id: string, at: Date): Promise<void>;
    };
    servers: { touch(domain: string, now: Date): Promise<void> };
    transport: Pick<Transport, 'get'>;
    policyOf(domain: string): DomainPolicy;
    now(): number;
    log?: (message: string) => void;
}

export interface ActorDirectory {
    /** actor を id で引く（必要なら取りに行く）。引けなければ null。消えた actor は deletedAt 付きで返す */
    get(actorId: string, options?: { refresh?: boolean }): Promise<RemoteActorRecord | null>;
    /** `handle@domain` で引く（WebFinger）。このサーバーのアカウントは null */
    byAccount(account: string): Promise<RemoteActorRecord | null>;
}

export function createActorDirectory(deps: ActorDirectoryDeps): ActorDirectory {
    const guard = createFetchGuard({ limit: 30, windowMs: 60_000, now: deps.now });
    const inflight = new Map<string, Promise<RemoteActorRecord | null>>();
    const log = deps.log ?? (() => undefined);

    const webfingerSelf = async (account: string, domain: string): Promise<string | null> => {
        for (const origin of originForDomain(domain, { allowHttp: deps.allowHttp })) {
            const url = `${origin}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${account}`)}`;
            const response = await deps.transport
                .get(url, {
                    signAs: { kind: 'app' },
                    maxBytes: 64 * 1024,
                    accept: 'application/jrd+json',
                    scheme: 'auto',
                })
                .catch(() => null);
            const self = response?.status === 200 ? webfingerActorUrl(response.json) : null;
            if (self) return self;
        }
        return null;
    };

    const fetchActor = async (url: string, known?: RemoteActorRecord): Promise<RemoteActorRecord | null> => {
        const parsed = parseFederationUrl(url, { allowHttp: deps.allowHttp });
        const host = parsed ? hostOf(parsed.href) : null;
        if (!parsed || !host || host === deps.identity.domain) return null;
        if (deps.policyOf(host) === 'block') return null;
        if (!known && !guard.tryAcquire(host)) return null;
        const response = await deps.transport
            .get(parsed.href, {
                signAs: { kind: 'app' },
                maxBytes: FEDERATION_LIMITS.ACTOR_FETCH_BYTES,
                scheme: 'auto',
            })
            .catch(() => null);
        const now = new Date(deps.now());
        if (response?.status === 410) {
            if (known) await deps.repo.markDeleted(known.id, now);
            return known ? { ...known, deletedAt: now } : null;
        }
        if (response?.status !== 200 || !isActivityMediaType(response.contentType)) return known ?? null;
        const read = readActorDocument(response.json, parsed.href, { allowHttp: deps.allowHttp });
        if (!read.ok) {
            log(`actor の文書を読めません (${read.reason}): ${parsed.href}`);
            return known ?? null;
        }
        const doc = read.actor;
        const account = await (async (): Promise<string | null> => {
            if (doc.type === 'Application') return parsed.pathname === FEDERATION_PATHS.appActor ? host : null;
            if (!doc.preferredUsername) return null;
            const claimed = parseAuthorAccount(`${doc.preferredUsername.toLowerCase()}@${host}`);
            if (!claimed) return null;
            const formatted = formatAuthorAccount(claimed);
            // 知っている actor は、アカウントが変わっていなければ往復し直さない
            if (known?.account === formatted) return formatted;
            return (await webfingerSelf(formatted, host)) === doc.id ? formatted : null;
        })();
        if (!account) {
            log(`actor のアカウントを確かめられません: ${parsed.href}`);
            return null;
        }
        const record = await deps.repo.upsert({
            id: doc.id,
            account,
            domain: host,
            type: doc.type,
            name: doc.name,
            summary: doc.summary,
            icon: doc.icon,
            banner: doc.banner,
            profile: {
                fields: doc.fields,
                status: doc.statusMessage,
                languages: doc.spokenLanguages,
                bio: doc.bio,
                emojis: doc.emojis,
            },
            url: doc.url,
            inbox: doc.inbox,
            sharedInbox: doc.sharedInbox,
            keys: [
                ...doc.keys.map((k) => ({ id: k.id, publicKeyMultibase: ed25519Multikey(k.publicKey) })),
                ...doc.rsaKeys,
            ],
            features: doc.features,
            fetchedAt: now,
        });
        await deps.servers.touch(host, now);
        return record;
    };

    /** 同じ actor を同時に取りに行かない。 */
    const once = (key: string, run: () => Promise<RemoteActorRecord | null>) => {
        const running = inflight.get(key);
        if (running) return running;
        const promise = run().finally(() => inflight.delete(key));
        inflight.set(key, promise);
        return promise;
    };

    return {
        async get(actorId, options = {}) {
            if (deps.identity.localUserIdOf(actorId) || actorId === deps.identity.appActorUrl) return null;
            const cached = await deps.repo.findById(actorId);
            if (cached && !options.refresh) {
                const age = deps.now() - cached.fetchedAt.getTime();
                if (cached.deletedAt || age < FEDERATION_LIMITS.ACTOR_FRESH_MS) return cached;
                if (age < FEDERATION_LIMITS.ACTOR_MAX_MS) {
                    void once(actorId, () => fetchActor(actorId, cached)).catch(() => undefined);
                    return cached;
                }
            }
            return once(actorId, () => fetchActor(actorId, cached));
        },

        async byAccount(input) {
            const parsed = parseAuthorAccount(input.toLowerCase());
            if (!parsed || parsed.domain === deps.identity.domain) return null;
            // 連合しないサーバーには WebFinger も送らない
            if (deps.policyOf(parsed.domain) === 'block') return null;
            const account = formatAuthorAccount(parsed);
            const cached = await deps.repo.findByAccount(account);
            if (
                cached &&
                !cached.deletedAt &&
                deps.now() - cached.fetchedAt.getTime() < FEDERATION_LIMITS.ACTOR_FRESH_MS
            ) {
                return cached;
            }
            return once(`acct:${account}`, async () => {
                const url = await webfingerSelf(account, parsed.domain);
                if (!url || hostOf(url) !== parsed.domain) return cached ?? null;
                return fetchActor(url, cached);
            });
        },
    };
}
