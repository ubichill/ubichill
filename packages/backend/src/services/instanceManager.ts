import { randomUUID } from 'node:crypto';
import type { CreateInstanceRequest, Instance, InstanceAccess, RoomEnvironmentData } from '@ubichill/shared';
import { DEFAULTS } from '@ubichill/shared';
import { roomRegistry } from './roomRegistry';
import { clearWorldState, createEntity } from './worldState';

/**
 * インスタンス内部状態
 */
interface InstanceState extends Instance {
    passwordHash?: string; // パスワード保護用
}

/**
 * インスタンスマネージャー
 * インスタンスのライフサイクルを管理
 */
class InstanceManager {
    private instances: Map<string, InstanceState> = new Map();
    // roomId -> Set<instanceId> のマッピング
    private roomToInstances: Map<string, Set<string>> = new Map();

    /**
     * 新しいインスタンスを作成
     */
    createInstance(request: CreateInstanceRequest, leaderId: string): Instance | { error: string } {
        const room = roomRegistry.getRoom(request.roomId);
        if (!room) {
            return { error: `Room not found: ${request.roomId}` };
        }

        const instanceId = randomUUID();
        const now = new Date().toISOString();

        const access: InstanceAccess = {
            type: request.access?.type ?? 'public',
            tags: request.access?.tags ?? [],
            password: !!request.access?.password,
        };

        const maxUsers = request.settings?.maxUsers ?? room.capacity.default;

        const instance: InstanceState = {
            id: instanceId,
            status: 'active',
            leaderId,
            createdAt: now,
            expiresAt: null, // 無期限

            room: {
                id: room.id,
                version: room.version,
                displayName: room.displayName,
                thumbnail: room.thumbnail,
            },

            access,
            stats: {
                currentUsers: 0,
                maxUsers: Math.min(maxUsers, room.capacity.max),
            },
            connection: {
                url: DEFAULTS.ROOM_ID, // 将来的にはサーバーURLを返す
                namespace: `/${instanceId}`,
            },

            // 内部状態
            passwordHash: request.access?.password, // 簡易実装（本番ではハッシュ化）
        };

        this.instances.set(instanceId, instance);

        // roomId -> instanceId のマッピングを追加
        if (!this.roomToInstances.has(request.roomId)) {
            this.roomToInstances.set(request.roomId, new Set());
        }
        this.roomToInstances.get(request.roomId)?.add(instanceId);

        // インスタンス固有のワールド状態を初期化（initialEntitiesを配置）
        if (room.initialEntities && room.initialEntities.length > 0) {
            for (const entityDef of room.initialEntities) {
                createEntity(instanceId, {
                    type: entityDef.kind,
                    ownerId: null,
                    lockedBy: null,
                    transform: {
                        x: entityDef.transform.x,
                        y: entityDef.transform.y,
                        z: entityDef.transform.z,
                        w: entityDef.transform.w ?? 100,
                        h: entityDef.transform.h ?? 100,
                        scale: entityDef.transform.scale ?? 1,
                        rotation: entityDef.transform.rotation,
                    },
                    data: entityDef.data ?? {},
                });
            }
            console.log(
                `🌍 インスタンス ${instanceId} にinitialEntities ${room.initialEntities.length}件を配置しました`,
            );
        }

        console.log(`🏠 インスタンス作成: ${instanceId} (room: ${room.id})`);

        return this.toPublicInstance(instance);
    }

    /**
     * インスタンス一覧を取得
     */
    listInstances(options?: { tag?: string; includeFull?: boolean }): Instance[] {
        let instances = Array.from(this.instances.values());

        // タグでフィルタリング
        if (options?.tag) {
            const tag = options.tag;
            instances = instances.filter((i) => i.access.tags.includes(tag));
        }

        // 満員を除外
        if (!options?.includeFull) {
            instances = instances.filter((i) => i.status !== 'full');
        }

        return instances.map((i) => this.toPublicInstance(i));
    }

