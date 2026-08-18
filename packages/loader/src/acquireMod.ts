/**
 * acquireMod — mod の「取得 + 完全性検証」（env非依存の中核）。
 *
 * 責務境界:
 *  - 知識（スキーマ / lock 判定 / capability カタログ）は @ubichill/shared。
 *  - 取得（fetch・crypto・lock 照合）はここ。baseUrl / fetch は注入する。
 *  - 状態（React context）や URL/CDN の env 解決は呼び出し側（frontend アダプタ）。
 *
 * 返す LoadedMod は React/DOM 非依存の中立表現。Host が WorkerModDefinition にマップする。
 */
import type { ComponentDataFieldSpec } from '@ubichill/shared';
import { type ModLock, requiresLock, resolveLockedMod } from '@ubichill/shared';
import { sriOf } from './integrity.ts';
import type { AcquireResult, FetchLike, LoadedMod } from './types.ts';

/** versioned manifest の Component 定義（build 時の src は含まない）。 */
interface WorkerMetaObject {
    workerUrl?: string;
    capabilities?: string[];
    singleton?: boolean;
    canvasTargets?: string[];
    watchEntityTypes?: string[];
    watchScope?: 'entity' | 'subtree' | 'parent' | 'world';
    thumbnail?: string;
    mediaTargets?: string[];
    defaultTransform?: Record<string, unknown>;
    dataFields?: Record<string, unknown>;
}

interface VersionedModJson {
    id: string;
    name?: string;
    version: string;
    components?: Record<string, WorkerMetaObject>;
}

/** manifest のバイト列 hash（integrity 照合用）とパース結果。 */
interface FetchedManifest {
    manifest: VersionedModJson;
    integrity: string;
}

export interface AcquireModOptions {
    /** mod の既定ベース URL（例: `/mods` or 外部 CDN）。末尾スラッシュなし。lock 側に
     * `baseUrl` があればそちらを優先する（mod 毎に別ホストから配布されている場合）。 */
    baseUrl: string;
    /** ワールドに焼かれた mod 完全性ロック（無い場合あり）。 */
    lock?: ModLock;
    /** ワールドの provenance kind（local/github/... enforcement 分岐）。 */
    sourceKind: string;
    /** 注入 fetch（既定: globalThis.fetch）。テスト・Node 実行で差し替える。 */
    fetchImpl?: FetchLike;
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init as RequestInit) as unknown as ReturnType<FetchLike>;

// ── module スコープのキャッシュ（baseUrl+mod で分離）─────────────
// インスタンス跨ぎで意図的に共有する（同じ mod を複数ワールドで使い回すため）。TTL は持たない:
//  - manifest は `baseUrl::mod@version` キー。version が変われば別キー＝新規取得になる。
//  - HTTP レベルの陳腐化は `{ cache: 'no-store' }` で迂回する。
//  - worker バイト列はキャッシュしない（毎回取得し hash 照合する）。
// 開発中に同一 version のまま mod を作り直した場合のみ古い index/manifest を掴むので、
// その時は resetAcquireCaches() で明示的にクリアする。
const modIndexCache = new Map<string, Promise<VersionedModJson | null>>();
const manifestCache = new Map<string, Promise<FetchedManifest | null>>();

function fetchModIndex(baseUrl: string, modName: string, f: FetchLike): Promise<VersionedModJson | null> {
    const key = `${baseUrl}::${modName}`;
    const cached = modIndexCache.get(key);
    if (cached) return cached;
    const p = f(`${baseUrl}/${modName}/mod.json`, { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<VersionedModJson>) : null))
        .catch(() => null);
    modIndexCache.set(key, p);
    return p;
}

function fetchManifest(
    baseUrl: string,
    modName: string,
    version: string,
    f: FetchLike,
): Promise<FetchedManifest | null> {
    const key = `${baseUrl}::${modName}@${version}`;
    const cached = manifestCache.get(key);
    if (cached) return cached;
    // no-store: workerUrl のハッシュがビルド毎に変わるため古い参照を掴まない。
    // 生バイト列を hash する必要があるため arrayBuffer で取得してから decode/parse する。
    const p = f(`${baseUrl}/${modName}/v${version}/manifest.json`, { cache: 'no-store' })
        .then(async (r): Promise<FetchedManifest | null> => {
            if (!r.ok) return null;
            const bytes = await r.arrayBuffer();
            const integrity = await sriOf(bytes);
            const manifest = JSON.parse(new TextDecoder().decode(bytes)) as VersionedModJson;
            return { manifest, integrity };
        })
        .catch(() => null);
    manifestCache.set(key, p);
    return p;
}

interface FetchedWorker {
    bytes: ArrayBuffer;
    integrity: string;
}

