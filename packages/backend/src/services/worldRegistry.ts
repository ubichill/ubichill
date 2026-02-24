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
} from '@ubichill/shared';
import yaml from 'yaml';

// システムユーザーID（YAMLからのシード用）
const SYSTEM_AUTHOR_ID = '00000000-0000-0000-0000-000000000000';

/**
 * ワールドレジストリ
 * YAMLからの初期シードとDBからのワールド管理を統合
 */
class WorldRegistry {
    private worldsDir: string;
    private cache: Map<string, ResolvedWorld> = new Map();
    private allWorldsCache: ResolvedWorld[] | null = null;

    constructor() {
        const envWorldsDir = process.env[ENV_KEYS.WORLDS_DIR];
        this.worldsDir = envWorldsDir
            ? path.resolve(envWorldsDir)
            : path.resolve(process.cwd(), SERVER_CONFIG.WORLDS_DIR_DEFAULT);
    }

    /**
     * ワールドを初期化
     * 1. システムユーザーを作成（FK制約のため）
     * 2. YAMLディレクトリから初期ワールドをDBにシード
     * 3. DBからワールドを読み込み
     */
    async loadWorlds(): Promise<void> {
        console.log('📁 ワールドを初期化中...');

        // システムユーザーを作成（FK制約を満たすため）
        await userRepository.ensureSystemUser(SYSTEM_AUTHOR_ID);
        console.log('👤 システムユーザーを確認しました');

        // YAMLからシード
        await this.seedFromYaml();

        // DBにワールドがなければデフォルトを作成
        const worlds = await worldRepository.findAll();
        if (worlds.length === 0) {
            await this.createDefaultWorld();
        }

        const allWorlds = await worldRepository.findAll();
        // 初期読み込み時にキャッシュに乗せる
        this.cache.clear();
        this.allWorldsCache = null;
        for (const record of allWorlds) {
            this.cache.set(record.name, this.resolveWorld(record));
        }

        console.log(`✅ ${allWorlds.length}件のワールドを読み込みました`);
    }

