/**
 * 作者アカウント（handle@domain）→ 公開環境の鍵一覧・表示名の解決（DB・ネットワーク非依存）。
 *
 * - 自サーバーの domain（PUBLIC_BASE_URL のホスト）なら注入された `findLocalAccount`（DB）で引く。
 * - 他の domain は WebFinger（`/.well-known/webfinger?resource=acct:handle@domain`）の links から
 *   鍵一覧の文書を辿る。取得結果は保存し（author_bindings）、期限で取り直す:
 *   T_fresh 以内はそのまま、超えたら保存した結果で即答して裏で取り直す。
 *   取り消しは鍵一覧に revokedAt として載るので、作者のサーバーが動いていれば T_fresh 以内に届く。
 *   取り直せない（作者のサーバーが止まっている）間は、最後に確認できた結果を T_max まで使い続け、確認時刻を返して
 *   「確認が古い」と表示させる（小さな自前サーバーの短い障害で作者のワールドが一覧から消えないように）。
 * - 他サーバーへの取得は、初めての作者・知らない鍵（discover）だけドメイン単位で上限をかける。保存済みの作者の
 *   取り直し（refresh）は作者ごとに T_fresh に 1 回で数が限られるので上限をかけない（攻撃者が上限を使い切って、
 *   既知の作者の取り直しを止められないように）。
 * 実体の組み立て（DB・safeFetch）は authorKeyStore.ts。
 */
import {
    AUTHOR_CHECK_STALE_MS,
    type AuthorKeyCheck,
    DISPLAY_NAME_WEBFINGER_PROPERTY,
    DisplayNameSchema,
    ENV_KEYS,
    formatAuthorAccount,
    parseAuthorAccount,
    parseSigningKeyList,
    SERVER_CONFIG,
    SIGNING_KEYS_WEBFINGER_REL,
    type SigningKeyEntry,
    signingKeyStatus,
} from '@ubichill/shared';
import { setBounded } from '../utils/boundedMap';

/** このサーバーが発行する作者アカウントの domain（ホスト名、開発時はポート付き）。 */
export function selfDomain(): string {
    const base = process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL;
    return new URL(base).host.toLowerCase();
}

export function selfAccount(handle: string): string {
    return formatAuthorAccount({ handle, domain: selfDomain() });
}

/** アカウントが存在するサーバーが公開している、その時点の作者情報。 */
export interface AuthorProfile {
    keys: readonly SigningKeyEntry[];
    displayName?: string;
}

/**
 * WebFinger の JRD から、表示名と鍵一覧の URL を取り出す（純粋）。
 * subject が問い合わせたアカウントと一致しない応答（別人の JRD を返すなど）は採用しない。
 * 鍵一覧の URL は WebFinger を返したのと同じオリジンに限る（別のサーバーに鍵の決定を委ねさせない）。
 */
export function webFingerLinks(
    jrd: unknown,
    account: string,
    origin: string,
): { signingKeysUrl?: string; displayName?: string } | undefined {
    if (typeof jrd !== 'object' || jrd === null) return undefined;
    const { subject, properties, links } = jrd as { subject?: unknown; properties?: unknown; links?: unknown };
    const expected = parseAuthorAccount(account);
    const actual = typeof subject === 'string' ? parseAuthorAccount(subject) : null;
    if (!expected || !actual || formatAuthorAccount(expected) !== formatAuthorAccount(actual)) return undefined;
    const props = typeof properties === 'object' && properties !== null ? (properties as Record<string, unknown>) : {};
    const name = DisplayNameSchema.safeParse(props[DISPLAY_NAME_WEBFINGER_PROPERTY]);
    const href = Array.isArray(links)
        ? links.find(
              (l): l is { href: string } =>
                  typeof l === 'object' &&
                  l !== null &&
                  (l as { rel?: unknown }).rel === SIGNING_KEYS_WEBFINGER_REL &&
                  typeof (l as { href?: unknown }).href === 'string',
          )?.href
        : undefined;
    const url = href ? URL.parse(href, origin) : null;
    return {
        ...(url && url.origin === origin ? { signingKeysUrl: url.href } : {}),
        ...(name.success ? { displayName: name.data } : {}),
    };
}

/** 保存済みの確認結果（DB の author_bindings）。 */
export interface StoredAuthorBinding extends AuthorProfile {
    fetchedAt: Date;
}

export interface AuthorBindingStore {
    find: (account: string) => Promise<StoredAuthorBinding | undefined>;
    save: (account: string, profile: AuthorProfile) => Promise<void>;
}

export interface AuthorKeyDirectoryDeps {
    selfDomain: () => string;
    /** 自サーバーのユーザーの作者情報（DB）。存在しなければ undefined。 */
    findLocalAccount: (handle: string) => Promise<AuthorProfile | undefined>;
    /** 他サーバーの確認結果（DB）。 */
    bindings: AuthorBindingStore;
    /** 確認が新しいうちに作者付きと確かめた内容（確認が古い間は、ここにある内容にだけ作者を付ける）。 */
    confirmedContents: {
        record: (account: string, contentHash: string) => Promise<void>;
        has: (account: string, contentHash: string) => Promise<boolean>;
    };
    /** JSON の取得。失敗・非 2xx は undefined を返すこと。 */
    fetchJson: (url: string) => Promise<unknown>;
    /** 開発（localhost 間）だけ http も試す。本番は https のみ。 */
    allowHttp: boolean;
    now?: () => number;
    freshMs?: number;
    maxAgeMs?: number;
}

