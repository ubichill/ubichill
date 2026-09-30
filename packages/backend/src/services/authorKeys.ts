/**
 * 作者アカウント（handle@domain）→ 公開環境の鍵一覧・表示名の解決（DB・ネットワーク非依存）。
 *
 * - レビュー済みの記録（trusted-authors.json）にあるアカウントはそれを使う（期限なし）。
 * - 自サーバーの domain（PUBLIC_BASE_URL のホスト）なら注入された `findLocalAccount`（DB）で引く。
 * - 他の domain は WebFinger（`/.well-known/webfinger?resource=acct:handle@domain`）の links から
 *   鍵一覧の文書を辿る。取得結果は保存し（author_bindings）、期限で取り直す:
 *   T_fresh 以内はそのまま、超えたら保存した結果で即答して裏で取り直す、取り直せないまま T_max を超えたら作者を外す。
 *   分散型で取り消しを通知して回れないので、T_max が取り消しの届く最長時間になる。
 * 実体の組み立て（DB・safeFetch）は authorKeyStore.ts。
 */
import {
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
    /**
     * リポジトリに記録してレビュー済みの結び付け（公式アカウント）。最優先で使い、ネットワークにも DB にも出ない。
     * 開発環境（オフライン・localhost）でも公式ワールドを公開ルールどおりに扱うため。
     */
    pinned: ReadonlyMap<string, AuthorProfile>;
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
    isAuthorKey: (author: string, publicKey: string) => Promise<boolean>;
    /** その時点の表示名。確認済みのアカウントでなければ undefined（作者名を表示しない）。 */
    displayName: (author: string) => Promise<string | undefined>;
    invalidate: (author: string) => void;
}

/** 保存した結果をネットワークに出ずに使う時間（T_fresh）。 */
export const AUTHOR_KEYS_FRESH_MS = 60 * 60 * 1000;
/** 取り直せないまま保存した結果を使い続ける上限（T_max）。取り消しがほかのサーバーへ届く最長時間。 */
export const AUTHOR_KEYS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 確認に失敗したアカウントを問い合わせ直さない時間（取得失敗で毎回ネットワークに出ないように）。 */
const FETCH_RETRY_MS = 5 * 60 * 1000;
/**
 * 知らない鍵のために取り直す最短間隔。作者を名乗って毎回違う鍵で署名したワールドを読ませ、
 * 作者のサーバーへの問い合わせを増幅させないため。新しい公開環境の反映はこの時間だけ遅れ得る。
 */
const UNKNOWN_KEY_REFETCH_MS = 60 * 1000;
/**
 * 同じドメインの作者サーバーへ出す取得の上限（窓の間の回数）。作者名を変えて（a1@x, a2@x, ...）署名したワールドを
 * 読ませても、そのドメインへの問い合わせは窓ごとにこの回数までに抑える。超えた分は取得せず、作者を付けない。
 */
export const DOMAIN_FETCH_LIMIT = 30;
export const DOMAIN_FETCH_WINDOW_MS = 60 * 1000;
/** 失敗の記録など、作者名ごとに持つ Map の項目数の上限（作者名を変え続けられてもメモリを増やさない）。 */
export const MAX_TRACKED_ACCOUNTS = 1000;

/** Map に入れる。上限を超えたら、先に入れた（古い）項目から捨てる。 */
export function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
    map.delete(key);
    map.set(key, value);
    for (const oldest of map.keys()) {
        if (map.size <= max) break;
        map.delete(oldest);
    }
}

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

    /** 鍵一覧を取り直して保存する。同じアカウントへの同時取得はまとめ、失敗後しばらくは問い合わせない。 */
    const refresh = (account: string, domain: string): Promise<AuthorProfile | undefined> => {
        const pending = inFlight.get(account);
        if (pending) return pending;
        const failed = failedAt.get(account);
        if (failed !== undefined && now() - failed < FETCH_RETRY_MS) return Promise.resolve(undefined);
        // ドメインの上限に達していたら取得しない（失敗としては記録せず、窓が空けば次のアクセスで取得する）
        if (!guard.tryAcquire(domain)) return Promise.resolve(undefined);
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

    /** 他サーバーのアカウントの、いま使ってよい作者情報。 */
    const remoteProfile = async (
        target: { account: string; domain: string },
        publicKey?: string,
    ): Promise<AuthorProfile | undefined> => {
        const binding = await deps.bindings.find(target.account);
        const age = binding ? now() - binding.fetchedAt.getTime() : Number.POSITIVE_INFINITY;
        if (binding && age <= maxAgeMs) {
            // 知らない鍵（新しい公開環境）だけは待って取り直す。それ以外は保存した結果で即答する
            if (publicKey && signingKeyStatus(binding.keys, publicKey) === 'unknown' && age >= UNKNOWN_KEY_REFETCH_MS) {
                return (await refresh(target.account, target.domain)) ?? binding;
            }
            if (age > freshMs) void refresh(target.account, target.domain).catch(() => undefined);
            return binding;
        }
        // 未確認、または取り直せないまま T_max を超えた: 取り直せなければ作者を付けない
        return refresh(target.account, target.domain);
    };

    const profileOf = async (author: string, publicKey?: string): Promise<AuthorProfile | undefined> => {
        const target = normalize(author);
        if (!target) return undefined;
        const pin = deps.pinned.get(target.account);
        if (pin) return pin;
        if (target.domain === deps.selfDomain()) return deps.findLocalAccount(target.handle);
        return remoteProfile(target, publicKey);
    };

    return {
        async isAuthorKey(author, publicKey) {
            const profile = await profileOf(author, publicKey);
            return !!profile && signingKeyStatus(profile.keys, publicKey) === 'active';
        },

        async displayName(author) {
            return (await profileOf(author))?.displayName;
        },

        invalidate(author) {
            const target = normalize(author);
            if (target) failedAt.delete(target.account);
        },
    };
}
