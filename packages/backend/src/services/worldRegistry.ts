import fs from 'node:fs';
import path from 'node:path';
import {
    type FederationPeerRecord,
    federationPeerRepository,
    userRepository,
    type WorldRecord,
    worldRepository,
} from '@ubichill/db';
import {
    ENV_KEYS,
    isPublishable,
    LIMITS,
    type ModLock,
    type ResolvedWorld,
    SERVER_CONFIG,
    type WorldDefinition,
    WorldDefinitionSchema,
    type WorldDocument,
    type WorldListItem,
    type WorldSignature,
    type WorldSignatureInvalidReason,
    type WorldSource,
    WorldSourceKind,
} from '@ubichill/shared';
import { customAlphabet } from 'nanoid';
import yaml from 'yaml';
import { isAuthorKey, resolveAuthorDisplayName } from './authorKeyStore';
import { createRemoteWorldCache } from './remoteWorldCache';
import { assertPublicUrl, safeFetch } from './safeFetch';
import { normalizeWorldUrl, resolveBundle, resolveWorldFromUrl, WorldIntegrityError } from './worldResolver';

// KebabCaseId 互換の lowercase + 数字のみ。21文字で十分な衝突耐性を確保。
/** worlds.world_name の列の長さ。 */
const MAX_WORLD_NAME_LENGTH = 50;
const generateWorldId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 21);

// ── システム定数 ──────────────────────────────────────────────────

const SYSTEM_AUTHOR_ID = '00000000-0000-0000-0000-000000000000';

export type WorldResolution =
    | { ok: true; world: ResolvedWorld }
    | { ok: false; reason: 'not-found' | 'integrity'; message: string };

const toResolution = (world: ResolvedWorld | undefined): WorldResolution =>
    world ? { ok: true, world } : { ok: false, reason: 'not-found', message: 'World not found' };

/** 本体が配信するワールドの生の値（署名検証の対象そのもの）。 */
export interface HostedWorldDocument extends WorldDocument {
    lock: unknown;
    signature: unknown;
}

/**
 * 本体にバンドルを保存した結果。
 * - published: 署名が有効で、公開中の版として保存した
 * - unsigned: 署名なしで保存した（公開されない。URL から確認付きで入れる）
 * - draft: 公開中のワールドに署名なしで保存したので、公開中の版は残して下書きとして保存した
 */
export type SaveBundleResult =
    | { ok: true; world: ResolvedWorld; saved: 'published' | 'unsigned' | 'draft' }
    | { ok: false; reason: 'invalid-definition' | 'limit' | WorldSignatureInvalidReason; message: string };

/** YAML の兄弟 JSON（`.lock.json` / `.sig.json`）を生の値で読む。無い・壊れていれば null。 */
function readSiblingJson(worldFilePath: string, ext: string): unknown {
    const siblingPath = worldFilePath.replace(/\.ya?ml$/i, ext);
    if (!fs.existsSync(siblingPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(siblingPath, 'utf-8')) as unknown;
    } catch {
        return null;
    }
}

// ── WorldRegistry ─────────────────────────────────────────────────

/**
 * ワールドレジストリ（URL ネイティブ）
 *
 * - ワールドの一意キーは URL（{@link ResolvedWorld.url}）。
 * - official はイメージにバンドルした `worlds/*.yaml` を worldResolver で解決し `_index`（メモリ）に保持。
 *   worlds.json や起動時の registry seed は使わない（外部ワールドは URL で on-demand 参照する）。
 * - ユーザー作成ワールドは DB に保持（P2 で storage 抽象へ）。
 * - ファイル監視で `worlds/` の YAML 変更を自動反映する。
 *
 * instances/favorites はワールドを URL（{@link ResolvedWorld.url}）で参照するため、
 * official/registry を DB に持つ必要はない（メモリ索引のみ）。
 */
class WorldRegistry {
    private readonly worldsDir: string;

    /** official + registry の解決済みワールド（id=metadata.name → ResolvedWorld） */
    private _index = new Map<string, ResolvedWorld>();
    /** url → id の逆引き（getWorldByUrl を O(1) に） */
    private _urlIndex = new Map<string, string>();
    /**
     * official の配信物（id → ファイルをパースしたままの YAML / lock / 署名）。
     * 作者署名はファイルの生の値に対して付くため、スキーマ既定値で補った値ではなくこれを配信する。
     */
    private _hostedFiles = new Map<string, HostedWorldDocument>();
    /** ローカル id → YAML ファイルパス（reload / watch 用） */
    private _fileByName = new Map<string, string>();
    /** 表示順（in-memory。永続化は ordering→DB の別タスク） */
    private _order: string[] = [];