export interface AuthorKeyDirectory {
    /** publicKey がその作者の取り消されていない鍵か（署名検証用）。 */
    isAuthorKey: AuthorKeyCheck;
    /** その時点の表示名。確認済みのアカウントでなければ undefined（作者名を表示しない）。 */
    displayName: (author: string) => Promise<string | undefined>;
    invalidate: (author: string) => void;
}

/** 保存した結果をネットワークに出ずに使う時間（T_fresh）。 */
export const AUTHOR_KEYS_FRESH_MS = 60 * 60 * 1000;
/**
 * 取り直せないまま保存した結果を使い続ける上限（T_max）。作者のサーバーが止まっている間の猶予。
 * 取り消しは作者のサーバーが動いていれば T_fresh 以内に届くので、これは「鍵を盗まれ、かつ作者のサーバーも止まっている」
 * 場合にだけ効く上限。
 */
export const AUTHOR_KEYS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** 確認に失敗したアカウントを問い合わせ直さない時間（取得失敗で毎回ネットワークに出ないように）。 */
const FETCH_RETRY_MS = 5 * 60 * 1000;
/**
 * 知らない鍵のために取り直す最短間隔。作者を名乗って毎回違う鍵で署名したワールドを読ませ、
 * 作者のサーバーへの問い合わせを増幅させないため。新しい公開環境の反映はこの時間だけ遅れ得る。
 */
const UNKNOWN_KEY_REFETCH_MS = 60 * 1000;
/**
 * 初めての作者・知らない鍵のために同じドメインへ出す取得の上限（窓の間の回数）。作者名を変えて（a1@x, a2@x, ...）
 * 署名したワールドを読ませても、そのドメインへの問い合わせは窓ごとにこの回数までに抑える。超えた分はいまは取得せず
 * pending を返す（作者は付けず、呼び出し側はすぐ確認し直す）。作者の多いサーバーの一覧を初めて表示したときは、
 * 窓が空くごとに順に作者が付いていく。
 */
export const DOMAIN_FETCH_LIMIT = 60;
export const DOMAIN_FETCH_WINDOW_MS = 60 * 1000;
/** 失敗の記録など、作者名ごとに持つ Map の項目数の上限（作者名を変え続けられてもメモリを増やさない）。 */
export const MAX_TRACKED_ACCOUNTS = 1000;

export interface FetchGuard {
    /** 取得してよければ true（回数を消費する）。窓の上限に達していたら false。 */
    tryAcquire: (domain: string) => boolean;
}

/** ドメインごとの取得回数を窓で数える。古い記録は取得のたびに捨て、ドメイン数の上限も持つ。 */
export function createFetchGuard(options: {
    limit: number;
    windowMs: number;
    now: () => number;
    maxDomains?: number;
}): FetchGuard {
    const history = new Map<string, number[]>();
    const maxDomains = options.maxDomains ?? MAX_TRACKED_ACCOUNTS;
    return {
        tryAcquire(domain) {
            const t = options.now();
            const recent = (history.get(domain) ?? []).filter((at) => t - at < options.windowMs);
            if (recent.length >= options.limit) {
                setBounded(history, domain, recent, maxDomains);
                return false;
            }
            setBounded(history, domain, [...recent, t], maxDomains);
            return true;
        },
    };
}

