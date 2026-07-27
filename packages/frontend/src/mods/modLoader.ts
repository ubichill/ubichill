/**
 * modLoader — mod の「取得 + 完全性検証」層（React 非依存）。
 *
 * 責務境界:
 *  - 知識（スキーマ / lock 判定 / capability カタログ）は @ubichill/shared。
 *  - 取得（URL/CDN・fetch・crypto・lock 照合）はここ。
 *  - 状態（キャッシュ・進捗・register）は ModRegistryContext（React）。
 *  - 隔離実行（Worker 起動・実行時 enforcement）は @ubichill/sandbox。
 *
 * ここは URL と bytes を扱うが、sandbox には「検証済み workerCode + capability 天井」
 * しか渡らない。sandbox は URL/CDN/integrity を一切知らない（責務の一方向依存）。
 */
import type { WorkerModDefinition } from '@ubichill/react';
import { formatIntegrity, type LockRejectReason, type ModLock, requiresLock, resolveLockedMod } from '@ubichill/shared';

/**
 * mod のベース URL。
 * VITE_MOD_CDN_URL があれば外部 CDN / GitHub Pages、無ければ自ホストの /mods。
 */
export const MOD_BASE_URL: string = (() => {
    const envUrl = import.meta.env.VITE_MOD_CDN_URL as string | undefined;
    if (envUrl) return envUrl.replace(/\/$/, '');
    return '/mods';
})();

/** ルート mod.json（最新バージョンへのポインタ）。 */
interface ModIndex {
    id: string;
    name?: string;
    version: string;
}

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

/** manifest のバイト列 hash（integrity 照合用）とパース結果をまとめて保持する。 */
interface FetchedManifest {
    manifest: VersionedModJson;
    /** manifest.json の生バイト列 sha256（`sha256-<base64>`）。 */
    integrity: string;
}

// ── module スコープのキャッシュ（1 タブ内で共有）─────────────────
const modIndexCache = new Map<string, Promise<ModIndex | null>>();
const manifestCache = new Map<string, Promise<FetchedManifest | null>>();

/**
 * ArrayBuffer を SRI 文字列 `sha256-<base64>` に変換する。
 * build 側（`Buffer.from(code,'utf-8')` の sha256 base64）と同一バイト列・同一規約で
 * 照合できるよう、必ず fetch した生バイト列を渡すこと。
 */
async function sriOf(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    // spread は大きな bundle で stack を溢れさせるため Array.from(mapper) で 1 バイトずつ。
    const binary = Array.from(new Uint8Array(digest), (b) => String.fromCharCode(b)).join('');
    return formatIntegrity(btoa(binary));
}

function fetchModIndex(modName: string): Promise<ModIndex | null> {
    const cached = modIndexCache.get(modName);
    if (cached) return cached;
    const p = fetch(`${MOD_BASE_URL}/${modName}/mod.json`, { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<ModIndex>) : null))
        .catch(() => null);
    modIndexCache.set(modName, p);
    return p;
}