    /** DB ユーザーワールドの解決キャッシュ */
    private readonly _resolvedCache = new Map<string, ResolvedWorld>();
    /** 外部（他インスタンス/URL）ワールドの解決キャッシュ（連合、TTL 付き） */
    private static readonly REMOTE_TTL_MS = 5 * 60 * 1000;
    /** 取得できなかった外部 URL を取り直さない時間（お気に入りなどで外部への取得を繰り返し起こされないように）。 */
    private static readonly REMOTE_FAILURE_TTL_MS = 60 * 1000;
    private static readonly REMOTE_CACHE_MAX = 2000;
    /** 作者をいま確かめられなかった（pending）ワールドは、すぐ確認し直せるよう短くキャッシュする。 */
    private static readonly REMOTE_PENDING_TTL_MS = 30 * 1000;
    private readonly _remoteCache = createRemoteWorldCache<ResolvedWorld>({
        load: (url) =>
            resolveWorldFromUrl(url, this._externalSource(url), {
                isAuthorKey,
                resolveAuthorName: resolveAuthorDisplayName,
            }),
        isIntegrityError: (err): err is WorldIntegrityError => err instanceof WorldIntegrityError,
        onFailure: (url, err) => console.error(`❌ 外部ワールド解決失敗: ${url}`, err),
        ttlMs: WorldRegistry.REMOTE_TTL_MS,
        ttlFor: (world) =>
            world.identity?.status === 'verified' && world.identity.authorPending
                ? WorldRegistry.REMOTE_PENDING_TTL_MS
                : WorldRegistry.REMOTE_TTL_MS,
        failureTtlMs: WorldRegistry.REMOTE_FAILURE_TTL_MS,
        max: WorldRegistry.REMOTE_CACHE_MAX,
    });

    /** フォロー中の連合ピア（他 ubichill インスタンス） */
    private _peers: FederationPeerRecord[] = [];
    /** ピアごとのワールド一覧キャッシュ（TTL 付き） */
    private readonly _peerWorldCache = new Map<string, { at: number; worlds: WorldListItem[] }>();
    private static readonly PEER_WORLD_TTL_MS = 5 * 60 * 1000;

    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: watcher は起動後も参照保持が必要
    private _watcher: ReturnType<typeof fs.watch> | null = null;
    private readonly _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor() {
        const envWorldsDir = process.env[ENV_KEYS.WORLDS_DIR];
        this.worldsDir = envWorldsDir
            ? path.resolve(envWorldsDir)
            : path.resolve(process.cwd(), SERVER_CONFIG.WORLDS_DIR_DEFAULT);
    }

    // ── URL ヘルパー ─────────────────────────────────────────

    private get _publicBaseUrl(): string {
        return (process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL).replace(/\/$/, '');
    }

    /** 本体がホストするワールドの正規 URL（＝一意キー）。 */
    private selfWorldUrl(id: string): string {
        return `${this._publicBaseUrl}/api/v1/worlds/${id}`;
    }

    private localSource(id: string): WorldSource {
        return { kind: WorldSourceKind.Local, url: this.selfWorldUrl(id), registryName: 'this instance' };
    }

    /**
     * リポジトリ（worlds/）のワールドの正規 URL。静的ファイル（GitHub の raw と同じ形）として配り、
     * 兄弟の `.lock.json` / `.sig.json` も同じ場所に置く（外部ホストと同じ配り方）。
     */
    private repositoryWorldUrl(fileName: string): string {
        return `${this._publicBaseUrl}/api/v1/repository/worlds/${fileName}`;
    }

    // ================================================================
    // 初期化
    // ================================================================

    async initialize(): Promise<void> {
        if (process.env.NODE_ENV === 'production' && !process.env[ENV_KEYS.PUBLIC_BASE_URL]) {
            console.warn(
                `⚠ ${ENV_KEYS.PUBLIC_BASE_URL} が未設定です。ワールドの正規 URL が ${SERVER_CONFIG.DEV_URL} になり連合が壊れます。`,
            );
        }
        await userRepository.ensureSystemUser(SYSTEM_AUTHOR_ID);
        await this._scanLocal();
        this._startWatcher();
        await this._loadPeers();
        console.log('👤 システムユーザーを確認しました');
    }