export function createAuthorKeyDirectory(deps: AuthorKeyDirectoryDeps): AuthorKeyDirectory {
    const now = deps.now ?? Date.now;
    const freshMs = deps.freshMs ?? AUTHOR_KEYS_FRESH_MS;
    const maxAgeMs = deps.maxAgeMs ?? AUTHOR_KEYS_MAX_AGE_MS;
    const failedAt = new Map<string, number>();
    const inFlight = new Map<string, Promise<AuthorProfile | undefined>>();
    const guard = createFetchGuard({ limit: DOMAIN_FETCH_LIMIT, windowMs: DOMAIN_FETCH_WINDOW_MS, now });

    const fetchProfile = async (account: string, domain: string): Promise<AuthorProfile | undefined> => {
        const path = `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${account}`)}`;
        const schemes = deps.allowHttp ? ['https', 'http'] : ['https'];
        return schemes.reduce<Promise<AuthorProfile | undefined>>(async (prev, scheme) => {
            const found = await prev;
            if (found) return found;
            const origin = `${scheme}://${domain}`;
            const jrd = await deps.fetchJson(`${origin}${path}`).catch(() => undefined);
            const links = webFingerLinks(jrd, account, origin);
            if (!links?.signingKeysUrl) return undefined;
            const list = parseSigningKeyList(
                await deps.fetchJson(links.signingKeysUrl).catch(() => undefined),
                account,
            );
            return list ? { keys: list.keys, displayName: links.displayName } : undefined;
        }, Promise.resolve(undefined));
    };

    /**
     * 鍵一覧を取り直して保存する。同じアカウントへの同時取得はまとめ、失敗後しばらくは問い合わせない。
     * discover（初めての作者・知らない鍵）はドメインの上限を使い、上限に達していたら 'deferred' を返す。
     */
    const refresh = (
        account: string,
        domain: string,
        purpose: 'refresh' | 'discover',
    ): Promise<AuthorProfile | undefined | 'deferred'> => {
        const pending = inFlight.get(account);
        if (pending) return pending;
        const failed = failedAt.get(account);
        if (failed !== undefined && now() - failed < FETCH_RETRY_MS) return Promise.resolve(undefined);
        // 上限に達していたら取得しない（失敗としては記録せず、窓が空けば次のアクセスで取得する）
        if (purpose === 'discover' && !guard.tryAcquire(domain)) return Promise.resolve('deferred');
        const task = fetchProfile(account, domain)
            .then(async (profile) => {
                if (!profile) {
                    setBounded(failedAt, account, now(), MAX_TRACKED_ACCOUNTS);
                    return undefined;
                }
                failedAt.delete(account);
                await deps.bindings.save(account, profile);
                return profile;
            })
            .finally(() => inFlight.delete(account));
        inFlight.set(account, task);
        return task;
    };

    const normalize = (author: string) => {
        const parsed = parseAuthorAccount(author);
        return parsed ? { ...parsed, account: formatAuthorAccount(parsed) } : null;
    };

    type Lookup =
        | { kind: 'found'; profile: AuthorProfile; checkedAt?: Date }
        | { kind: 'missing' }
        | { kind: 'pending' };

    /** 他サーバーのアカウントの、いま使ってよい作者情報。 */
    const remoteProfile = async (target: { account: string; domain: string }, publicKey?: string): Promise<Lookup> => {
        const binding = await deps.bindings.find(target.account);
        const age = binding ? now() - binding.fetchedAt.getTime() : Number.POSITIVE_INFINITY;
        const fromBinding = (b: StoredAuthorBinding): Lookup => ({ kind: 'found', profile: b, checkedAt: b.fetchedAt });
        if (binding && age <= maxAgeMs) {
            // 知らない鍵（新しい公開環境）だけは待って取り直す。それ以外は保存した結果で即答する
            if (publicKey && signingKeyStatus(binding.keys, publicKey) === 'unknown' && age >= UNKNOWN_KEY_REFETCH_MS) {
                const fresh = await refresh(target.account, target.domain, 'discover');
                if (fresh === 'deferred') return { kind: 'pending' };
                return fresh ? { kind: 'found', profile: fresh, checkedAt: new Date(now()) } : fromBinding(binding);
            }
            if (age > freshMs) void refresh(target.account, target.domain, 'refresh').catch(() => undefined);
            return fromBinding(binding);
        }
        // 未確認、または取り直せないまま T_max を超えた: 取り直せなければ作者を付けない
        const fresh = await refresh(target.account, target.domain, binding ? 'refresh' : 'discover');
        if (fresh === 'deferred') return { kind: 'pending' };
        return fresh ? { kind: 'found', profile: fresh, checkedAt: new Date(now()) } : { kind: 'missing' };
    };

    const lookup = async (author: string, publicKey?: string): Promise<Lookup> => {
        const target = normalize(author);
        if (!target) return { kind: 'missing' };
        if (target.domain === deps.selfDomain()) {
            const local = await deps.findLocalAccount(target.handle);
            return local ? { kind: 'found', profile: local } : { kind: 'missing' };
        }
        return remoteProfile(target, publicKey);
    };

    return {
        async isAuthorKey(author, publicKey, contentHash) {
            const found = await lookup(author, publicKey);
            if (found.kind === 'pending') return { status: 'pending' };
            if (found.kind === 'missing' || signingKeyStatus(found.profile.keys, publicKey) !== 'active') {
                return { status: 'unconfirmed' };
            }
            // 自サーバーの作者は、その場で DB で確かめた結果なので期限の考慮は要らない
            if (!found.checkedAt) return { status: 'confirmed' };
            const account = normalize(author)?.account ?? author;
            const checkedAt = found.checkedAt.toISOString();
            if (now() - found.checkedAt.getTime() <= AUTHOR_CHECK_STALE_MS) {
                void deps.confirmedContents.record(account, contentHash).catch(() => undefined);
                return { status: 'confirmed', checkedAt };
            }
            // 確認が古い（作者のサーバーを取り直せていない）間は、古くなる前に確認済みだった内容にだけ作者を付ける。
            // 鍵を盗んだうえで作者のサーバーを止めても、新しく出した作品には作者が付かない
            return (await deps.confirmedContents.has(account, contentHash))
                ? { status: 'confirmed', checkedAt }
                : { status: 'unconfirmed' };
        },

        async displayName(author) {
            const found = await lookup(author);
            return found.kind === 'found' ? found.profile.displayName : undefined;
        },

        invalidate(author) {
            const target = normalize(author);
            if (target) failedAt.delete(target.account);
        },
    };
}
