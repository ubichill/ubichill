/**
 * 作者と ID から、いま公開されている mod の取得先と版を引く（お気に入りの mod の確認と一覧）。
 * このサーバーの作者は自分のカタログ、ほかのサーバーの作者はエディタと同じ道筋（WebFinger → 作者のカタログ）で引く。
 * 署名と中身は、ワールドに足すときにエディタが確かめる。
 */
import {
    MOD_CATALOG_REL,
    type ModFavoriteRef,
    type PackageDescriptor,
    PackageDescriptorSchema,
    parseAuthorAccount,
} from '@ubichill/shared';

export type ModLookup =
    | { status: 'found'; descriptor: PackageDescriptor }
    /** 作者・mod が無い、作者のサーバーが mod を案内していない */
    | { status: 'missing' }
    /** 作者のサーバーにいま届かない（あとで引き直せば見つかるかもしれない） */
    | { status: 'unreachable' };

export interface ModLookupDeps {
    selfDomain: () => string;
    localDescriptor: (handle: string, id: string) => Promise<PackageDescriptor | undefined>;
    /** 応答が無ければ（通信の失敗）throw する。 */
    fetchJson: (url: string) => Promise<{ status: number; body: unknown }>;
}

const MISSING: ModLookup = { status: 'missing' };
const UNREACHABLE: ModLookup = { status: 'unreachable' };

/** 404・410 は「無い」、それ以外の失敗は「いま届かない」。 */
const failureOf = (status: number): ModLookup => (status === 404 || status === 410 ? MISSING : UNREACHABLE);

/** 作者のサーバーが案内するカタログ。同じオリジンで、認証情報・検索・断片の無いものだけ。 */
function catalogUrl(finger: unknown, author: string, origin: string): URL | undefined {
    const body = (typeof finger === 'object' && finger !== null ? finger : {}) as {
        subject?: unknown;
        links?: unknown;
    };
    if (body.subject !== `acct:${author}` || !Array.isArray(body.links)) return undefined;
    const href = body.links.find(
        (l: unknown): l is { rel: string; href: string } =>
            typeof l === 'object' &&
            l !== null &&
            (l as { rel?: unknown }).rel === MOD_CATALOG_REL &&
            typeof (l as { href?: unknown }).href === 'string',
    )?.href;
    const url = href === undefined ? null : URL.parse(href, origin);
    if (!url || url.origin !== origin || url.username || url.password || url.search || url.hash) return undefined;
    return url;
}

export function createModLookup(deps: ModLookupDeps) {
    const remote = async (ref: ModFavoriteRef, domain: string): Promise<ModLookup> => {
        const origin = `https://${domain}`;
        const finger = await deps.fetchJson(
            `${origin}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${ref.author}`)}`,
        );
        if (finger.status !== 200) return failureOf(finger.status);
        const catalog = catalogUrl(finger.body, ref.author, origin);
        if (!catalog) return MISSING;
        const found = await deps.fetchJson(`${catalog.href.replace(/\/$/, '')}/${encodeURIComponent(ref.id)}`);
        if (found.status !== 200) return failureOf(found.status);
        const descriptor = PackageDescriptorSchema.safeParse(found.body);
        return descriptor.success && descriptor.data.author === ref.author && descriptor.data.id === ref.id
            ? { status: 'found', descriptor: descriptor.data }
            : MISSING;
    };

    const local = async (ref: ModFavoriteRef, handle: string): Promise<ModLookup> => {
        const descriptor = await deps.localDescriptor(handle, ref.id);
        return descriptor ? { status: 'found', descriptor } : MISSING;
    };

    return function lookup(ref: ModFavoriteRef): Promise<ModLookup> {
        const account = parseAuthorAccount(ref.author);
        if (!account) return Promise.resolve(MISSING);
        const found = account.domain === deps.selfDomain() ? local(ref, account.handle) : remote(ref, account.domain);
        return found.catch(() => UNREACHABLE);
    };
}