    /** フォロー中の連合ピアを DB から読み込む。環境変数 WORLDS_FEDERATION_PEERS からの新規追加も行う。 */
    private async _loadPeers(): Promise<void> {
        this._peers = await federationPeerRepository.findAll();
        const envPeers = (process.env.WORLDS_FEDERATION_PEERS ?? '')
            .split(',')
            .map((u) => u.trim().replace(/\/$/, ''))
            .filter((u) => u.startsWith('http'));
        for (const baseUrl of envPeers) {
            const exists = this._peers.some((p) => p.baseUrl === baseUrl);
            if (!exists) {
                try {
                    const peer = await federationPeerRepository.create({ baseUrl });
                    this._peers.push(peer);
                    console.log(`🌐 連合ピアを追加: ${baseUrl}`);
                } catch (err) {
                    console.warn(`⚠ 連合ピア追加失敗 (${baseUrl}):`, err);
                }
            }
        }
    }

    // ================================================================
    // 公開 API
    // ================================================================

    /**
     * ワールド一覧を返す。
     * - `local`: official/registry + ユーザー作成（自インスタンス）
     * - `global`: フォロー中の連合ピアから取得したワールド
     * - `all`: 両方（デフォルト）
     */
    async listWorlds(scope: 'local' | 'global' | 'all' = 'all'): Promise<WorldListItem[]> {
        const localItems = await this._listLocalWorlds();
        if (scope === 'local') return localItems;

        const globalItems = await this._listGlobalWorlds();
        if (scope === 'global') return globalItems;

        return [...localItems, ...globalItems];
    }

    /** 自インスタンスのワールド一覧（署名検証済みのみ。未署名は URL を知っている人だけが入れる）。 */
    private async _listLocalWorlds(): Promise<WorldListItem[]> {
        const allRecords = await worldRepository.findAll();
        const dbRecordByName = new Map<string, WorldRecord>(allRecords.map((r: WorldRecord) => [r.name, r]));

        const indexItems: WorldListItem[] = this._order
            .map((id) => this._index.get(id))
            .filter((w): w is ResolvedWorld => !!w)
            .map((w) => {
                const rec = dbRecordByName.get(w.id);
                return this._toListItem(w, rec);
            });

        const known = new Set(this._index.keys());
        const userRecords = allRecords.filter((r: WorldRecord) => !known.has(r.name));
        const dbItems = await Promise.all(
            userRecords.map(async (r: WorldRecord) => {
                const resolved = await this.getWorld(r.name);
                return resolved ? [this._toListItem(resolved, r)] : [];
            }),
        );

        return [...indexItems, ...dbItems.flat()].filter((w) => isPublishable(w.identity));
    }

    /**
     * 連合ピアから取得したワールド一覧。ピアの自己申告は信用せず、各ワールドを自分で取得・検証し
     * 署名検証できたものだけを返す（検証結果は外部ワールドの TTL キャッシュに乗る）。
     */
    private async _listGlobalWorlds(): Promise<WorldListItem[]> {
        const results = await Promise.allSettled(this._peers.map((peer) => this._fetchPeerWorlds(peer)));
        const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        const verified = await Promise.all(
            items.map(async (item): Promise<WorldListItem | null> => {
                const resolution = await this._resolveRemote(normalizeWorldUrl(item.url));
                if (!resolution.ok || !isPublishable(resolution.world.identity)) return null;
                // 作者名・識別はピアの自己申告ではなく、自分で解決した値を使う
                return { ...item, identity: resolution.world.identity, authorName: resolution.world.authorName };
            }),
        );
        return verified.filter((w): w is WorldListItem => w !== null);
    }

    /** 単一ピアのワールド一覧を取得する。キャッシュが有効ならそれを返す。 */
    private async _fetchPeerWorlds(peer: FederationPeerRecord): Promise<WorldListItem[]> {
        const cached = this._peerWorldCache.get(peer.baseUrl);
        if (cached && Date.now() - cached.at < WorldRegistry.PEER_WORLD_TTL_MS) {
            return cached.worlds;
        }
        try {
            const res = await safeFetch(`${peer.baseUrl}/api/v1/worlds`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) {
                console.warn(`⚠ ピア ${peer.baseUrl} からの一覧取得失敗: HTTP ${res.status}`);
                return cached?.worlds ?? [];
            }
            const data = (await res.json()) as { worlds?: WorldListItem[] };
            // identity はピアの自己申告で検証していないため落とす（入室/詳細の解決時に検証する）。
            const worlds = (data.worlds ?? []).map(({ identity: _unverified, ...w }) => ({
                ...w,
                source: { kind: WorldSourceKind.RemoteInstance, url: w.url, originInstance: peer.baseUrl },
            }));
            this._peerWorldCache.set(peer.baseUrl, { at: Date.now(), worlds });
            return worlds;
        } catch (err) {
            console.warn(`⚠ ピア ${peer.baseUrl} との通信失敗:`, err);
            return cached?.worlds ?? [];
        }
    }

