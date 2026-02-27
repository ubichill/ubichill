import { instanceRepository } from '@ubichill/db';
import type { CreateInstanceRequest, Instance, InstanceAccess, WorldEnvironmentData } from '@ubichill/shared';
import { DEFAULTS } from '@ubichill/shared';
import { worldRegistry } from './worldRegistry';
import { clearWorldState, createEntity } from './worldState';

/**
 * インスタンスマネージャー
 * インスタンスのライフサイクルを管理（DBベース）
 */
class InstanceManager {
    /**
     * 新しいインスタンスを作成
     */
    async createInstance(request: CreateInstanceRequest, leaderId: string): Promise<Instance | { error: string }> {
        const world = await worldRegistry.getWorld(request.worldId);
        if (!world) {
            return { error: `World not found: ${request.worldId}` };
        }

        const maxUsers = request.settings?.maxUsers ?? world.capacity.default;
        const cappedMaxUsers = Math.min(maxUsers, world.capacity.max);

        // DBにインスタンスを作成（world.dbIdを使用）
        const dbInstance = await instanceRepository.create({
            worldId: world.dbId,
            leaderId,
            accessType: request.access?.type ?? 'public',
            accessTags: request.access?.tags ?? [],
            hasPassword: request.access?.password ? 'true' : 'false',
            maxUsers: cappedMaxUsers,
            passwordHash: request.access?.password, // 簡易実装（本番ではハッシュ化）
        });

        // インスタンス固有のワールド状態を初期化（initialEntitiesを配置）
        if (world.initialEntities && world.initialEntities.length > 0) {
            for (const entityDef of world.initialEntities) {
                createEntity(dbInstance.id, {
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
                `🌍 インスタンス ${dbInstance.id} にinitialEntities ${world.initialEntities.length}件を配置しました`,
            );
        }

        console.log(`🏠 インスタンス作成: ${dbInstance.id} (world: ${world.id})`);

        return this.toPublicInstance(dbInstance, world);
    }

    /**
     * インスタンス一覧を取得
     */
    async listInstances(options?: { tag?: string; includeFull?: boolean }): Promise<Instance[]> {
        const dbInstances = await instanceRepository.findAll({
            tag: options?.tag,
            includeFull: options?.includeFull,
        });

        const instances: Instance[] = [];
        for (const dbInstance of dbInstances) {
            const world = await worldRegistry.getWorld(dbInstance.worldId);
            if (world) {
                instances.push(this.toPublicInstance(dbInstance, world));
            }
        }

        return instances;
    }

    /**
     * インスタンスを取得
     */
    async getInstance(instanceId: string): Promise<Instance | undefined> {
        const dbInstance = await instanceRepository.findById(instanceId);
        if (!dbInstance) return undefined;

        const world = await worldRegistry.getWorld(dbInstance.worldId);
        if (!world) return undefined;

        return this.toPublicInstance(dbInstance, world);
    }

    /**
     * インスタンスを終了
     */
    async closeInstance(instanceId: string, userId: string): Promise<{ success: boolean; error?: string }> {
        const dbInstance = await instanceRepository.findById(instanceId);
        if (!dbInstance) {
            return { success: false, error: 'Instance not found' };
        }

        if (dbInstance.leaderId !== userId) {
            return { success: false, error: 'Only the leader can close the instance' };
        }

        // DBから削除
        const deleted = await instanceRepository.deleteByLeader(instanceId, userId);
        if (!deleted) {
            return { success: false, error: 'Failed to delete instance' };
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
    async updateUserCount(instanceId: string, delta: number): Promise<number> {
        const updated = await instanceRepository.updateUserCount(instanceId, delta);
        if (!updated) return -1;

        // ユーザーが0になったらインスタンスを自動削除
        if (updated.currentUsers === 0) {
            await instanceRepository.delete(instanceId);

            // ワールド状態をクリーンアップ
            clearWorldState(instanceId);

            console.log(`🗑️ インスタンス自動削除（ユーザー0）: ${instanceId}`);
            return 0;
        }

        return updated.currentUsers;
    }

    /**
     * ワールドIDからインスタンスを検索（既存インスタンスへの参加用）
     */
    async findInstancesByWorld(worldId: string): Promise<Instance[]> {
        const dbInstances = await instanceRepository.findByWorldId(worldId);
        const world = await worldRegistry.getWorld(worldId);
        if (!world) return [];

        return dbInstances.map((dbInstance) => this.toPublicInstance(dbInstance, world));
    }

    /**
     * ワールドの環境設定を取得
     */
    async getWorldEnvironment(worldId: string): Promise<WorldEnvironmentData> {
        const world = await worldRegistry.getWorld(worldId);
        if (world) {
            // undefined を null に変換
            return {
                backgroundColor: world.environment.backgroundColor,
                backgroundImage: world.environment.backgroundImage ?? null,
                bgm: world.environment.bgm ?? null,
                worldSize: world.environment.worldSize,
            };
        }
        return DEFAULTS.WORLD_ENVIRONMENT;
    }

    /**
     * DB record から公開用のInstanceオブジェクトに変換
     */
    private toPublicInstance(
        dbInstance: Awaited<ReturnType<typeof instanceRepository.findById>> & object,
        world: { id: string; version: string; displayName: string; thumbnail?: string },
    ): Instance {
        const access: InstanceAccess = {
            type: dbInstance.accessType,
            tags: dbInstance.accessTags ?? [],
            password: dbInstance.hasPassword === 'true',
        };

        return {
            id: dbInstance.id,
            status: dbInstance.status,
            leaderId: dbInstance.leaderId,
            createdAt: dbInstance.createdAt.toISOString(),
            expiresAt: dbInstance.expiresAt?.toISOString() ?? null,

            world: {
                id: world.id,
                version: world.version,
                displayName: world.displayName,
                thumbnail: world.thumbnail,
            },

            access,
            stats: {
                currentUsers: dbInstance.currentUsers,
                maxUsers: dbInstance.maxUsers,
            },
            connection: {
                url: DEFAULTS.WORLD_ID, // 将来的にはサーバーURLを返す
                namespace: `/${dbInstance.id}`,
            },
        };
    }
}

// シングルトンインスタンス
export const instanceManager = new InstanceManager();
