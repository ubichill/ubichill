/**
 * worldResolver — 「ワールド＝URL」の解決層。
 *
 * URL（または YAML テキスト）を検証済み {@link ResolvedWorld} に変換する。
 * official / 外部 / 他インスタンスを engine から同一視するための単一の入口。
 * 定義の検証と写像そのもの（definitionToResolved）は @ubichill/shared にあり、CLI と共有する。
 *
 * - 直 YAML URL（.yaml / .yml）
 * - GitHub blob URL → raw 変換
 * - GitHub ディレクトリ（tree URL）→ Contents API で列挙
 * - 他 ubichill インスタンスのワールド一覧 API
 *
 * DB には一切依存しない（純粋に URL → 定義）。
 */

import {
    type AuthorKeyCheck,
    definitionToResolved,
    LIMITS,
    ModLockSchema,
    mapToResolved,
    type ResolvedWorld,
    validateWorldDefinition,
    verifyWorldSignature,
    type WorldDefinition,
    type WorldDocument,
    type WorldIdentity,
    type WorldSignatureInvalidReason,
    type WorldSource,
} from '@ubichill/shared';
import yaml from 'yaml';
import { safeFetch } from './safeFetch';
import { nodeWorldCrypto } from './worldCrypto';

const GITHUB_BLOB_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;

const registryToken = (): string | undefined => process.env.WORLDS_REGISTRY_TOKEN || undefined;

/** GitHub blob URL を raw.githubusercontent.com へ変換する（それ以外はそのまま）。 */
export function toRawGitHubUrl(url: string): string {
    const m = GITHUB_BLOB_RE.exec(url);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    return url;
}

const REGISTRY_TOKEN_HOSTS = new Set(['raw.githubusercontent.com', 'api.github.com']);

/** レジストリのトークンを付けてよい URL か。トークンは GitHub 本体にだけ送る（部分一致にするとほかのホストへ漏れる）。 */
export function sendsRegistryToken(url: string): boolean {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && REGISTRY_TOKEN_HOSTS.has(u.hostname);
    } catch {
        return false;
    }
}

/** サイズ上限付きで URL からテキストを取得する。 */
async function fetchText(url: string): Promise<string> {
    const headers: Record<string, string> = { Accept: 'application/yaml, text/yaml, */*' };
    const token = registryToken();
    if (token && sendsRegistryToken(url)) {
        headers.Authorization = `Bearer ${token}`;
    }
    // 上限は文字数なので、UTF-8 の最大 4 バイトぶんまで読んでから文字数で確かめる
    const res = await safeFetch(url, { headers, maxBytes: LIMITS.MAX_YAML_SIZE * 4 });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const text = await res.text();
    if (text.length > LIMITS.MAX_YAML_SIZE) {
        throw new Error(`ワールド定義が大きすぎます (${text.length} > ${LIMITS.MAX_YAML_SIZE}): ${url}`);
    }
    return text;
}

type SiblingKind = 'lock' | 'sig';

const SIBLING_FILE_EXT: Record<SiblingKind, string> = { lock: '.lock.json', sig: '.sig.json' };

/**
 * ワールド URL から兄弟配信物（mod ロック / 署名）の URL を導出する。配り方は 1 つだけ:
 * `<world>.yaml` の拡張子を `.lock.json` / `.sig.json` に置き換える（ubichill 本体も GitHub raw などの外部ホストも同じ）。
 * YAML の URL でなければ null（兄弟なし）。
 */
function siblingUrlFor(worldUrl: string, kind: SiblingKind): string | null {
    try {
        const u = new URL(worldUrl);
        if (/\.ya?ml$/i.test(u.pathname)) {
            return `${u.origin}${u.pathname.replace(/\.ya?ml$/i, SIBLING_FILE_EXT[kind])}${u.search}`;
        }
        return null;
    } catch {
        return null;
    }
}

export const lockUrlFor = (worldUrl: string): string | null => siblingUrlFor(worldUrl, 'lock');
export const sigUrlFor = (worldUrl: string): string | null => siblingUrlFor(worldUrl, 'sig');

/**
 * 兄弟 URL から JSON を best-effort で生のまま取得する。取得不能・非 JSON は undefined。
 * 生値のまま返すのは contentHash が「配信された値」で計算されるため（スキーマ既定値を足すと一致しない）。
 */
