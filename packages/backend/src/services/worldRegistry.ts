import fs from 'node:fs';
import path from 'node:path';
import { userRepository, type WorldRecord, worldRepository } from '@ubichill/db';
import {
    DEFAULTS,
    ENV_KEYS,
    type ResolvedWorld,
    SERVER_CONFIG,
    type WorldDefinition,
    WorldDefinitionSchema,
    type WorldListItem,
} from '@ubichill/shared';
import yaml from 'yaml';

// ── システム定数 ──────────────────────────────────────────────────

const SYSTEM_AUTHOR_ID = '00000000-0000-0000-0000-000000000000';

const GITHUB_BLOB_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;

function toRawUrl(url: string): string {
    const m = GITHUB_BLOB_RE.exec(url);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    return url;
}

async function resolveWorldsJsonUrls(jsonUrl: string): Promise<string[]> {
    const res = await fetch(jsonUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const base = jsonUrl.slice(0, jsonUrl.lastIndexOf('/') + 1);
    const index = (await res.json()) as Array<{ file: string }>;
    return index.filter((e) => e.file).map((e) => `${base}${e.file}`);
}

// ── worlds.json インデックス型 ────────────────────────────────────

/**
 * worlds.json の各エントリ。
 * YAML をパースせずにワールド一覧を返すために必要な表示メタデータを保持する。
 */
export type WorldIndexEntry = {
    name: string;
    file: string;
    displayName: string;
    description?: string | null;
    thumbnail?: string | null;
    version: string;
    capacity: { default: number; max: number };
};

// ── WorldRegistry ─────────────────────────────────────────────────

/**
 * ワールドレジストリ（worlds.json インデックス + 遅延ロード版）
 *
 * - worlds.json = 表示用メタデータのインデックス（O(1) 参照・並べ替え対応）
 * - getWorld() = 初回アクセス時のみ YAML をパース（インスタンス作成時など）
 * - ファイル監視 = worlds/ 配下の YAML 変更を自動検知して再ロード（ボタン不要）
 */
class WorldRegistry {
    private readonly worldsDir: string;
    private readonly registryUrls: string[];

    /** worlds.json から構築した name → entry マップ */
    private _fileIndex = new Map<string, WorldIndexEntry>();
    /** worlds.json の表示順 */
    private _order: string[] = [];

    /** フルリゾルブ済みキャッシュ */
    private readonly _resolvedCache = new Map<string, ResolvedWorld>();

    /** ファイル監視ハンドラ（close 用に保持） */
    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: watcher は起動後も参照保持が必要
    private _watcher: ReturnType<typeof fs.watch> | null = null;
    private readonly _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** 外部レジストリの最終取得時刻（レート制限対策） */
    private _lastRegistrySeedAt = 0;
    /** 外部レジストリの最小再取得間隔 ms（デフォルト: 1時間） */
    private static readonly REGISTRY_SEED_INTERVAL_MS = 60 * 60 * 1000;

    constructor() {
        const envWorldsDir = process.env[ENV_KEYS.WORLDS_DIR];
        this.worldsDir = envWorldsDir
            ? path.resolve(envWorldsDir)
            : path.resolve(process.cwd(), SERVER_CONFIG.WORLDS_DIR_DEFAULT);

        const urlsEnv = process.env[ENV_KEYS.WORLDS_REGISTRY_URLS] ?? '';
        this.registryUrls = urlsEnv
            .split(',')
            .map((u) => u.trim())
            .filter(Boolean);
    }

    // ================================================================
    // 初期化
    // ================================================================

    async initialize(): Promise<void> {
        await userRepository.ensureSystemUser(SYSTEM_AUTHOR_ID);
        await this._loadIndex();
        this._startWatcher();
        if (this.registryUrls.length > 0) {
            // DB に既存ワールドがあればバックグラウンドで更新チェック、なければブロックして初期投入
            const hasWorlds = (await worldRepository.findAll()).length > 0;
            if (hasWorlds) {
                void this._seedFromRegistries().catch((err) => {
                    console.error('❌ 外部レジストリ更新失敗:', err);
                });
            } else {
                await this._seedFromRegistries().catch((err) => {
                    console.error('❌ 外部レジストリ取得失敗:', err);
                });
            }
        }
        console.log('👤 システムユーザーを確認しました');
    }

    // ================================================================
    // 公開 API
    // ================================================================

    /**
     * ワールド一覧を返す。
     * ローカルワールドは worlds.json から直接返す（YAML パース不要）。
     * ユーザー作成ワールドは DB から補完する。
     */
    async listWorlds(): Promise<WorldListItem[]> {
        const localItems: WorldListItem[] = this._order
            .map((name) => this._fileIndex.get(name))
            .filter((e): e is WorldIndexEntry => !!e)
            .map((e) => ({
                id: e.name,
                displayName: e.displayName,
                description: e.description ?? undefined,
                thumbnail: e.thumbnail ?? undefined,
                version: e.version,
                capacity: e.capacity,
            }));

        // _fileIndex にないワールドを DB から補完（レジストリ経由で取得したシステムワールドを含む）
        const allRecords = await worldRepository.findAll();
        const knownNames = new Set(this._fileIndex.keys());
        const dbItems: WorldListItem[] = allRecords
            .filter((r) => !knownNames.has(r.name))
            .map((r) => {
                const def = r.definition as WorldDefinition;
                return {
                    id: r.name,
                    displayName: def.spec.displayName,
                    description: def.spec.description,
                    thumbnail: def.spec.thumbnail,
                    version: r.version,
                    capacity: def.spec.capacity,
                };
            });

        return [...localItems, ...dbItems];
    }

    /**
     * 単一ワールドをフル解決して返す（インスタンス作成時などに使用）。
     * ローカルワールドは初回アクセス時のみ YAML をパースして DB に upsert する。
     */
    async getWorld(worldId: string): Promise<ResolvedWorld | undefined> {
        if (this._resolvedCache.has(worldId)) return this._resolvedCache.get(worldId);

        const entry = this._fileIndex.get(worldId);
        if (entry) {
            return this._loadWorldFromFile(entry);
        }

        // ユーザー作成ワールドを DB から取得
        const record = await worldRepository.findByName(worldId);
        if (record) {
            const resolved = this._resolveWorld(record);
            this._resolvedCache.set(worldId, resolved);
            return resolved;
        }

        return undefined;
    }

    async hasWorld(worldId: string): Promise<boolean> {
        if (this._fileIndex.has(worldId)) return true;
        return !!(await worldRepository.findByName(worldId));
    }

    /** DB UUID でワールドを取得（インスタンスマネージャー用） */
    async getWorldByDbId(dbId: string): Promise<ResolvedWorld | undefined> {
        const record = await worldRepository.findById(dbId);
        return record ? this._resolveWorld(record) : undefined;
    }

    /** 内部用：生の DB レコードを取得 */
    async getWorldRecord(worldId: string): Promise<WorldRecord | undefined> {
        return worldRepository.findByName(worldId);
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
     * URL または GitHub blob URL からワールドを取り込む。
     * worlds.json 形式の場合は全エントリを一括取得する。
     * 既存ワールドは上書き（upsert）される。
     */
    async importFromUrl(url: string): Promise<ResolvedWorld[]> {
        const rawUrl = toRawUrl(url);
        const yamlUrls = rawUrl.endsWith('.json') ? await resolveWorldsJsonUrls(rawUrl) : [rawUrl];
        const settled = await Promise.allSettled(
            yamlUrls.map(async (yamlUrl) => {
                const res = await fetch(yamlUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}: ${yamlUrl}`);
                const parsed = yaml.parse(await res.text()) as unknown;
                const result = WorldDefinitionSchema.safeParse(parsed);
                if (!result.success) throw new Error(`不正なワールド定義: ${yamlUrl}`);
                const def = result.data;
                const record = await worldRepository.upsertByName({
                    authorId: SYSTEM_AUTHOR_ID,
                    name: def.metadata.name,
                    version: def.metadata.version,
                    definition: def,
                });
                const resolved = this._resolveWorld(record);
                this._resolvedCache.set(resolved.id, resolved);
                return resolved;
            }),
        );
        const errors = settled.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
        if (errors.length > 0) throw new Error(errors.map((e: unknown) => String(e)).join(', '));
        return settled.map((r) => (r as PromiseFulfilledResult<ResolvedWorld>).value);
    }

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
        await this._buildIndexFromScan();
        console.log('✅ ワールド定義を全件再読み込みしました');
    }

    /** 特定ワールドのみリロード（API から呼ばれる） */
    async reloadWorld(worldId: string): Promise<boolean> {
        const entry = this._fileIndex.get(worldId);
        if (!entry) return false;
        await this._onYamlChanged(entry.file);
        return true;
    }

    /**
     * ワールドの表示順を変更し worlds.json を保存する。
     * @param order 新しい worldId の順序配列
     */
    async reorderWorlds(order: string[]): Promise<void> {
        const known = new Set(this._order);
        const filtered = order.filter((n) => known.has(n));
        const rest = this._order.filter((n) => !filtered.includes(n));
        this._order = [...filtered, ...rest];
        this._saveIndex();
    }

    // ================================================================
    // プライベート: インデックス管理
    // ================================================================

    private get _indexPath(): string {
        return path.join(this.worldsDir, 'worlds.json');
    }

    private async _loadIndex(): Promise<void> {
        if (fs.existsSync(this._indexPath)) {
            try {
                const content = fs.readFileSync(this._indexPath, 'utf-8');
                const entries = JSON.parse(content) as WorldIndexEntry[];
                this._fileIndex.clear();
                this._order = [];
                for (const entry of entries) {
                    this._fileIndex.set(entry.name, entry);
                    this._order.push(entry.name);
                }
                console.log(`📋 worlds.json から ${entries.length} ワールドを読み込みました`);
                return;
            } catch (err) {
                console.warn('⚠ worlds.json 読み込み失敗、スキャンにフォールバック:', err);
            }
        }
        // worlds.json がない場合はスキャンして作成
        await this._buildIndexFromScan();
    }

    private async _buildIndexFromScan(): Promise<void> {
        if (!fs.existsSync(this.worldsDir)) return;
        const files = fs
            .readdirSync(this.worldsDir)
            .filter((f) => (f.endsWith('.yaml') || f.endsWith('.yml')) && f !== 'worlds.json');

        const entries: WorldIndexEntry[] = [];
        for (const file of files) {
            const entry = this._parseYamlToEntry(path.join(this.worldsDir, file), file);
            if (entry) entries.push(entry);
        }

        // 既存の順序を維持しつつ新規エントリを末尾に追加
        const existingOrder = new Map(this._order.map((name, i) => [name, i]));
        entries.sort((a, b) => (existingOrder.get(a.name) ?? 999) - (existingOrder.get(b.name) ?? 999));

        this._fileIndex.clear();
        this._order = [];
        for (const entry of entries) {
            this._fileIndex.set(entry.name, entry);
            this._order.push(entry.name);
        }
        this._saveIndex();
        console.log(`📋 スキャンから ${entries.length} ワールドの worlds.json を作成しました`);
    }

    private _saveIndex(): void {
        if (!fs.existsSync(this.worldsDir)) return;
        const entries = this._order.map((name) => this._fileIndex.get(name)).filter((e): e is WorldIndexEntry => !!e);
        fs.writeFileSync(this._indexPath, JSON.stringify(entries, null, 2), 'utf-8');
    }

    private _parseYamlToEntry(filePath: string, fileName: string): WorldIndexEntry | null {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = yaml.parse(content) as unknown;
            const result = WorldDefinitionSchema.safeParse(parsed);
            if (!result.success) return null;
            const def = result.data;
            return {
                name: def.metadata.name,
                file: fileName,
                displayName: def.spec.displayName,
                description: def.spec.description ?? null,
                thumbnail: def.spec.thumbnail ?? null,
                version: def.metadata.version,
                capacity: def.spec.capacity,
            };
        } catch {
            return null;
        }
    }

    // ================================================================
    // プライベート: ファイル監視
    // ================================================================

    private _startWatcher(): void {
        if (!fs.existsSync(this.worldsDir)) return;
        this._watcher = fs.watch(this.worldsDir, (_event, filename) => {
            if (!filename || !/\.(yaml|yml)$/.test(filename) || filename === 'worlds.json') return;
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
            const entry = [...this._fileIndex.values()].find((e) => e.file === filename);
            if (entry) {
                this._fileIndex.delete(entry.name);
                this._order = this._order.filter((n) => n !== entry.name);
                this._resolvedCache.delete(entry.name);
                this._saveIndex();
                console.log(`🗑  ワールド削除を検知: ${entry.name}`);
            }
            return;
        }

        const newEntry = this._parseYamlToEntry(filePath, filename);
        if (!newEntry) {
            console.warn(`⚠  ${filename}: バリデーションエラー（スキップ）`);
            return;
        }

        const isNew = !this._fileIndex.has(newEntry.name);
        if (isNew) this._order.push(newEntry.name);
        this._fileIndex.set(newEntry.name, newEntry);
        this._resolvedCache.delete(newEntry.name);

        // DB も更新（インスタンスマネージャーが参照するため）
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = WorldDefinitionSchema.safeParse(yaml.parse(content) as unknown);
            if (!parsed.success) throw new Error(`YAML parse failed: ${newEntry.name}`);
            const def = parsed.data;
            await worldRepository.upsertByName({
                authorId: SYSTEM_AUTHOR_ID,
                name: def.metadata.name,
                version: def.metadata.version,
                definition: def,
            });
        } catch (err) {
            console.error(`❌ DB upsert 失敗: ${newEntry.name}`, err);
        }

        this._saveIndex();
        console.log(`✅ ワールド自動リロード: ${newEntry.name} (v${newEntry.version})`);
    }

    // ================================================================
    // プライベート: YAML 遅延ロード
    // ================================================================

    private async _loadWorldFromFile(entry: WorldIndexEntry): Promise<ResolvedWorld> {
        const filePath = path.join(this.worldsDir, entry.file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = yaml.parse(content) as unknown;
        const result = WorldDefinitionSchema.safeParse(parsed);
        if (!result.success) {
            throw new Error(`ワールド定義が無効: ${entry.name}`);
        }
        const def = result.data;
        const record = await worldRepository.upsertByName({
            authorId: SYSTEM_AUTHOR_ID,
            name: def.metadata.name,
            version: def.metadata.version,
            definition: def,
        });
        const resolved = this._resolveWorld(record);
        this._resolvedCache.set(entry.name, resolved);
        return resolved;
    }

    // ================================================================
    // プライベート: 外部レジストリ
    // ================================================================

    private async _seedFromRegistries(): Promise<void> {
        const now = Date.now();
        if (now - this._lastRegistrySeedAt < WorldRegistry.REGISTRY_SEED_INTERVAL_MS) {
            return;
        }
        this._lastRegistrySeedAt = now;

        const allYamlUrls = (
            await Promise.allSettled(
                this.registryUrls.map(async (registryUrl) => {
                    if (registryUrl.endsWith('.json')) {
                        const urls = await resolveWorldsJsonUrls(registryUrl);
                        console.log(`📋 worlds.json レジストリ: ${urls.length}件`);
                        return urls;
                    }
                    return [registryUrl];
                }),
            )
        ).flatMap((r) => {
            if (r.status === 'rejected') console.error('❌ レジストリ取得失敗:', r.reason);
            return r.status === 'fulfilled' ? r.value : [];
        });

        await Promise.allSettled(
            allYamlUrls.map(async (url) => {
                try {
                    await this._seedWorldFromUrl(url);
                } catch (err) {
                    console.error(`❌ ワールド取得失敗: ${url}`, err);
                }
            }),
        );
    }

    private async _seedWorldFromUrl(url: string): Promise<void> {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const content = await res.text();
        const parsed = yaml.parse(content) as unknown;
        const result = WorldDefinitionSchema.safeParse(parsed);
        if (!result.success) throw new Error(`Validation failed: ${url}`);
        const def = result.data;
        // 同バージョンが既に DB にある場合はスキップ
        const existing = await worldRepository.findByName(def.metadata.name);
        if (existing?.version === def.metadata.version) return;
        await worldRepository.upsertByName({
            authorId: SYSTEM_AUTHOR_ID,
            name: def.metadata.name,
            version: def.metadata.version,
            definition: def,
        });
        console.log(`   📄 ${def.metadata.name} (v${def.metadata.version}) - ${url}`);
    }

    // ================================================================
    // プライベート: 解決ヘルパー
    // ================================================================

    private _resolveWorld(record: WorldRecord): ResolvedWorld {
        const def = record.definition as WorldDefinition;
        const env = def.spec.environment ?? {
            backgroundColor: DEFAULTS.WORLD_ENVIRONMENT.backgroundColor,
            worldSize: DEFAULTS.WORLD_ENVIRONMENT.worldSize,
        };
        return {
            id: record.name,
            dbId: record.id,
            version: record.version,
            displayName: def.spec.displayName,
            description: def.spec.description,
            thumbnail: def.spec.thumbnail,
            environment: {
                backgroundColor: env.backgroundColor ?? DEFAULTS.WORLD_ENVIRONMENT.backgroundColor,
                backgroundImage: env.backgroundImage ?? null,
                bgm: env.bgm ?? null,
                worldSize: env.worldSize ?? DEFAULTS.WORLD_ENVIRONMENT.worldSize,
            },
            capacity: def.spec.capacity,
            dependencies: def.spec.dependencies?.map((d) => ({ name: d.name, source: d.source })),
            initialEntities: def.spec.initialEntities.map((e) => ({ ...e, data: e.data ?? {} })),
        };
    }
}

export const worldRegistry = new WorldRegistry();
