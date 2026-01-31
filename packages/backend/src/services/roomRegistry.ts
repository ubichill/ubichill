import fs from 'node:fs';
import path from 'node:path';
import {
    type ResolvedRoom,
    type RoomDefinition,
    RoomDefinitionSchema,
    DEFAULTS,
} from '@ubichill/shared';
import yaml from 'yaml';

/**
 * ルームレジストリ
 * ルーム定義のロード・キャッシュを管理
 */
class RoomRegistry {
    private rooms: Map<string, ResolvedRoom> = new Map();
    private roomsDir: string;

    constructor() {
        // プロジェクトルートのroomsディレクトリ
        this.roomsDir = path.resolve(process.cwd(), '../../rooms');
    }

    /**
     * ルーム定義を読み込む
     */
    async loadRooms(): Promise<void> {
        console.log(`📁 ルーム定義を読み込み中: ${this.roomsDir}`);

        if (!fs.existsSync(this.roomsDir)) {
            console.warn(`⚠️ roomsディレクトリが見つかりません: ${this.roomsDir}`);
            // デフォルトルームを作成
            this.createDefaultRoom();
            return;
        }

        const files = fs.readdirSync(this.roomsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

        for (const file of files) {
            try {
                await this.loadRoomFile(path.join(this.roomsDir, file));
            } catch (error) {
                console.error(`❌ ルーム定義の読み込みに失敗: ${file}`, error);
            }
        }

        if (this.rooms.size === 0) {
            this.createDefaultRoom();
        }

        console.log(`✅ ${this.rooms.size}件のルーム定義を読み込みました`);
    }

    /**
     * 単一のルーム定義ファイルを読み込み
     */
    private async loadRoomFile(filePath: string): Promise<void> {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = yaml.parse(content) as unknown;

        // Zodでバリデーション
        const result = RoomDefinitionSchema.safeParse(parsed);
        if (!result.success) {
            throw new Error(`Validation failed: ${result.error.issues.map((e) => e.message).join(', ')}`);
        }

        const room = this.resolveRoom(result.data);
        this.rooms.set(room.id, room);
        console.log(`   📄 ${room.id} (v${room.version})`);
    }

    /**
     * RoomDefinition を ResolvedRoom に変換
     */
    private resolveRoom(def: RoomDefinition): ResolvedRoom {
        const env = def.spec.environment ?? {
            backgroundColor: DEFAULTS.ROOM_ENVIRONMENT.backgroundColor,
            worldSize: DEFAULTS.ROOM_ENVIRONMENT.worldSize,
        };

        return {
            id: def.metadata.name,
            version: def.metadata.version,
            displayName: def.spec.displayName,
            description: def.spec.description,
            thumbnail: def.spec.thumbnail,
            environment: {
                backgroundColor: env.backgroundColor ?? DEFAULTS.ROOM_ENVIRONMENT.backgroundColor,
                backgroundImage: env.backgroundImage ?? null,
                bgm: env.bgm ?? null,
                worldSize: env.worldSize ?? DEFAULTS.ROOM_ENVIRONMENT.worldSize,
            },
            capacity: def.spec.capacity,
            initialEntities: def.spec.initialEntities.map((e) => ({
                ...e,
                data: e.data ?? {},
            })),
        };
    }

    /**
     * デフォルトルームを作成
     */
    private createDefaultRoom(): void {
        const defaultRoom: ResolvedRoom = {
            id: 'default',
            version: '1.0.0',
            displayName: 'デフォルトルーム',
            description: 'Ubichill のデフォルトコラボレーションスペース',
            environment: {
                backgroundColor: DEFAULTS.ROOM_ENVIRONMENT.backgroundColor,
                backgroundImage: null,
                bgm: null,
                worldSize: DEFAULTS.ROOM_ENVIRONMENT.worldSize,
            },
            capacity: { default: 10, max: 20 },
            initialEntities: [],
        };

        this.rooms.set('default', defaultRoom);
        console.log('📦 デフォルトルームを作成しました');
    }

    /**
     * ルーム一覧を取得
     */
    listRooms(): ResolvedRoom[] {
        return Array.from(this.rooms.values());
    }

    /**
     * ルームを取得
     */
    getRoom(roomId: string): ResolvedRoom | undefined {
        return this.rooms.get(roomId);
    }

    /**
     * ルームが存在するか確認
     */
    hasRoom(roomId: string): boolean {
        return this.rooms.has(roomId);
    }
}

// シングルトンインスタンス
export const roomRegistry = new RoomRegistry();