/** worker の生バイト列を取得し integrity を計算する。非 JS content-type は拒否。 */
async function fetchWorkerBytes(workerUrl: string, entityType: string, f: FetchLike): Promise<FetchedWorker | null> {
    try {
        const res = await f(workerUrl);
        if (!res.ok) return null;
        // 許可するのは javascript / text-plain / 空 のみ。それ以外（SPA fallback の text/html や
        // 誤って返る application/json 等）は拒否する。HTML/JSON が worker コードに混ざると
        // sandbox の new Function() が構文エラーで死ぬため、ここで弾く。
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('javascript') && !ct.includes('text/plain') && ct !== '') {
            console.warn(`[loader] worker fetch が非 JS content-type "${ct}" を返した: ${entityType}`);
            return null;
        }
        const bytes = await res.arrayBuffer();
        return { bytes, integrity: await sriOf(bytes) };
    } catch {
        return null;
    }
}

/**
 * Component 型（`modId:componentName`）から検証済み {@link LoadedMod} を構築する。
 *
 * lock がある mod は「固定 version」を直接取得し（最新ポインタを信頼しない）、
 * manifest / worker の生バイト列 hash を lock と照合する。外部 provenance の不一致・
 * lock 欠落は実行拒否。local は寛容（不一致でも警告続行）。capability は verified 時のみ
 * lock 天井、それ以外は manifest 由来。
 */
export async function acquireMod(entityType: string, opts: AcquireModOptions): Promise<AcquireResult> {
    const { lock, sourceKind } = opts;
    const f = opts.fetchImpl ?? defaultFetch;

    const colonIdx = entityType.indexOf(':');
    if (colonIdx === -1) return 'not-found';

    const modName = entityType.slice(0, colonIdx);
    const lockEntry = lock?.mods[modName];

    // 外部 provenance で lock 記載が無いなら、fetch する前に拒否する。
    if (!lockEntry && requiresLock(sourceKind)) return { rejected: 'lock-missing' };

    // この mod だけ別ホストから配布されている場合、lock.baseUrl を既定より優先する。
    const baseUrl = lockEntry?.baseUrl ?? opts.baseUrl;

    // version は lock を最優先で固定（無ければ最新ポインタ）。
    const version = lockEntry?.version ?? (await fetchModIndex(baseUrl, modName, f))?.version;
    if (!version) return 'not-found';

    const fetched = await fetchManifest(baseUrl, modName, version, f);
    const entry = fetched?.manifest.components?.[entityType];
    if (!fetched || !entry) return 'not-found';
    if (!entry.workerUrl) return 'data-only';

    const versionedBase = `${baseUrl}/${modName}/v${version}`;
    // workerUrl は lock を優先（固定パス）。無ければ manifest 由来。
    const relWorkerUrl = lockEntry?.components[entityType]?.workerUrl ?? entry.workerUrl;
    const workerUrl = `${versionedBase}/${relWorkerUrl.replace(/^\.\//, '')}`;

    const fetchedWorker = await fetchWorkerBytes(workerUrl, entityType, f);
    if (!fetchedWorker) return 'not-found';

    const verdict = resolveLockedMod({
        entityType,
        lockEntry,
        workerIntegrity: fetchedWorker.integrity,
        manifestIntegrity: fetched.integrity,
        sourceKind,
    });

    if (verdict.status === 'rejected') {
        // 外部は拒否。local は「壊れているかも」警告のみで従来通り続行する。
        if (requiresLock(sourceKind)) return { rejected: verdict.reason };
        console.warn(`[loader] lock 不一致 (${verdict.reason}) だが local のため続行: ${entityType}`);
    }

    // capability 天井: verified は lock 由来のみ、それ以外は manifest 由来（従来挙動）。
    const capabilities = verdict.status === 'verified' ? [...verdict.capabilities] : entry.capabilities;

    const loaded: LoadedMod = {
        id: entityType,
        name: `${fetched.manifest.name ?? modName} - ${entityType.slice(colonIdx + 1)}`,
        workerCode: new TextDecoder().decode(fetchedWorker.bytes),
        capabilities,
        modBase: versionedBase,
        watchScope: entry.watchScope ?? 'subtree',
        watchEntityTypes: entry.watchEntityTypes,
        canvasTargets: entry.canvasTargets,
        mediaTargets: entry.mediaTargets,
        singleton: entry.singleton,
        thumbnail: entry.thumbnail,
        dataFields: entry.dataFields as Record<string, ComponentDataFieldSpec> | undefined,
    };
    return loaded;
}

/** テスト / インスタンス離脱時のキャッシュリセット。 */
export function resetAcquireCaches(): void {
    modIndexCache.clear();
    manifestCache.clear();
}
