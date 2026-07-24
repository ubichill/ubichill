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
    type ResolvedWorld,
    SERVER_CONFIG,
    type WorldCreateInput,
    type WorldDefinition,
    WorldDefinitionSchema,
    type WorldListItem,
    type WorldSource,
    WorldSourceKind,
} from '@ubichill/shared';
import { customAlphabet } from 'nanoid';
import yaml from 'yaml';
import { assertPublicUrl, safeFetch } from './safeFetch';
import { migrateLegacyWorldYaml } from './worldMigration';
import { definitionToResolved, normalizeWorldUrl, resolveWorldFromUrl } from './worldResolver';

// KebabCaseId 互換の lowercase + 数字のみ。21文字で十分な衝突耐性を確保。
const generateWorldId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 21);

// ── システム定数 ──────────────────────────────────────────────────

const SYSTEM_AUTHOR_ID = '00000000-0000-0000-0000-000000000000';

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
    /** official + registry の生定義（id → WorldDefinition）。URL 配信/フェデレーション用 */
    private _defByName = new Map<string, WorldDefinition>();
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

    /** 自インスタンスのワールド一覧。 */
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
        const dbItems: WorldListItem[] = allRecords
            .filter((r: WorldRecord) => !known.has(r.name))
            .map((r: WorldRecord) => this._toListItem(this._resolveWorld(r), r));

        return [...indexItems, ...dbItems];
    }

    /** 連合ピアから取得したワールド一覧。メモリキャッシュ（TTL）付き。 */
    private async _listGlobalWorlds(): Promise<WorldListItem[]> {
        const results = await Promise.allSettled(this._peers.map((peer) => this._fetchPeerWorlds(peer)));
        return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
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
            const worlds = (data.worlds ?? []).map((w) => ({
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
            const resolved = this._resolveWorld(record);
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
        return /^https?:\/\//i.test(idOrUrl) ? this.getWorldByUrl(idOrUrl) : this.getWorld(idOrUrl);
    }

    /**
     * URL（＝ワールドの一意キー）でワールドを取得する。instances/favorites が参照する。
     * official/registry はメモリ索引、自ホストのユーザーワールドは self URL から id を得て DB 解決、
     * 他ホストの URL は on-demand 取得（連合、TTL キャッシュ）。
     */
    async getWorldByUrl(url: string): Promise<ResolvedWorld | undefined> {
        // 人間向け共有 URL（.../world/:id）も受け付ける（機械 URL へ正規化）。
        const norm = normalizeWorldUrl(url);
        const indexedId = this._urlIndex.get(norm);
        if (indexedId) return this._index.get(indexedId);
        const selfId = this._idFromSelfUrl(norm);
        if (selfId) return this.getWorld(selfId);
        return this._resolveRemote(norm);
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
    private async _resolveRemote(url: string): Promise<ResolvedWorld | undefined> {
        const cached = this._remoteCache.get(url);
        if (cached && Date.now() - cached.at < WorldRegistry.REMOTE_TTL_MS) return cached.world;
        try {
            const world = await resolveWorldFromUrl(url, this._externalSource(url));
            this._remoteCache.set(url, { at: Date.now(), world });
            return world;
        } catch (err) {
            console.error(`❌ 外部ワールド解決失敗: ${url}`, err);
            return cached?.world;
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
     * ワールドの生定義（WorldDefinition）を返す。URL 配信・フェデレーション用。
     * official/registry はメモリの生定義、ユーザー作成は DB レコードから。
     */
    async getWorldDefinition(worldId: string): Promise<WorldDefinition | undefined> {
        const mem = this._defByName.get(worldId);
        if (mem) return mem;
        const record = await worldRepository.findByName(worldId);
        return record ? (record.definition as WorldDefinition) : undefined;
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

    async createWorld(authorId: string, definition: WorldDefinition): Promise<ResolvedWorld> {
        const record = await worldRepository.create({
            authorId,
            name: definition.metadata.name,
            version: definition.metadata.version,
            definition,
        });
        const resolved = this._resolveWorld(record);
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
    async createFromYaml(authorId: string, authorDisplayName: string, yamlText: string): Promise<ResolvedWorld> {
        const parsed = migrateLegacyWorldYaml(yaml.parse(yamlText) as unknown);
        const result = WorldDefinitionSchema.safeParse(parsed);
        if (!result.success) {
            const issue = result.error.issues[0];
            throw new Error(`YAML が不正です: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`);
        }
        const def: WorldDefinition = {
            ...result.data,
            metadata: {
                ...result.data.metadata,
                name: generateWorldId(),
                author: result.data.metadata.author ?? { name: authorDisplayName },
            },
        };
        return this.createWorld(authorId, def);
    }

    // NOTE: 外部/リモートのワールドは DB にコピーしない（＝連合は参照のみ）。
    // 単発で入るなら resolveRef(URL)→instance 作成、永続的に見たいならピアをフォローする。

    async updateWorld(worldId: string, definition: WorldDefinition): Promise<ResolvedWorld | undefined> {
        const existing = await worldRepository.findByName(worldId);
        if (!existing) return undefined;
        const updated = await worldRepository.update(existing.id, {
            version: definition.metadata.version,
            definition,
        });
        if (!updated) return undefined;
        const resolved = this._resolveWorld(updated);
        this._resolvedCache.set(worldId, resolved);
        return resolved;
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
        this._defByName.clear();
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
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = migrateLegacyWorldYaml(yaml.parse(content) as unknown);
            const result = WorldDefinitionSchema.safeParse(parsed);
            if (!result.success) {
                console.warn(`⚠  ${path.basename(filePath)}: バリデーションエラー（スキップ）`);
                return undefined;
            }
            const def = result.data;
            const id = def.metadata.name;
            // official ワールドは DB に持たずメモリ索引のみ（DB 依存の排除）
            const resolved = definitionToResolved(parsed, this.selfWorldUrl(id), this.localSource(id), {
                authorId: SYSTEM_AUTHOR_ID,
            });
            this._index.set(id, resolved);
            this._urlIndex.set(resolved.url, id);
            this._defByName.set(id, def);
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
            if (!filename || !/\.(ya?ml)$/.test(filename)) return;
            const key = filename;
            const prev = this._debounceTimers.get(key);
            if (prev) clearTimeout(prev);
            this._debounceTimers.set(
                key,
                setTimeout(() => {
                    this._debounceTimers.delete(key);
                    void this._onYamlChanged(filename);
                }, 300),
            );
        });
        console.log('👁  worlds/ を監視中（変更時に自動リロード）');
    }

    private async _onYamlChanged(filename: string): Promise<void> {
        const filePath = path.join(this.worldsDir, filename);

        // ファイル削除
        if (!fs.existsSync(filePath)) {
            const id = [...this._fileByName.entries()].find(([, f]) => path.basename(f) === filename)?.[0];
            if (id) {
                this._urlIndex.delete(this.selfWorldUrl(id));
                this._index.delete(id);
                this._defByName.delete(id);
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
    private _resolveWorld(record: WorldRecord): ResolvedWorld {
        const def = record.definition as WorldDefinition;
        return {
            ...definitionToResolved(def, this.selfWorldUrl(record.name), this.localSource(record.name), {
                authorId: record.authorId,
            }),
            id: record.name,
        };
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
            createdAt: rec ? rec.createdAt.toISOString() : undefined,
            updatedAt: rec ? rec.updatedAt.toISOString() : undefined,
        };
    }
}

export const worldRegistry = new WorldRegistry();
