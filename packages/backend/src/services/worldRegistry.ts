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
    type ModLock,
    ModLockSchema,
    type ResolvedWorld,
    SERVER_CONFIG,
    verifyWorldSignature,
    type WorldCreateInput,
    type WorldDefinition,
    WorldDefinitionSchema,
    type WorldDocument,
    type WorldIdentity,
    type WorldListItem,
    type WorldSignature,
    type WorldSignatureInvalidReason,
    type WorldSource,
    WorldSourceKind,
    worldContentHash,
} from '@ubichill/shared';
import { customAlphabet } from 'nanoid';
import yaml from 'yaml';
import { resolveAuthorKey } from './authorKeys';
import { assertPublicUrl, safeFetch } from './safeFetch';
import { nodeWorldCrypto } from './worldCrypto';
import { migrateLegacyWorldYaml } from './worldMigration';
import { definitionToResolved, normalizeWorldUrl, resolveWorldFromUrl, WorldIntegrityError } from './worldResolver';

// KebabCaseId 互換の lowercase + 数字のみ。21文字で十分な衝突耐性を確保。
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
    signature: unknown;
}

export type UpdateWorldResult =
    | { ok: true; world: ResolvedWorld }
    | { ok: false; reason: 'not-found' | 'signature-required' | WorldSignatureInvalidReason };

/**
 * 更新後に保存・配信される値を作る（純粋）。作者はこの値に署名する（`POST /worlds/:id/prepare`）。
 * ID を不変にするため metadata.name は worldId に固定し、埋め込み lock は別カラムへ寄せる。
 */
export function prepareWorldUpdate(
    worldId: string,
    definition: WorldDefinition,
    lock?: ModLock | null,
): { definition: WorldDefinition; lock: ModLock | null } {
    const { lock: embeddedLock, ...cleanSpec } = definition.spec;
    return {
        definition: { ...definition, metadata: { ...definition.metadata, name: worldId }, spec: cleanSpec },
        lock: lock ?? embeddedLock ?? null,
    };
}

export type SetSignatureResult =
    | { ok: true; identity: WorldIdentity }
    | { ok: false; reason: 'not-found' | WorldSignatureInvalidReason };

/**
 * 配信物の識別。無効な署名（内容更新後の古い署名など）は配信しないので unsigned として扱う。
 */