async function fetchSiblingJson(url: string | null): Promise<unknown> {
    if (!url) return undefined;
    try {
        const res = await safeFetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) return undefined;
        return (await res.json()) as unknown;
    } catch {
        return undefined;
    }
}

/**
 * 配信された生の world + lock と署名から識別結果を得る。改竄・署名不正は throw（解決を拒否）。
 * 署名が取れなければ unsigned。配信元を乗っ取った攻撃者は署名ファイルを消して unsigned に
 * 格下げできるため、既知 worldId との照合（お気に入り等）は呼び出し側の責務。
 */
export async function identifyWorld(
    doc: WorldDocument,
    rawSignature: unknown,
    url: string,
    isAuthorKey?: AuthorKeyCheck,
): Promise<WorldIdentity> {
    const verdict = await verifyWorldSignature(doc, rawSignature, nodeWorldCrypto, isAuthorKey);
    if (verdict.status === 'invalid') throw new WorldIntegrityError(verdict.reason, url);
    return verdict;
}

/** 署名検証に失敗した（改竄・署名不正）。取得失敗と区別し、古いキャッシュへのフォールバックもしない。 */
export class WorldIntegrityError extends Error {
    constructor(
        readonly reason: WorldSignatureInvalidReason,
        readonly url: string,
    ) {
        super(`ワールドの署名検証に失敗しました (${reason}): ${url}`);
        this.name = 'WorldIntegrityError';
    }
}

/** YAML テキストから ResolvedWorld を作る。 */
export function resolveWorldFromYaml(
    yamlText: string,
    url: string,
    source: WorldSource,
    extra?: { authorId?: string },
): ResolvedWorld {
    return definitionToResolved(yaml.parse(yamlText), url, source, extra);
}

/**
 * 外部ワールドの作者名。metadata.author（自己申告）は使わず、署名で確認できた作者アカウントの
 * その時点の表示名だけを返す。作者アカウントを確認できない・引けなければ undefined（作者名を出さない）。
 */
export async function confirmedAuthorName(
    identity: WorldIdentity,
    resolveAuthorName?: (author: string) => Promise<string | undefined>,
): Promise<string | undefined> {
    if (identity.status !== 'verified' || !identity.author || !resolveAuthorName) return undefined;
    return resolveAuthorName(identity.author).catch(() => undefined);
}

export interface ResolveWorldOptions {
    /** 署名の作者アカウントを確認する（DB / WebFinger）。無ければ作者は表示せず鍵で識別する。 */
    isAuthorKey?: AuthorKeyCheck;
    /** 作者アカウントのその時点の表示名（DB / WebFinger）。 */
    resolveAuthorName?: (author: string) => Promise<string | undefined>;
}

/**
 * ワールドのバンドル: 作者が書いて署名した 3 つの生の値（world 定義・兄弟 lock・兄弟署名）。
 * 置き場所（外部 URL・本体のリポジトリの静的ファイル・本体の DB）に関係なく、ワールドは常にこの形で配られ、
 * {@link resolveBundle} で同じ規則で検証される。置き場所の違いは、バンドルを手に入れる方法だけ。
 */
export interface WorldBundle {
    /** YAML をパースした生の値（スキーマの既定値を足していないもの。署名の対象そのもの）。 */
    definition: unknown;
    lock: unknown;
    signature: unknown;
}

/**
 * バンドルを検証して ResolvedWorld にする（すべてのワールドに同じ規則）。
 * 改竄・署名不正は throw（解決を拒否）、署名が無ければ unsigned。作者は確認できたときだけ付く。
 */
export async function resolveBundle(
    bundle: WorldBundle,
    url: string,
    source: WorldSource,
    options: ResolveWorldOptions & { authorId?: string } = {},
): Promise<{ definition: WorldDefinition; resolved: ResolvedWorld }> {
    const identity = await identifyWorld(
        { definition: bundle.definition, lock: bundle.lock ?? null },
        bundle.signature ?? null,
        url,
        options.isAuthorKey,
    );
    const parsedLock = ModLockSchema.safeParse(bundle.lock);
    const definition = validateWorldDefinition(bundle.definition, url);
    const resolved = mapToResolved(definition, url, source, {
        authorId: options.authorId,
        lock: parsedLock.success ? parsedLock.data : undefined,
        identity,
    });
    const authorName = await confirmedAuthorName(identity, options.resolveAuthorName);
    return { definition, resolved: { ...resolved, authorName } };
}

