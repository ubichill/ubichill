/**
 * worldResolver — 「ワールド＝URL」の解決層。
 *
 * URL（または YAML テキスト）を検証済み {@link ResolvedWorld} に変換する。
 * official / 外部 / 他インスタンスを engine から同一視するための単一の入口。
 *
 * - 直 YAML URL（.yaml / .yml）
 * - GitHub blob URL → raw 変換
 * - GitHub ディレクトリ（tree URL）→ Contents API で列挙
 * - 他 ubichill インスタンスのワールド一覧 API
 *
 * DB には一切依存しない（純粋に URL → 定義）。
 */

import {
    DEFAULTS,
    type InitialEntity,
    LIMITS,
    type ResolvedWorld,
    type WorldDefinition,
    WorldDefinitionSchema,
    type WorldSource,
    WorldSourceKind,
} from '@ubichill/shared';
import yaml from 'yaml';
import { migrateLegacyWorldYaml } from './worldMigration';

const GITHUB_BLOB_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;
const GITHUB_TREE_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/;
const YAML_EXT_RE = /\.(ya?ml)$/i;

const registryToken = (): string | undefined => process.env.WORLDS_REGISTRY_TOKEN || undefined;

/** GitHub blob URL を raw.githubusercontent.com へ変換する（それ以外はそのまま）。 */
export function toRawGitHubUrl(url: string): string {
    const m = GITHUB_BLOB_RE.exec(url);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    return url;
}