    /**
     * 単一ワールドをフル解決して返す。
     * official/registry はメモリ索引、ユーザー作成は DB から。
     * @param worldId ワールド id（metadata.name）
     */
    async getWorld(worldId: string): Promise<ResolvedWorld | undefined> {
        const indexed = this._index.get(worldId);
        if (indexed) return indexed;

        if (this._resolvedCache.has(worldId)) return this._resolvedCache.get(worldId);

        const record = await worldRepository.findByName(worldId);
        const resolved = record ? await this._resolveWorld(record) : undefined;
        if (resolved) this._resolvedCache.set(worldId, resolved);
        return resolved;
    }

    async hasWorld(worldId: string): Promise<boolean> {
        if (this._index.has(worldId)) return true;
        return !!(await worldRepository.findByName(worldId));
    }

    /**
     * id または URL でワールドを解決する。instance 作成の入口。
     * - `http(s)://` → URL 解決（自ホスト or 外部＝連合）
     * - それ以外 → id（メモリ索引 or DB）
     */
    async resolveRef(idOrUrl: string): Promise<ResolvedWorld | undefined> {
        const result = await this.resolveRefDetailed(idOrUrl);
        return result.ok ? result.world : undefined;
    }

    /** {@link resolveRef} の失敗理由付き版。改竄（署名不正）を「見つからない」と区別して利用者に伝える。 */
    async resolveRefDetailed(idOrUrl: string): Promise<WorldResolution> {
        if (!/^https?:\/\//i.test(idOrUrl)) return toResolution(await this.getWorld(idOrUrl));
        const norm = normalizeWorldUrl(idOrUrl);
        const local = this._resolveLocalUrl(norm);
        return local ? toResolution(await local) : this._resolveRemote(norm);
    }

    /**
     * URL（＝ワールドの一意キー）でワールドを取得する。instances/favorites が参照する。
     * official/registry はメモリ索引、自ホストのユーザーワールドは self URL から id を得て DB 解決、
     * 他ホストの URL は on-demand 取得（連合、TTL キャッシュ）。
     */
    async getWorldByUrl(url: string): Promise<ResolvedWorld | undefined> {
        // 人間向け共有 URL（.../world/:id）も受け付ける（機械 URL へ正規化）。
        const result = await this.resolveRefDetailed(url);
        return result.ok ? result.world : undefined;
    }

    /** 自ホストの URL なら解決処理を返す（official はメモリ索引、ユーザー作成は DB）。他ホストは undefined。 */
    private _resolveLocalUrl(norm: string): Promise<ResolvedWorld | undefined> | undefined {
        const indexedId = this._urlIndex.get(norm);
        if (indexedId) return Promise.resolve(this._index.get(indexedId));
        const selfId = this._idFromSelfUrl(norm);
        return selfId ? this.getWorld(selfId) : undefined;
    }

    /** self URL（自ホストの `.../api/v1/worlds/{id}`、旧 `.../{id}/yaml` 可）から id を取り出す。他ホストは undefined。 */
    private _idFromSelfUrl(url: string): string | undefined {
        try {
            const u = new URL(url);
            if (u.origin !== new URL(this._publicBaseUrl).origin) return undefined;
            const m = /^\/api\/v1\/worlds\/(.+?)(?:\/yaml)?$/.exec(u.pathname);
            return m?.[1];
        } catch {
            return undefined;
        }
    }

    /** 外部（他インスタンス/任意 URL）のワールドをその場で解決する（連合）。TTL キャッシュ（失敗も短時間）。 */
    private _resolveRemote(url: string): Promise<WorldResolution> {
        return this._remoteCache.resolve(url);
    }

    /** 外部 URL から provenance（source）を推定する。 */
    private _externalSource(url: string): WorldSource {
        try {
            const u = new URL(url);
            if (/^\/api\/v1\/worlds\//.test(u.pathname)) {
                return { kind: WorldSourceKind.RemoteInstance, url, originInstance: u.origin };
            }
            if (u.hostname.includes('github')) return { kind: WorldSourceKind.GitHub, url };
        } catch {
            // fallthrough
        }
        return { kind: WorldSourceKind.Url, url };
    }

    /** 内部用：生の DB レコードを取得 */
    async getWorldRecord(worldId: string): Promise<WorldRecord | undefined> {
        return worldRepository.findByName(worldId);
    }

    /**
     * 本体が配信するワールドの実体（YAML / lock / 署名の生の値）。URL 配信・フェデレーション用。
     * `/worlds/:id`(YAML)・`/lock`・`/sig` は必ずこれを返すこと（署名検証の対象と一致させるため）。
     */
    async getHostedDocument(worldId: string): Promise<HostedWorldDocument | undefined> {
        const file = this._hostedFiles.get(worldId);
        if (file) return file;
        const record = await worldRepository.findByName(worldId);
        return record
            ? { definition: record.definition, lock: record.lock ?? null, signature: record.signature ?? null }
            : undefined;
    }

    // ---- 連合ピア管理（フォロー） ----------------------------------

    /** 他 ubichill インスタンスをフォローする。 */
    async followPeer(baseUrl: string, displayName?: string): Promise<FederationPeerRecord> {
        const normalized = baseUrl.trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(normalized)) {
            throw new Error('baseUrl は http:// または https:// で始まる必要があります');
        }
        // SSRF 対策: 内部/loopback/メタデータ等のホストはフォロー登録させない。
        await assertPublicUrl(normalized);
        const existing = await federationPeerRepository.findByBaseUrl(normalized);
        if (existing) return existing;
        const peer = await federationPeerRepository.create({ baseUrl: normalized, displayName });
        this._peers.push(peer);
        return peer;
    }