function fetchManifest(modName: string, version: string): Promise<FetchedManifest | null> {
    const key = `${modName}@${version}`;
    const cached = manifestCache.get(key);
    if (cached) return cached;
    // no-store: workerUrl のハッシュがビルド毎に変わるため古い参照を掴まない。
    // 生バイト列を hash する必要があるため arrayBuffer で取得してから decode/parse する。
    const p = fetch(`${MOD_BASE_URL}/${modName}/v${version}/manifest.json`, { cache: 'no-store' })
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

/**
 * loadVerifiedMod の戻り値。
 *  - WorkerModDefinition : ロード成功（capabilities は lock 天井 or manifest 由来）。
 *  - 'data-only'         : worker を持たない純データ Component（警告不要）。
 *  - 'not-found'         : manifest/worker 取得失敗・未宣言。
 *  - { rejected }        : lock 照合で拒否（外部 provenance）。理由付き。
 */
export type LoadResult = WorkerModDefinition | 'data-only' | 'not-found' | { rejected: LockRejectReason };

export interface LoadModOptions {
    /** ワールドに焼かれた mod 完全性ロック（無い場合あり）。 */
    lock?: ModLock;
    /** ワールドの provenance kind（local/github/... enforcement 分岐）。 */
    sourceKind: string;
}

/**
 * Component 型（`modId:componentName`）から検証済み WorkerModDefinition を構築する。
 *
 * lock がある mod は「固定 version」を直接取得し（最新ポインタを信頼しない）、
 * manifest / worker の生バイト列 hash を lock と照合する。外部 provenance の不一致・
 * lock 欠落は実行拒否。local は寛容（不一致でも警告続行）。capability は verified 時のみ
 * lock 天井、それ以外は manifest 由来。
 */
export async function loadVerifiedMod(entityType: string, opts: LoadModOptions): Promise<LoadResult> {
    const colonIdx = entityType.indexOf(':');
    if (colonIdx === -1) return 'not-found';

    const modName = entityType.slice(0, colonIdx);
    const lockEntry = opts.lock?.mods[modName];

    // 外部 provenance で lock 記載が無いなら、fetch する前に拒否する。
    if (!lockEntry && requiresLock(opts.sourceKind)) return { rejected: 'lock-missing' };

    // version は lock を最優先で固定（無ければ最新ポインタ）。
    const version = lockEntry?.version ?? (await fetchModIndex(modName))?.version;
    if (!version) return 'not-found';

    const fetched = await fetchManifest(modName, version);
    const entry = fetched?.manifest.components?.[entityType];
    if (!fetched || !entry) return 'not-found';
    if (!entry.workerUrl) return 'data-only';

    const versionedBase = `${MOD_BASE_URL}/${modName}/v${version}`;
    // workerUrl は lock を優先（固定パス）。無ければ manifest 由来。
    const relWorkerUrl = lockEntry?.components[entityType]?.workerUrl ?? entry.workerUrl;
    const workerUrl = `${versionedBase}/${relWorkerUrl.replace(/^\.\//, '')}`;

    const fetchedWorker = await fetchWorkerBytes(workerUrl, entityType);
    if (!fetchedWorker) return 'not-found';

    const verdict = resolveLockedMod({
        entityType,
        lockEntry,
        workerIntegrity: fetchedWorker.integrity,
        manifestIntegrity: fetched.integrity,
        sourceKind: opts.sourceKind,
    });

    if (verdict.status === 'rejected') {
        // 外部は拒否。local は「壊れているかも」警告のみで従来通り続行する。
        if (requiresLock(opts.sourceKind)) return { rejected: verdict.reason };
        console.warn(`[modLoader] lock 不一致 (${verdict.reason}) だが local のため続行: ${entityType}`);
    }

    // capability 天井: verified は lock 由来のみ、それ以外は manifest 由来（従来挙動）。
    const capabilities = verdict.status === 'verified' ? [...verdict.capabilities] : entry.capabilities;

    const def: WorkerModDefinition = {
        id: entityType,
        name: `${fetched.manifest.name ?? modName} - ${entityType.slice(colonIdx + 1)}`,
        workerCode: new TextDecoder().decode(fetchedWorker.bytes),
        capabilities,
        singleton: entry.singleton,
        canvasTargets: entry.canvasTargets,
        watchEntityTypes: entry.watchEntityTypes,
        watchScope: entry.watchScope ?? 'subtree',
        thumbnail: entry.thumbnail,
        mediaTargets: entry.mediaTargets,
        modBase: versionedBase,
    };
    return def;
}

interface FetchedWorker {
    bytes: ArrayBuffer;
    integrity: string;
}

/** worker の生バイト列を取得し integrity を計算する。非 JS content-type は拒否。 */
async function fetchWorkerBytes(workerUrl: string, entityType: string): Promise<FetchedWorker | null> {
    try {
        const res = await fetch(workerUrl);
        if (!res.ok) return null;
        // Vite の SPA fallback で index.html が返ると sandbox の new Function() が壊れるため拒否。
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('javascript') && !ct.includes('text/plain') && ct !== '') {
            console.warn(`[modLoader] worker fetch が非 JS content-type "${ct}" を返した: ${entityType}`);
            return null;
        }
        const bytes = await res.arrayBuffer();
        return { bytes, integrity: await sriOf(bytes) };
    } catch {
        return null;
    }
}

/** テスト / インスタンス離脱時のキャッシュリセット。 */
export function resetModLoaderCaches(): void {
    modIndexCache.clear();
    manifestCache.clear();
}