/** サイズ上限付きで URL からテキストを取得する。 */
async function fetchText(url: string): Promise<string> {
    const headers: Record<string, string> = {};
    const token = registryToken();
    if (token && (url.includes('github') || url.includes('githubusercontent'))) {
        headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const text = await res.text();
    if (text.length > LIMITS.MAX_YAML_SIZE) {
        throw new Error(`ワールド定義が大きすぎます (${text.length} > ${LIMITS.MAX_YAML_SIZE}): ${url}`);
    }
    return text;
}

/** 検証済みワールド定義を ResolvedWorld へ写像する（DB 非依存）。 */
export function definitionToResolved(
    parsed: unknown,
    url: string,
    source: WorldSource,
    extra?: { authorId?: string },
): ResolvedWorld {
    return mapToResolved(validateWorldDefinition(parsed, url), url, source, extra);
}

/** unknown をパース・マイグレーション・検証して WorldDefinition にする（不正は throw）。 */
export function validateWorldDefinition(parsed: unknown, url: string): WorldDefinition {
    const result = WorldDefinitionSchema.safeParse(migrateLegacyWorldYaml(parsed));
    if (!result.success) {
        const issue = result.error.issues[0];
        throw new Error(`ワールド定義が無効です (${url}): ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`);
    }
    return result.data;
}

/** 検証済み WorldDefinition を ResolvedWorld に写像する（純粋）。 */
function mapToResolved(
    def: WorldDefinition,
    url: string,
    source: WorldSource,
    extra?: { authorId?: string },
): ResolvedWorld {
    const env = def.spec.environment ?? {
        backgroundColor: DEFAULTS.WORLD_ENVIRONMENT.backgroundColor,
        worldSize: DEFAULTS.WORLD_ENVIRONMENT.worldSize,
    };
    const normalizeEntity = (e: InitialEntity): InitialEntity => ({
        id: e.id,
        transform: e.transform,
        components: e.components.map((c) => ({ type: c.type, data: c.data ?? {} })),
        tags: e.tags ?? [],
        children: (e.children ?? []).map(normalizeEntity),
    });
    return {
        url,
        source,
        id: def.metadata.name,
        authorId: extra?.authorId,
        authorName: def.metadata.author?.name,
        version: def.metadata.version,
        displayName: def.spec.displayName,
        description: def.spec.description,
        thumbnail: def.spec.thumbnail,
        environment: {
            backgroundColor: env.backgroundColor ?? DEFAULTS.WORLD_ENVIRONMENT.backgroundColor,
            worldSize: env.worldSize ?? DEFAULTS.WORLD_ENVIRONMENT.worldSize,
        },
        capacity: def.spec.capacity,
        dependencies: def.spec.dependencies?.map((d) => ({ name: d.name, source: d.source })),
        initialEntities: def.spec.initialEntities.map(normalizeEntity),
    };
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

/** URL を取得して ResolvedWorld に解決する（外部/他インスタンス用）。 */
export async function resolveWorldFromUrl(url: string, source: WorldSource): Promise<ResolvedWorld> {
    const fetchUrl = toRawGitHubUrl(url);
    const text = await fetchText(fetchUrl);
    // 正規 URL は元の（人間が貼れる）URL を維持する
    return resolveWorldFromYaml(text, url, source);
}

/** URL を取得し、生定義（配信用）と ResolvedWorld（一覧/入室用）の両方を返す。 */
export async function resolveWorld(
    url: string,
    source: WorldSource,
): Promise<{ definition: WorldDefinition; resolved: ResolvedWorld }> {
    const text = await fetchText(toRawGitHubUrl(url));
    const definition = validateWorldDefinition(yaml.parse(text), url);
    return { definition, resolved: definitionToResolved(definition, url, source) };
}

// ============================================================
// レジストリソースの列挙
// ============================================================

type GitHubContentEntry = { name: string; type: 'file' | 'dir'; download_url: string | null };

/**
 * Contents API の ETag キャッシュ。
 * GitHub は `If-None-Match` に対する 304 応答をレート制限にカウントしないため、
 * 変更が無い限り列挙は実質タダになる（60/時の枠を守る主要な対策）。
 */
const contentsCache = new Map<string, { etag: string; urls: string[] }>();

/** GitHub tree URL を Contents API で列挙し、各 YAML の raw URL を返す（ETag 条件付き＋制限時フォールバック）。 */
async function enumerateGitHubDir(owner: string, repo: string, ref: string, path: string): Promise<string[]> {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    const token = registryToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const cached = contentsCache.get(apiUrl);
    if (cached) headers['If-None-Match'] = cached.etag;

    const res = await fetch(apiUrl, { headers });

    // 304: 未変更。レート制限を消費しない。キャッシュを返す。
    if (res.status === 304 && cached) return cached.urls;

    // 403/429 のレート制限: キャッシュがあれば維持して列挙を落とさない。
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
        if (cached) {
            console.warn(`⚠ GitHub API レート制限中。キャッシュで継続: ${apiUrl}`);
            return cached.urls;
        }
        throw new Error(`GitHub API レート制限（キャッシュ無し）: ${apiUrl}`);
    }

    if (!res.ok) throw new Error(`GitHub Contents API ${res.status}: ${apiUrl}`);

    const entries = (await res.json()) as GitHubContentEntry[];
    const urls = entries
        .filter((e) => e.type === 'file' && YAML_EXT_RE.test(e.name) && e.download_url)
        .map((e) => e.download_url as string);
    const etag = res.headers.get('etag');
    if (etag) contentsCache.set(apiUrl, { etag, urls });
    return urls;
}

/**
 * CDN 配信のインデックス JSON（API 不使用）を読み、ワールド URL 群へ展開する。
 * 配布者が生成した `[{ file }] | [{ url }]` を想定。`file` は JSON の URL 基準で解決。
 */
async function enumerateIndexJson(indexUrl: string): Promise<{ url: string; source: WorldSource }[]> {
    const text = await fetchText(indexUrl);
    const list = JSON.parse(text) as Array<{ file?: string; url?: string }>;
    const base = indexUrl.slice(0, indexUrl.lastIndexOf('/') + 1);
    return list
        .map((e) => e.url ?? (e.file ? `${base}${e.file}` : undefined))
        .filter((u): u is string => typeof u === 'string')
        .map((url) => ({ url, source: { kind: WorldSourceKind.Registry, url, registryName: indexUrl } }));
}

/**
 * レジストリソース URL を個々のワールド URL＋source に展開する。
 * - GitHub tree URL → Contents API 列挙（ETag キャッシュ、kind: github）
 * - インデックス JSON URL → CDN 取得（API 不使用、kind: registry）
 * - 直 YAML URL → 単一（kind: github or url）
 * - 他インスタンス一覧 API → kind: remote-instance で展開
 */
export async function enumerateSource(sourceUrl: string): Promise<{ url: string; source: WorldSource }[]> {
    const tree = GITHUB_TREE_RE.exec(sourceUrl);
    if (tree) {
        const [, owner, repo, ref, path] = tree;
        const urls = await enumerateGitHubDir(owner, repo, ref, path);
        return urls.map((url) => ({
            url,
            source: { kind: WorldSourceKind.GitHub, url, registryName: `${owner}/${repo}` },
        }));
    }

    // インデックス JSON（配布者が生成、CDN 配信で API 不使用の抜け道）
    if (/\.json$/i.test(sourceUrl)) {
        return enumerateIndexJson(sourceUrl);
    }

    if (YAML_EXT_RE.test(sourceUrl)) {
        const kind = sourceUrl.includes('github') ? WorldSourceKind.GitHub : WorldSourceKind.Url;
        return [{ url: sourceUrl, source: { kind, url: sourceUrl } }];
    }

    // 他 ubichill インスタンスのワールド一覧 API とみなす（{ worlds: WorldListItem[] } を返す想定）
    const res = await fetch(sourceUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`レジストリ列挙に失敗 HTTP ${res.status}: ${sourceUrl}`);
    const body = (await res.json()) as { worlds?: Array<{ url?: string }> };
    const base = new URL(sourceUrl).origin;
    return (body.worlds ?? [])
        .filter((w): w is { url: string } => typeof w.url === 'string')
        .map((w) => ({
            url: w.url,
            source: { kind: WorldSourceKind.RemoteInstance, url: w.url, originInstance: base },
        }));
}