    /**
     * インスタンスを取得
     */
    getInstance(instanceId: string): Instance | undefined {
        const instance = this.instances.get(instanceId);
        return instance ? this.toPublicInstance(instance) : undefined;
    }

    /**
     * インスタンスを終了
     */
    closeInstance(instanceId: string, userId: string): { success: boolean; error?: string } {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            return { success: false, error: 'Instance not found' };
        }

        if (instance.leaderId !== userId) {
            return { success: false, error: 'Only the leader can close the instance' };
        }

        instance.status = 'closing';
        this.instances.delete(instanceId);

        // マッピングからも削除
        const roomInstances = this.roomToInstances.get(instance.room.id);
        if (roomInstances) {
            roomInstances.delete(instanceId);
            if (roomInstances.size === 0) {
                this.roomToInstances.delete(instance.room.id);
            }
        }

        // ワールド状態をクリーンアップ
        clearWorldState(instanceId);

        console.log(`🚪 インスタンス終了: ${instanceId}`);

        return { success: true };
    }

    /**
     * ユーザー数を更新
     * @returns 更新後のユーザー数。インスタンスが見つからない場合は -1
     */
    updateUserCount(instanceId: string, delta: number): number {
        const instance = this.instances.get(instanceId);
        if (!instance) return -1;

        instance.stats.currentUsers = Math.max(0, instance.stats.currentUsers + delta);

        // ユーザーが0になったらインスタンスを自動削除
        // ユーザーが0になったらインスタンスを自動削除
        if (instance.stats.currentUsers === 0) {
            // 他の処理で既に削除されていないか、最新状態を確認してからクリーンアップする
            const currentInstance = this.instances.get(instanceId);
            if (currentInstance && currentInstance.stats.currentUsers === 0) {
                this.instances.delete(instanceId);

                // マッピングからも削除
                const roomInstances = this.roomToInstances.get(currentInstance.room.id);
                if (roomInstances) {
                    roomInstances.delete(instanceId);
                    if (roomInstances.size === 0) {
                        this.roomToInstances.delete(currentInstance.room.id);
                    }
                }

                // ワールド状態をクリーンアップ
                clearWorldState(instanceId);

                console.log(`🗑️ インスタンス自動削除（ユーザー0）: ${instanceId}`);
            }
            return 0;
        }

        // ステータス更新
        if (instance.stats.currentUsers >= instance.stats.maxUsers) {
            instance.status = 'full';
        } else if (instance.status === 'full') {
            instance.status = 'active';
        }

        return instance.stats.currentUsers;
    }

    /**
     * ルームIDからインスタンスを検索（既存インスタンスへの参加用）
     */
    findInstancesByRoom(roomId: string): Instance[] {
        const instanceIds = this.roomToInstances.get(roomId);
        if (!instanceIds) return [];

        return Array.from(instanceIds)
            .map((id) => this.instances.get(id))
            .filter((i): i is InstanceState => !!i)
            .map((i) => this.toPublicInstance(i));
    }

    /**
     * ルームの環境設定を取得
     */
    getRoomEnvironment(roomId: string): RoomEnvironmentData {
        const room = roomRegistry.getRoom(roomId);
        if (room) {
            // undefined を null に変換
            return {
                backgroundColor: room.environment.backgroundColor,
                backgroundImage: room.environment.backgroundImage ?? null,
                bgm: room.environment.bgm ?? null,
                worldSize: room.environment.worldSize,
            };
        }
        return DEFAULTS.ROOM_ENVIRONMENT;
    }

    /**
     * 内部状態から公開用のInstanceオブジェクトに変換
     */
    private toPublicInstance(instance: InstanceState): Instance {
        // passwordHash を除外
        const { passwordHash: _, ...publicInstance } = instance;
        return publicInstance;
    }
}

// シングルトンインスタンス
export const instanceManager = new InstanceManager();
