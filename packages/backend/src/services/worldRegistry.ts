import fs from 'node:fs';
import path from 'node:path';
import {
    DEFAULTS,
    ENV_KEYS,
    type ResolvedWorld,
    type WorldDefinition,
    WorldDefinitionSchema,
    SERVER_CONFIG,
} from '@ubichill/shared';
import yaml from 'yaml';

/**
 * ワールドレジストリ
 * ワールド定義のロード・キャッシュを管理
 */
class WorldRegistry {
    private worlds: Map<string, ResolvedWorld> = new Map();
    private worldsDir: string;

    constructor() {
        // 環境変数で指定可能（コンテナ環境向け）
        // 未指定時はプロジェクトルートの worlds ディレクトリにフォールバック
        const envWorldsDir = process.env[ENV_KEYS.WORLDS_DIR];
        this.worldsDir = envWorldsDir
            ? path.resolve(envWorldsDir)
            : path.resolve(process.cwd(), SERVER_CONFIG.WORLDS_DIR_DEFAULT);
    }

    /**
     * ワールド定義を読み込む
     */
    async loadWorlds(): Promise<void> {
        console.log(`📁 ワールド定義を読み込み中: ${this.worldsDir}`);

        if (!fs.existsSync(this.worldsDir)) {
            console.warn(`⚠️ worldsディレクトリが見つかりません: ${this.worldsDir}`);
            // デフォルトワールドを作成
            this.createDefaultWorld();
            return;
        }

        const files = fs.readdirSync(this.worldsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

        for (const file of files) {
            try {
                await this.loadWorldFile(path.join(this.worldsDir, file));
            } catch (error) {
                console.error(`❌ ワールド定義の読み込みに失敗: ${file}`, error);
            }
        }

        if (this.worlds.size === 0) {
            this.createDefaultWorld();
        }

        console.log(`✅ ${this.worlds.size}件のワールド定義を読み込みました`);
    }

    /**
     * 単一のワールド定義ファイルを読み込み
     */
    private async loadWorldFile(filePath: string): Promise<void> {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = yaml.parse(content) as unknown;

        // Zodでバリデーション
        const result = WorldDefinitionSchema.safeParse(parsed);
        if (!result.success) {
            throw new Error(`Validation failed: ${result.error.issues.map((e) => e.message).join(', ')}`);
        }

        const world = this.resolveWorld(result.data);
        this.worlds.set(world.id, world);
        console.log(`   📄 ${world.id} (v${world.version})`);
    }

    /**
     * WorldDefinition を ResolvedWorld に変換
     */
    private resolveWorld(def: WorldDefinition): ResolvedWorld {
        const env = def.spec.environment ?? {
            backgroundColor: DEFAULTS.WORLD_ENVIRONMENT.backgroundColor,
            worldSize: DEFAULTS.WORLD_ENVIRONMENT.worldSize,
        };

        return {
            id: def.metadata.name,
            version: def.metadata.version,
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
     * デフォルトワールドを作成
     */
    private createDefaultWorld(): void {
        const defaultWorld: ResolvedWorld = {
            id: 'default',
            version: '1.0.0',
            displayName: 'デフォルトワールド',
            description: 'Ubichill のデフォルトコラボレーションスペース',
            environment: {
                backgroundColor: DEFAULTS.WORLD_ENVIRONMENT.backgroundColor,
                backgroundImage: null,
                bgm: null,
                worldSize: DEFAULTS.WORLD_ENVIRONMENT.worldSize,
            },
            capacity: { default: 10, max: 20 },
            initialEntities: [],
            dependencies: [
                { name: 'pen:pen', source: { type: 'repository', path: 'plugins/pen' } },
                { name: 'video-player', source: { type: 'repository', path: 'plugins/video-player' } },
                { name: 'avatar', source: { type: 'repository', path: 'plugins/avatar' } },
            ],
        };

        this.worlds.set('default', defaultWorld);
        console.log('📦 デフォルトワールドを作成しました');
    }

    /**
     * ワールド一覧を取得
     */
    listWorlds(): ResolvedWorld[] {
        return Array.from(this.worlds.values());
    }

    /**
     * ワールドを取得
     */
    getWorld(worldId: string): ResolvedWorld | undefined {
        return this.worlds.get(worldId);
    }

    /**
     * ワールドが存在するか確認
     */
    hasWorld(worldId: string): boolean {
        return this.worlds.has(worldId);
    }
}

// シングルトンインスタンス
export const worldRegistry = new WorldRegistry();