    /**
     * YAMLディレクトリからワールドをシード
     */
    private async seedFromYaml(): Promise<void> {
        if (!fs.existsSync(this.worldsDir)) {
            console.warn(`⚠️ worldsディレクトリが見つかりません: ${this.worldsDir}`);
            return;
        }

        const files = fs.readdirSync(this.worldsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

        for (const file of files) {
            try {
                await this.seedWorldFile(path.join(this.worldsDir, file));
            } catch (error) {
                console.error(`❌ ワールド定義の読み込みに失敗: ${file}`, error);
            }
        }
    }

    /**
     * 単一のYAMLファイルをDBにシード
     */
    private async seedWorldFile(filePath: string): Promise<void> {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = yaml.parse(content) as unknown;

        const result = WorldDefinitionSchema.safeParse(parsed);
        if (!result.success) {
            throw new Error(`Validation failed: ${result.error.issues.map((e) => e.message).join(', ')}`);
        }

        const definition = result.data;
        const name = definition.metadata.name;

        // 既存チェック（upsert）
        await worldRepository.upsertByName({
            authorId: SYSTEM_AUTHOR_ID,
            name,
            version: definition.metadata.version,
            definition,
        });

        console.log(`   📄 ${name} (v${definition.metadata.version}) - シード完了`);
    }

    /**
     * デフォルトワールドをDBに作成
     */
    private async createDefaultWorld(): Promise<void> {
        const defaultDefinition: WorldDefinition = {
            apiVersion: 'ubichill.com/v1alpha1',
            kind: 'World',
            metadata: {
                name: 'default',
                version: '1.0.0',
            },
            spec: {
                displayName: 'デフォルトワールド',
                description: 'Ubichill のデフォルトコラボレーションスペース',
                capacity: { default: 10, max: 20 },
                environment: {
                    backgroundColor: DEFAULTS.WORLD_ENVIRONMENT.backgroundColor,
                    worldSize: DEFAULTS.WORLD_ENVIRONMENT.worldSize,
                },
                initialEntities: [],
            },
        };

        await worldRepository.create({
            authorId: SYSTEM_AUTHOR_ID,
            name: 'default',
            version: '1.0.0',
            definition: defaultDefinition,
        });

        console.log('📦 デフォルトワールドを作成しました');
    }

    /**
     * WorldRecord を ResolvedWorld に変換
     */
    private resolveWorld(record: WorldRecord): ResolvedWorld {
        const def = record.definition as WorldDefinition;
        const env = def.spec.environment ?? {
            backgroundColor: DEFAULTS.WORLD_ENVIRONMENT.backgroundColor,
            worldSize: DEFAULTS.WORLD_ENVIRONMENT.worldSize,
        };

        return {
            id: record.name, // 人間が読める識別子
            dbId: record.id, // DBの実際のID（外部キー用）
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
            dependencies: def.spec.dependencies?.map((d) => ({
                name: d.name,
                source: d.source,
            })),
            initialEntities: def.spec.initialEntities.map((e) => ({
                ...e,
                data: e.data ?? {},
            })),
        };
    }

    /**
     * キャッシュの無効化（更新/削除時に利用）
     */
    private invalidateCache(worldId?: string): void {
        this.allWorldsCache = null;
        if (worldId) {
            this.cache.delete(worldId);
        } else {
            this.cache.clear();
        }
    }

    /**
     * ワールド一覧を取得
     */
    async listWorlds(): Promise<ResolvedWorld[]> {
        if (this.allWorldsCache) {
            return this.allWorldsCache;
        }

        const records = await worldRepository.findAll();
        const resolved = records.map((r) => this.resolveWorld(r));

        // キャッシュの更新
        this.cache.clear();
        for (const world of resolved) {
            this.cache.set(world.id, world);
        }
        this.allWorldsCache = resolved;

        return resolved;
    }

    /**
     * ワールドを取得
     */
    async getWorld(worldId: string): Promise<ResolvedWorld | undefined> {
        if (this.cache.has(worldId)) {
            return this.cache.get(worldId);
        }

        const record = await worldRepository.findByName(worldId);
        if (!record) return undefined;

        const resolved = this.resolveWorld(record);
        this.cache.set(worldId, resolved);
        return resolved;
    }

    /**
     * ワールドが存在するか確認
     */
    async hasWorld(worldId: string): Promise<boolean> {
        if (this.cache.has(worldId)) return true;

        const record = await worldRepository.findByName(worldId);
        return !!record;
    }

    /**
     * ワールドを作成
     */
    async createWorld(authorId: string, definition: WorldDefinition): Promise<ResolvedWorld> {
        const record = await worldRepository.create({
            authorId,
            name: definition.metadata.name,
            version: definition.metadata.version,
            definition,
        });

        const resolved = this.resolveWorld(record);
        this.cache.set(resolved.id, resolved);
        this.invalidateCache(); // allWorldsCache を無効化

        return resolved;
    }

    /**
     * ワールドを更新
     */
    async updateWorld(worldId: string, definition: WorldDefinition): Promise<ResolvedWorld | undefined> {
        const existing = await worldRepository.findByName(worldId);
        if (!existing) return undefined;

        const updated = await worldRepository.update(existing.id, {
            version: definition.metadata.version,
            definition,
        });

        if (updated) {
            const resolved = this.resolveWorld(updated);
            this.cache.set(worldId, resolved);
            this.invalidateCache(); // allWorldsCache を無効化
            return resolved;
        }
        return undefined;
    }

    /**
     * ワールドを削除
     */
    async deleteWorld(worldId: string): Promise<boolean> {
        const existing = await worldRepository.findByName(worldId);
        if (!existing) return false;

        const success = await worldRepository.delete(existing.id);
        if (success) {
            this.invalidateCache(worldId);
        }
        return success;
    }

    /**
     * DB内のUUID IDでワールドを取得
     */
    async getWorldByDbId(dbId: string): Promise<ResolvedWorld | undefined> {
        // IDがUUIDなので直接DBを引く（頻度が少なければこれで十分）
        const record = await worldRepository.findById(dbId);
        return record ? this.resolveWorld(record) : undefined;
    }

    /**
     * 生のDBレコードを取得（内部用）
     */
    async getWorldRecord(worldId: string): Promise<WorldRecord | undefined> {
        return worldRepository.findByName(worldId);
    }
}

// シングルトンインスタンス
export const worldRegistry = new WorldRegistry();