/**
 * URL からバンドル（本体 YAML・兄弟 lock・兄弟署名）を取得して {@link resolveBundle} で検証する（外部/他インスタンス用）。
 */
export async function resolveWorld(
    url: string,
    source: WorldSource,
    options: ResolveWorldOptions = {},
): Promise<{ definition: WorldDefinition; resolved: ResolvedWorld }> {
    const fetchUrl = toRawGitHubUrl(url);
    const [text, rawLock, rawSig] = await Promise.all([
        fetchText(fetchUrl),
        fetchSiblingJson(lockUrlFor(fetchUrl)),
        fetchSiblingJson(sigUrlFor(fetchUrl)),
    ]);
    // 正規 URL は元の（人間が貼れる）URL を維持する
    return resolveBundle(
        { definition: yaml.parse(text) as unknown, lock: rawLock, signature: rawSig },
        url,
        source,
        options,
    );
}

/** URL を取得して ResolvedWorld に解決する（外部/他インスタンス用）。 */
export async function resolveWorldFromUrl(
    url: string,
    source: WorldSource,
    options: ResolveWorldOptions = {},
): Promise<ResolvedWorld> {
    return (await resolveWorld(url, source, options)).resolved;
}

/**
 * ubichill 本体のワールドの URL を、配信している YAML の URL（`.../api/v1/authors/:handle/worlds/:name.yaml`）に正規化する。
 * 共有 URL（`.../@handle/name`）も同じ形にする。以前の内部 ID の形（`.../world/:id`、`.../api/v1/worlds/:id`、`/yaml`・`.yaml` 付き）は
 * `.../api/v1/worlds/:id` にそろえる（自ホストなら ID で解決できる）。それ以外はそのまま返す。
 */
/**
 * 貼り付けられた共有の文字列を、解決できるワールドの参照にする（ロビーの「共有 URL を貼って入る」など）。
 * - `@handle/name`・`/@handle/name` → `@handle/name`（このサーバーの作者のワールド）
 * - 共有ページ `…/world?url=<ワールドの URL>` → 中のワールドの URL（どのサーバーの共有ページでも）
 * - `https://` を省いた `host/…` → `https://host/…`
 * それ以外（ワールドの URL・内部 ID）はそのまま。`…/@handle/name` などの URL の形は normalizeWorldUrl が読む。
 */
export function worldRefOf(input: string): string {
    const unwrap = (value: string, depth: number): string => {
        const s = value.trim();
        const author = /^\/?(@[a-z0-9_]+\/[a-z0-9-]+)\/?$/i.exec(s);
        if (author) return (author[1] as string).toLowerCase();
        const url = /^https?:\/\//i.test(s) ? s : /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\//i.test(s) ? `https://${s}` : s;
        const inner = (() => {
            try {
                const u = new URL(url);
                return u.pathname.replace(/\/$/, '') === '/world' ? u.searchParams.get('url') : null;
            } catch {
                return null;
            }
        })();
        // 共有ページが共有ページを包んでいても数段で止める
        return inner && depth < 3 ? unwrap(inner, depth + 1) : url;
    };
    return unwrap(input, 0);
}

export function normalizeWorldUrl(input: string): string {
    try {
        const u = new URL(input);
        const author =
            /^\/@([a-z0-9_]+)\/([a-z0-9-]+)\/?$/.exec(u.pathname) ??
            /^\/api\/v1\/authors\/([a-z0-9_]+)\/worlds\/([a-z0-9-]+)(?:\.yaml)?\/?$/.exec(u.pathname);
        if (author) return `${u.origin}/api/v1/authors/${author[1]}/worlds/${author[2]}.yaml`;
        const legacy = /^\/(?:world|api\/v1\/worlds)\/([a-z0-9-]+)(?:\/yaml|\.yaml)?\/?$/.exec(u.pathname);
        return legacy ? `${u.origin}/api/v1/worlds/${legacy[1]}` : input;
    } catch {
        return input;
    }
}