async function hostedIdentity(hosted: HostedWorldDocument, label: string): Promise<WorldIdentity> {
    const verdict = await verifyWorldSignature(hosted, hosted.signature, nodeWorldCrypto, resolveAuthorKey);
    if (verdict.status !== 'invalid') return verdict;
    console.warn(`⚠ ワールド ${label} の署名が現在の内容と一致しません (${verdict.reason})。未署名として扱います`);
    return { status: 'unsigned', contentHash: await worldContentHash(hosted, nodeWorldCrypto) };
}

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
    private readonly _remoteCache = new Map<string, { at: number; world: ResolvedWorld }>();
    private static readonly REMOTE_TTL_MS = 5 * 60 * 1000;

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
        await this._migrateLegacyDbRecords();
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
        const dbItems = allRecords
            .filter((r: WorldRecord) => !known.has(r.name))
            .map(async (r: WorldRecord) => this._toListItem(await this._resolveWorld(r), r));

        return [...indexItems, ...(await Promise.all(dbItems))].filter((w) => isPublishable(w.identity));
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
                const identity = resolution.ok ? resolution.world.identity : undefined;
                return isPublishable(identity) ? { ...item, identity } : null;
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
        if (record) {
            const resolved = await this._resolveWorld(record);
            this._resolvedCache.set(worldId, resolved);
            return resolved;
        }
        return undefined;
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

    /** 外部（他インスタンス/任意 URL）のワールドをその場で解決する（連合）。TTL キャッシュ。 */
    private async _resolveRemote(url: string): Promise<WorldResolution> {
        const cached = this._remoteCache.get(url);
        if (cached && Date.now() - cached.at < WorldRegistry.REMOTE_TTL_MS) return { ok: true, world: cached.world };
        try {
            const world = await resolveWorldFromUrl(url, this._externalSource(url));
            this._remoteCache.set(url, { at: Date.now(), world });
            return { ok: true, world };
        } catch (err) {
            console.error(`❌ 外部ワールド解決失敗: ${url}`, err);
            // 改竄を検知したら以前の検証済みキャッシュでも使い続けない（配信元が侵害されている）。
            if (err instanceof WorldIntegrityError) {
                this._remoteCache.delete(url);
                return { ok: false, reason: 'integrity', message: err.message };
            }
            return toResolution(cached?.world);
        }
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

    async createWorld(authorId: string, definition: WorldDefinition, lock?: ModLock | null): Promise<ResolvedWorld> {
        const record = await worldRepository.create({
            authorId,
            name: definition.metadata.name,
            version: definition.metadata.version,
            definition,
            lock: lock ?? null,
        });
        const resolved = await this._resolveWorld(record);
        this._resolvedCache.set(resolved.id, resolved);
        return resolved;
    }

    /**
     * フォーム入力からワールドを作成する。
     * metadata.name はサーバー側で nanoid 生成、author はセッションのユーザー名で補完。
     */
    async createFromInput(
        authorId: string,
        authorDisplayName: string,
        input: WorldCreateInput,
    ): Promise<ResolvedWorld> {
        const definition: WorldDefinition = {
            apiVersion: 'ubichill.com/v1alpha1',
            kind: 'World',
            metadata: {
                name: generateWorldId(),
                version: '1.0.0',
                author: { name: authorDisplayName },
            },
            spec: input,
        };
        return this.createWorld(authorId, definition);
    }

    /**
     * YAML テキストからワールドを作成する。
     * metadata.name は無視してサーバー側で再生成し、所有権を作成者に紐付ける。
     */
    async createFromYaml(
        authorId: string,
        authorDisplayName: string,
        yamlText: string,
        lock?: ModLock | null,
    ): Promise<ResolvedWorld> {
        const parsed = migrateLegacyWorldYaml(yaml.parse(yamlText) as unknown);
        const result = WorldDefinitionSchema.safeParse(parsed);
        if (!result.success) {
            const issue = result.error.issues[0];
            throw new Error(`YAML が不正です: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`);
        }
        // 人間が書く definition と lock は分離保存する。埋め込み spec.lock が来ても
        // 別カラム保存へ寄せ、definition からは落とす（fallback は別配信できない外部用）。
        const { lock: embeddedLock, ...cleanSpec } = result.data.spec;
        const def: WorldDefinition = {
            ...result.data,
            metadata: {
                ...result.data.metadata,
                name: generateWorldId(),
                author: result.data.metadata.author ?? { name: authorDisplayName },
            },
            spec: cleanSpec,
        };
        return this.createWorld(authorId, def, lock ?? embeddedLock ?? null);
    }

    // NOTE: 外部/リモートのワールドは DB にコピーしない（＝連合は参照のみ）。
    // 単発で入るなら resolveRef(URL)→instance 作成、永続的に見たいならピアをフォローする。

    /**
     * ユーザー作成ワールドを更新する。内容が変わると以前の署名は無効になるため、
     * - `signature` があれば新しい内容に対して検証し、通れば内容と一緒に保存する（不正なら何も保存しない）
     * - 無ければ未署名で保存するが、署名済みワールドを黙って未署名にしないよう `allowUnsigned` を要求する
     */
    async updateWorld(
        worldId: string,
        definition: WorldDefinition,
        lock?: ModLock | null,
        options: { signature?: unknown; allowUnsigned?: boolean } = {},
    ): Promise<UpdateWorldResult> {
        const existing = await worldRepository.findByName(worldId);
        if (!existing) return { ok: false, reason: 'not-found' };
        const next = prepareWorldUpdate(worldId, definition, lock);

        if (options.signature !== undefined) {
            const verdict = await verifyWorldSignature(next, options.signature, nodeWorldCrypto);
            if (verdict.status !== 'verified') {
                return { ok: false, reason: verdict.status === 'invalid' ? verdict.reason : 'malformed' };
            }
        } else if (!options.allowUnsigned) {
            const current = await this.getWorld(worldId);
            if (isPublishable(current?.identity)) return { ok: false, reason: 'signature-required' };
        }

        const updated = await worldRepository.update(existing.id, {
            version: next.definition.metadata.version,
            definition: next.definition,
            lock: next.lock,
            signature: (options.signature as WorldSignature | undefined) ?? null,
        });
        if (!updated) return { ok: false, reason: 'not-found' };
        const resolved = await this._resolveWorld(updated);
        this._resolvedCache.set(worldId, resolved);
        return { ok: true, world: resolved };
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

    /** 1 つのローカル YAML を解決してメモリ索引に載せる（DB 非依存）。失敗時は undefined。 */
    private async _indexLocalFile(filePath: string): Promise<ResolvedWorld | undefined> {
        try {
            const rawDefinition = yaml.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
            const parsed = migrateLegacyWorldYaml(rawDefinition);
            const result = WorldDefinitionSchema.safeParse(parsed);
            if (!result.success) {
                console.warn(`⚠  ${path.basename(filePath)}: バリデーションエラー（スキップ）`);
                return undefined;
            }
            const def = result.data;
            const id = def.metadata.name;
            // 兄弟 `<name>.lock.json` / `<name>.sig.json` があれば読み込む（分離方針＝YAML には埋めない）。
            const hosted: HostedWorldDocument = {
                definition: rawDefinition,
                lock: readSiblingJson(filePath, '.lock.json'),
                signature: readSiblingJson(filePath, '.sig.json'),
            };
            const lock = ModLockSchema.safeParse(hosted.lock);
            // official ワールドは DB に持たずメモリ索引のみ（DB 依存の排除）
            const resolved = definitionToResolved(parsed, this.selfWorldUrl(id), this.localSource(id), {
                authorId: SYSTEM_AUTHOR_ID,
                lock: lock.success ? lock.data : undefined,
                identity: await hostedIdentity(hosted, id),
            });
            this._index.set(id, resolved);
            this._urlIndex.set(resolved.url, id);
            this._hostedFiles.set(id, hosted);
            this._fileByName.set(id, filePath);
            return resolved;
        } catch (err) {
            console.error(`❌ ローカルワールド読み込み失敗: ${filePath}`, err);
            return undefined;
        }
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

    private async _migrateLegacyDbRecords(): Promise<void> {
        const all = await worldRepository.findAll();
        let migrated = 0;
        for (const record of all) {
            // 署名済みを書き換えると署名が黙って無効になる。読み出し時にも同じマイグレーションが
            // 掛かる（validateWorldDefinition）ので、保存値は作者が署名した値のまま残す。
            if (record.signature) continue;
            const next = migrateLegacyWorldYaml(record.definition);
            if (next === record.definition) continue;
            const parsed = WorldDefinitionSchema.safeParse(next);
            if (!parsed.success) {
                console.warn(`⚠️ DB ワールド「${record.name}」のマイグレーション失敗 (skip):`, parsed.error.issues[0]);
                continue;
            }
            await worldRepository.update(record.id, { version: record.version, definition: parsed.data });
            migrated += 1;
        }
        if (migrated > 0) {
            console.log(`🛠 DB ワールド ${migrated} 件を新スキーマへマイグレーションしました`);
        }
    }

    /** DB レコード → ResolvedWorld（ユーザー作成ワールド。source=local self URL）。 */
    private async _resolveWorld(record: WorldRecord): Promise<ResolvedWorld> {
        const def = record.definition as WorldDefinition;
        return {
            ...definitionToResolved(def, this.selfWorldUrl(record.name), this.localSource(record.name), {
                authorId: record.authorId,
                lock: record.lock ?? undefined,
                identity: await hostedIdentity(
                    { definition: def, lock: record.lock ?? null, signature: record.signature ?? null },
                    record.name,
                ),
            }),
            id: record.name,
        };
    }

    /**
     * キャッシュ済みの識別結果（作者表示・worldId）を捨てる。作者の署名鍵が変わったときに呼ぶ。
     * official の索引は作者アカウントを持たない（メンテナ鍵のみ）ので対象外。
     */
    invalidateIdentities(): void {
        this._resolvedCache.clear();
        this._remoteCache.clear();
    }

    /** 兄弟エンドポイント /worlds/:id/sig 用。現在の内容に対して有効な作者署名だけを返す。 */
    async getWorldSignature(worldId: string): Promise<WorldSignature | undefined> {
        const hosted = await this.getHostedDocument(worldId);
        if (!hosted) return undefined;
        const verdict = await verifyWorldSignature(hosted, hosted.signature, nodeWorldCrypto);
        return verdict.status === 'verified' ? (hosted.signature as WorldSignature) : undefined;
    }

    /**
     * ユーザー作成ワールドに作者署名を付ける。サーバーは鍵を持たず、現在の内容に対して
     * 有効な署名だけを保存する（内容を更新すると {@link updateWorld} が署名を外す）。
     */
    async setWorldSignature(worldId: string, rawSignature: unknown): Promise<SetSignatureResult> {
        const record = await worldRepository.findByName(worldId);
        if (!record) return { ok: false, reason: 'not-found' };
        const doc: WorldDocument = { definition: record.definition, lock: record.lock ?? null };
        const verdict = await verifyWorldSignature(doc, rawSignature, nodeWorldCrypto, resolveAuthorKey);
        if (verdict.status !== 'verified') {
            return { ok: false, reason: verdict.status === 'invalid' ? verdict.reason : 'malformed' };
        }
        const updated = await worldRepository.update(record.id, { signature: rawSignature as WorldSignature });
        if (!updated) return { ok: false, reason: 'not-found' };
        const resolved = await this._resolveWorld(updated);
        this._resolvedCache.set(worldId, resolved);
        return { ok: true, identity: verdict };
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
