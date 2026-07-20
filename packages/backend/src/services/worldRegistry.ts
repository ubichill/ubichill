import fs from 'node:fs';
import path from 'node:path';
import { userRepository, type WorldRecord, worldRepository } from '@ubichill/db';
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
import { migrateLegacyWorldYaml } from './worldMigration';
import { definitionToResolved, enumerateSource, resolveWorldFromUrl } from './worldResolver';

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
    /** official + registry の生定義（id → WorldDefinition）。URL 配信/フェデレーション用 */
    private _defByName = new Map<string, WorldDefinition>();
    /** ローカル id → YAML ファイルパス（reload / watch 用） */
    private _fileByName = new Map<string, string>();
    /** 表示順（in-memory。永続化は ordering→DB の別タスク） */
    private _order: string[] = [];

    /** DB ユーザーワールドの解決キャッシュ */
    private readonly _resolvedCache = new Map<string, ResolvedWorld>();

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
        return `${this._publicBaseUrl}/api/v1/worlds/${id}/yaml`;
    }

    private localSource(id: string): WorldSource {
        return { kind: WorldSourceKind.Local, url: this.selfWorldUrl(id), registryName: 'this instance' };
    }

    // ================================================================
    // 初期化
    // ================================================================

    async initialize(): Promise<void> {
        await userRepository.ensureSystemUser(SYSTEM_AUTHOR_ID);
        await this._migrateLegacyDbRecords();
        await this._scanLocal();
        this._startWatcher();
        console.log('👤 システムユーザーを確認しました');
    }

    // ================================================================
    // 公開 API
    // ================================================================

    /**
     * ワールド一覧を返す。
     * official/registry はメモリ索引から、ユーザー作成ワールドは DB から補完する。
     */
    async listWorlds(): Promise<WorldListItem[]> {
        const allRecords = await worldRepository.findAll();
        const dbRecordByName = new Map<string, WorldRecord>(allRecords.map((r: WorldRecord) => [r.name, r]));

        const indexItems: WorldListItem[] = this._order
            .map((id) => this._index.get(id))
            .filter((w): w is ResolvedWorld => !!w)
            .map((w) => {
                const rec = dbRecordByName.get(w.id);
                return this._toListItem(w, rec);
            });

        // 索引に無い DB レコード（ユーザー作成ワールド）を補完
        const known = new Set(this._index.keys());
        const dbItems: WorldListItem[] = allRecords
            .filter((r: WorldRecord) => !known.has(r.name))
            .map((r: WorldRecord) => this._toListItem(this._resolveWorld(r), r));

        return [...indexItems, ...dbItems];
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
     * URL（＝ワールドの一意キー）でワールドを取得する。instances/favorites が参照する。
     * official/registry はメモリ索引、本体ホストのユーザーワールドは self URL から id を得て DB 解決。
     */
    async getWorldByUrl(url: string): Promise<ResolvedWorld | undefined> {
        for (const w of this._index.values()) {
            if (w.url === url) return w;
        }
        const id = this._idFromSelfUrl(url);
        if (id) return this.getWorld(id);
        return undefined;
    }

    /** self URL（`.../api/v1/worlds/{id}/yaml`）から id を取り出す。それ以外は undefined。 */
    private _idFromSelfUrl(url: string): string | undefined {
        try {
            const m = /^\/api\/v1\/worlds\/(.+)\/yaml$/.exec(new URL(url).pathname);
            return m?.[1];
        } catch {
            return undefined;
        }
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

    /**
     * URL からワールドを取り込む（DB へ upsert）。
     * GitHub tree URL / レジストリ URL の場合は全エントリを一括取得する。
     */
    async importFromUrl(url: string): Promise<ResolvedWorld[]> {
        const sources = await enumerateSource(url).catch(() => [{ url, source: { kind: WorldSourceKind.Url, url } }]);
        const settled = await Promise.allSettled(
            sources.map(async ({ url: worldUrl, source }) => {
                const resolved = await resolveWorldFromUrl(worldUrl, source);
                const record = await worldRepository.upsertByName({
                    authorId: SYSTEM_AUTHOR_ID,
                    name: resolved.id,
                    version: resolved.version,
                    definition: this._toDefinition(resolved),
                });
                // 本体 DB に取り込んだので self URL の local ワールドとして解決し直す
                const imported = this._resolveWorld(record);
                this._resolvedCache.set(imported.id, imported);
                return imported;
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

    /** ResolvedWorld → WorldDefinition（DB 保存用）。 */
    private _toDefinition(w: ResolvedWorld): WorldDefinition {
        return {
            apiVersion: 'ubichill.com/v1alpha1',
            kind: 'World',
            metadata: {
                name: w.id,
                version: w.version,
                author: w.authorName ? { name: w.authorName } : undefined,
            },
            spec: {
                displayName: w.displayName,
                description: w.description,
                thumbnail: w.thumbnail,
                capacity: w.capacity,
                environment: w.environment,
                dependencies: w.dependencies,
                initialEntities: w.initialEntities,
            },
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