    /** フォローを解除する。 */
    async unfollowPeer(peerId: string): Promise<boolean> {
        const success = await federationPeerRepository.delete(peerId);
        if (success) {
            this._peers = this._peers.filter((p) => p.id !== peerId);
            this._peerWorldCache.delete(peerId);
        }
        return success;
    }

    /** フォロー中のピア一覧を返す。 */
    async listPeers(): Promise<FederationPeerRecord[]> {
        return [...this._peers];
    }

    // ---- CRUD（ユーザー操作） ----------------------------------------

    /**
     * 作者のバンドル（world 定義・lock・署名の生の値）を本体に保存する。**ホストは中身を書き換えない**（metadata.name も）。
     * 外部に置くワールドと同じく、作者 + metadata.name でワールドを区別し、同じ作者・同じ名前なら同じワールドの更新になる。
     * - 署名あり: {@link resolveBundle} で外部と同じ規則で検証し、通れば公開中の版として保存する（下書きは消す）
     * - 署名なし: 公開中（署名が有効）のワールドなら、公開中の版は残して下書きとして保存する（黙って非公開にしない）。
     *   そうでなければ署名なしのまま保存する（公開されない）
     */
    async saveBundle(
        authorId: string,
        bundle: { definition: unknown; lock: unknown; signature?: unknown },
    ): Promise<SaveBundleResult> {
        const parsed = WorldDefinitionSchema.safeParse(bundle.definition);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return {
                ok: false,
                reason: 'invalid-definition',
                message: `ワールドの定義が不正です: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
            };
        }
        const worldName = parsed.data.metadata.name;
        if (worldName.length === 0 || worldName.length > MAX_WORLD_NAME_LENGTH) {
            return {
                ok: false,
                reason: 'invalid-definition',
                message: `metadata.name は 1〜${MAX_WORLD_NAME_LENGTH} 文字にしてください`,
            };
        }
        const lock = bundle.lock === undefined ? null : bundle.lock;
        const existing = await worldRepository.findByAuthorAndWorldName(authorId, worldName);
        if (!existing && (await worldRepository.countByAuthorId(authorId)) >= LIMITS.MAX_WORLDS_PER_USER) {
            return {
                ok: false,
                reason: 'limit',
                message: `1ユーザーが作成できるワールドは ${LIMITS.MAX_WORLDS_PER_USER} 個までです`,
            };
        }
        const urlId = existing?.name ?? generateWorldId();

        const verified =
            bundle.signature === undefined
                ? undefined
                : await resolveBundle(
                      { definition: bundle.definition, lock, signature: bundle.signature },
                      this.selfWorldUrl(urlId),
                      this.localSource(urlId),
                      { isAuthorKey, resolveAuthorName: resolveAuthorDisplayName, authorId },
                  ).then(
                      ({ resolved }) => resolved.identity,
                      (err: unknown) => {
                          if (err instanceof WorldIntegrityError) return err;
                          throw err;
                      },
                  );
        if (verified instanceof WorldIntegrityError) {
            return { ok: false, reason: verified.reason, message: verified.message };
        }
        if (verified && verified.status !== 'verified') {
            return { ok: false, reason: 'malformed', message: '署名を確認できません' };
        }

        const published = existing ? await this.getWorld(existing.name) : undefined;
        const keepPublished = !verified && published?.identity?.status === 'verified';
        // 公開中の版に署名し直しただけなら下書きは残す
        const keepDraft = !!verified && verified.contentHash === published?.identity?.contentHash;
        const fields = keepPublished
            ? {
                  draftDefinition: bundle.definition as WorldDefinition,
                  draftLock: lock as ModLock | null,
                  draftUpdatedAt: new Date(),
              }
            : {
                  version: parsed.data.metadata.version,
                  definition: bundle.definition as WorldDefinition,
                  lock: lock as ModLock | null,
                  signature: (bundle.signature as WorldSignature | undefined) ?? null,
                  ...(keepDraft ? {} : { draftDefinition: null, draftLock: null, draftUpdatedAt: null }),
              };
        const record = existing
            ? await worldRepository.update(existing.id, fields)
            : await worldRepository.create({
                  authorId,
                  name: urlId,
                  worldName,
                  version: parsed.data.metadata.version,
                  definition: bundle.definition as WorldDefinition,
                  lock: lock as ModLock | null,
                  signature: (bundle.signature as WorldSignature | undefined) ?? null,
              });
        if (!record) return { ok: false, reason: 'invalid-definition', message: 'ワールドを保存できませんでした' };
        this._resolvedCache.delete(urlId);
        const world = await this.getWorld(urlId);
        if (!world) return { ok: false, reason: 'invalid-definition', message: 'ワールドを読み込めませんでした' };
        return {
            ok: true,
            world,
            saved: keepPublished ? 'draft' : bundle.signature !== undefined ? 'published' : 'unsigned',
        };
    }

    // NOTE: 外部/リモートのワールドは DB にコピーしない（＝連合は参照のみ）。
    // 単発で入るなら resolveRef(URL)→instance 作成、永続的に見たいならピアをフォローする。

    /** エディタ用: 下書きがあれば下書き、無ければ本体の定義と、公開状態。 */
    async getEditorDefinition(
        worldId: string,
    ): Promise<{ definition: WorldDefinition; hasDraft: boolean; published: boolean } | undefined> {
        const record = await worldRepository.findByName(worldId);
        if (!record) return undefined;
        const world = await this.getWorld(worldId);
        return {
            definition: (record.draftDefinition ?? record.definition) as WorldDefinition,
            hasDraft: !!record.draftDefinition,
            published: isPublishable(world?.identity),
        };
    }

    async deleteWorld(worldId: string): Promise<boolean> {
        const existing = await worldRepository.findByName(worldId);
        if (!existing) return false;
        const success = await worldRepository.delete(existing.id);
        if (success) this._resolvedCache.delete(worldId);
        return success;
    }

    /** 全件リロード（緊急用・SIGUSR2 などから呼ばれる） */
    async reloadWorlds(): Promise<void> {
        this._resolvedCache.clear();
        await this._scanLocal();
        console.log('✅ ワールド定義を全件再読み込みしました');
    }

    /** 特定ワールドのみリロード（API から呼ばれる） */
    async reloadWorld(worldId: string): Promise<boolean> {
        const file = this._fileByName.get(worldId);
        if (!file) return false;
        await this._onYamlChanged(path.basename(file));
        return true;
    }

    /** ワールドの表示順を変更する（in-memory）。 */
    async reorderWorlds(order: string[]): Promise<void> {
        const known = new Set(this._order);
        const filtered = order.filter((n) => known.has(n));
        const rest = this._order.filter((n) => !filtered.includes(n));
        this._order = [...filtered, ...rest];
    }

    // ================================================================
    // プライベート: ローカルスキャン
    // ================================================================

    private async _scanLocal(): Promise<void> {
        this._index.clear();
        this._urlIndex.clear();
        this._hostedFiles.clear();
        this._fileByName.clear();
        const nextOrder: string[] = [];
        if (!fs.existsSync(this.worldsDir)) {
            this._order = nextOrder;
            return;
        }
        const files = fs.readdirSync(this.worldsDir).filter((f) => /\.(ya?ml)$/.test(f));
        for (const file of files) {
            const filePath = path.join(this.worldsDir, file);
            const resolved = await this._indexLocalFile(filePath);
            if (resolved) nextOrder.push(resolved.id);
        }
        // 既存の順序を優先しつつ新規を末尾へ
        const prev = new Map(this._order.map((id, i) => [id, i]));
        nextOrder.sort((a, b) => (prev.get(a) ?? 999) - (prev.get(b) ?? 999));
        this._order = nextOrder;
        console.log(`📋 ローカル worlds/ から ${this._index.size} ワールドを読み込みました`);
    }

    /**
     * リポジトリ（worlds/）の 1 つのワールドを解決してメモリ索引に載せる（DB 非依存）。失敗時は undefined。
     * 静的ファイルとして配るバンドル（YAML と兄弟の lock・署名）を、外部のワールドと同じ {@link resolveBundle} で検証する。
     * ファイルから読むのは取得の方法だけで、信用の規則は外部と同じ（特別な信用はしない）。
     */
    private async _indexLocalFile(filePath: string): Promise<ResolvedWorld | undefined> {
        try {
            const fileName = path.basename(filePath);
            const hosted: HostedWorldDocument = {
                definition: yaml.parse(fs.readFileSync(filePath, 'utf-8')) as unknown,
                lock: readSiblingJson(filePath, '.lock.json'),
                signature: readSiblingJson(filePath, '.sig.json'),
            };
            const url = this.repositoryWorldUrl(fileName);
            const { resolved } = await resolveBundle(
                hosted,
                url,
                { kind: WorldSourceKind.Local, url, registryName: 'this instance' },
                {
                    isAuthorKey,
                    resolveAuthorName: resolveAuthorDisplayName,
                    authorId: SYSTEM_AUTHOR_ID,
                },
            );
            const id = resolved.id;
            this._index.set(id, resolved);
            this._urlIndex.set(url, id);
            this._hostedFiles.set(id, hosted);
            this._fileByName.set(id, filePath);
            return resolved;
        } catch (err) {
            console.error(`❌ リポジトリのワールドを読み込めません（配信しません）: ${filePath}`, err);
            return undefined;
        }
    }

    /** リポジトリのワールドの静的ファイル（`/api/v1/repository/worlds/<file>`）。YAML と兄弟の lock・署名だけを、置いてあるとおりに返す。 */
    repositoryFile(fileName: string): { path: string; contentType: string } | undefined {
        const m = /^([a-z0-9-]+)\.(yaml|yml|lock\.json|sig\.json)$/.exec(fileName);
        if (!m) return undefined;
        const filePath = path.join(this.worldsDir, fileName);
        if (!fs.existsSync(filePath)) return undefined;
        const contentType =
            m[2] === 'yaml' || m[2] === 'yml' ? 'application/yaml; charset=utf-8' : 'application/json; charset=utf-8';
        return { path: filePath, contentType };
    }

    // ================================================================
    // プライベート: ファイル監視
    // ================================================================

    private _startWatcher(): void {
        if (!fs.existsSync(this.worldsDir)) return;
        this._watcher = fs.watch(this.worldsDir, (_event, filename) => {
            if (!filename) return;

            // A world lock is intentionally stored next to (not inside) its YAML.
            // Re-index the YAML when either half changes so a running dev backend
            // never keeps serving worker URLs from the previous build.
            let yamlFilename: string | undefined;
            if (/\.ya?ml$/.test(filename)) {
                yamlFilename = filename;
            } else {
                const sibling = /\.(lock|sig)\.json$/.exec(filename);
                if (sibling) {
                    const ext = `.${sibling[1]}.json`;
                    const trackedFile = [...this._fileByName.values()].find(
                        (filePath) => path.basename(filePath).replace(/\.ya?ml$/i, ext) === filename,
                    );
                    yamlFilename = trackedFile ? path.basename(trackedFile) : filename.replace(ext, '.yaml');
                }
            }
            if (!yamlFilename) return;

            const key = yamlFilename;
            const prev = this._debounceTimers.get(key);
            if (prev) clearTimeout(prev);
            this._debounceTimers.set(
                key,
                setTimeout(() => {
                    this._debounceTimers.delete(key);
                    void this._onYamlChanged(yamlFilename);
                }, 300),
            );
        });
        console.log('👁  worlds/ の YAML / lock / sig を監視中（変更時に自動リロード）');
    }

    private async _onYamlChanged(filename: string): Promise<void> {
        const filePath = path.join(this.worldsDir, filename);

        // ファイル削除
        if (!fs.existsSync(filePath)) {
            const id = [...this._fileByName.entries()].find(([, f]) => path.basename(f) === filename)?.[0];
            if (id) {
                this._urlIndex.delete(this.selfWorldUrl(id));
                this._index.delete(id);
                this._hostedFiles.delete(id);
                this._fileByName.delete(id);
                this._order = this._order.filter((n) => n !== id);
                console.log(`🗑  ワールド削除を検知: ${id}`);
            }
            return;
        }

        const resolved = await this._indexLocalFile(filePath);
        if (!resolved) return;
        if (!this._order.includes(resolved.id)) this._order.push(resolved.id);
        console.log(`✅ ワールド自動リロード: ${resolved.id} (v${resolved.version})`);
    }

    // ================================================================
    // プライベート: 変換ヘルパー
    // ================================================================

    /**
     * DB レコード → ResolvedWorld。外部のワールドと同じく {@link resolveBundle} で検証する（同じ規則）。
     * 署名が内容と一致しない（改竄）なら解決しない（undefined）。作者名は確認できた作者アカウントの表示名。
     */
    private async _resolveWorld(record: WorldRecord): Promise<ResolvedWorld | undefined> {
        try {
            const { resolved } = await resolveBundle(
                { definition: record.definition, lock: record.lock ?? null, signature: record.signature ?? null },
                this.selfWorldUrl(record.name),
                this.localSource(record.name),
                { isAuthorKey, resolveAuthorName: resolveAuthorDisplayName, authorId: record.authorId },
            );
            return { ...resolved, id: record.name };
        } catch (err) {
            console.error(`❌ ワールド ${record.name} を検証できません（配信しません）`, err);
            return undefined;
        }
    }

    /**
     * キャッシュ済みの解決結果（作者表示・作者名・worldId）を捨てる。作者の署名鍵や表示名が変わったときに呼ぶ。
     * official の索引は作者アカウントを持たない（メンテナ鍵のみ）ので対象外。
     */
    invalidateResolvedWorlds(): void {
        this._resolvedCache.clear();
        this._remoteCache.clearWorlds();
    }

    /** 兄弟エンドポイント /worlds/:id/sig 用。保存した署名をそのまま返す（検証は受け取る側が行う）。 */
    async getWorldSignature(worldId: string): Promise<unknown> {
        return (await this.getHostedDocument(worldId))?.signature ?? undefined;
    }

    /**
     * URL（または id）で解決し、公開ルールを満たすときだけ一覧の項目にする（お気に入りなど URL で持つ参照用）。
     * 外部ワールドも自分で取得・検証した結果を使う。満たさなければ undefined。
     */
    async publishableListItem(ref: string): Promise<WorldListItem | undefined> {
        const resolution = await this.resolveRefDetailed(ref);
        if (!resolution.ok || !isPublishable(resolution.world.identity)) return undefined;
        return this._toListItem(resolution.world);
    }

    /**
     * リポジトリ（worlds/）で管理している公式ワールドのうち、作者がこれらの作者アカウントのもの。
     * DB のワールドではないので画面からは編集・削除できない（変更はリポジトリの PR で行う）。
     */
    repositoryWorldsByAuthor(accounts: readonly string[]): ResolvedWorld[] {
        return this._order
            .map((id) => this._index.get(id))
            .filter(
                (w): w is ResolvedWorld =>
                    !!w &&
                    w.identity?.status === 'verified' &&
                    !!w.identity.author &&
                    accounts.includes(w.identity.author),
            );
    }

    /** ResolvedWorld(+DB record) → WorldListItem。 */
    private _toListItem(w: ResolvedWorld, rec?: WorldRecord): WorldListItem {
        return {
            url: w.url,
            source: w.source,
            id: w.id,
            displayName: w.displayName,
            description: w.description,
            thumbnail: w.thumbnail,
            version: w.version,
            capacity: w.capacity,
            authorId: rec?.authorId ?? w.authorId,
            authorName: w.authorName,
            mods: w.mods,
            identity: w.identity,
            createdAt: rec ? rec.createdAt.toISOString() : undefined,
            updatedAt: rec ? rec.updatedAt.toISOString() : undefined,
        };
    }
}

export const worldRegistry = new WorldRegistry();
