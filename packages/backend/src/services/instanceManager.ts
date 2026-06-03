import { type InstanceRecord, instanceRepository } from '@ubichill/db';
import type {
    ComponentInstance,
    CreateInstanceRequest,
    InitialEntity,
    Instance,
    InstanceAccess,
    WorldEnvironmentData,
} from '@ubichill/shared';
import { DEFAULTS } from '@ubichill/shared';
import bcrypt from 'bcryptjs';
import { appConfig } from '../config';
import { logger } from '../utils/logger';
import { clearInstanceState, createEntity } from './instanceState';
import { userManager } from './userManager';
import { worldRegistry } from './worldRegistry';

/**
 * GameObject ツリーを 1 Component = 1 ComponentInstance に展開する純関数。
 * 子 Entity の transform.x/y は親基準の相対座標 → 親 origin を加算して絶対化する。
 * w/h は未指定 (undefined) なら 0 を入れて「サイズ未指定 = 自然サイズ尊重」を表す。
 */
function flattenGameObject(
    gameObject: InitialEntity,
    parentOrigin: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    parentEntityId?: string,
): Array<Omit<ComponentInstance, 'id'> & { id: string }> {
    const t = gameObject.transform;
    const absX = parentOrigin.x + t.x;
    const absY = parentOrigin.y + t.y;
    const absZ = parentOrigin.z + (t.z ?? 0);
    const transform: ComponentInstance['transform'] = {
        x: absX,
        y: absY,
        z: absZ,
        w: t.w ?? 0,
        h: t.h ?? 0,
        scale: t.scale ?? 1,
        rotation: t.rotation ?? 0,
    };
    const own = (gameObject.components ?? []).map((c, i) => ({
        id: `${gameObject.id}::${i}`,
        type: c.type,
        entityId: gameObject.id,
        parentEntityId,
        ownerId: null,
        lockedBy: null,
        transform,
        data: c.data ?? {},
    }));
    const fromChildren = (gameObject.children ?? []).flatMap((child) =>
        flattenGameObject(child, { x: absX, y: absY, z: absZ }, gameObject.id),
    );
    return [...own, ...fromChildren];
}

/**
 * インスタンスマネージャー
 * インスタンスのライフサイクルを管理（DBベース）
 */
class InstanceManager {
    /**
     * DBから取得した生レコードをフロントエンド用の公開データに変換
     */
    private emptyTimers = new Map<string, NodeJS.Timeout>();

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

        // パスワードがある場合はハッシュ化
        let passwordHash: string | undefined;
        if (request.access?.password) {
            passwordHash = await bcrypt.hash(request.access.password, 10);
        }

        // DBにインスタンスを作成（world.dbIdを使用）
        const dbInstance = await instanceRepository.create({
            worldId: world.dbId,
            leaderId,
            accessType: request.access?.type ?? 'public',
            accessTags: request.access?.tags ?? [],
            hasPassword: !!request.access?.password,
            maxUsers: cappedMaxUsers,
            passwordHash,
        });

        // ワールド定義の initialEntities (GameObject + components[]) を flat ComponentInstance に展開して配置
        if (world.initialEntities && world.initialEntities.length > 0) {
            let placed = 0;
            for (const gameObject of world.initialEntities) {
                for (const flat of flattenGameObject(gameObject)) {
                    createEntity(dbInstance.id, flat);
                    placed += 1;
                }
            }
            logger.info(
                `インスタンス ${dbInstance.id} に GameObject ${world.initialEntities.length}件 (Component ${placed}件) を配置しました`,
            );
        }

        logger.info(`インスタンス作成: ${dbInstance.id} (world: ${world.id})`);

        return this.toPublicInstance(dbInstance, world);
    }

    /**
     * インスタンス一覧を取得
     *
     * status / 人数は userManager から導出するため DB の status フィルタは信頼しない。
     * 全件取って toPublicInstance で正しい値を計算し、includeFull=false なら ここで post-filter する。
     */
    async listInstances(options?: { tag?: string; worldId?: string; includeFull?: boolean }): Promise<Instance[]> {
        if (options?.worldId) {
            return this.findInstancesByWorld(options.worldId);
        }
        const dbInstances = await instanceRepository.findAll({ tag: options?.tag, includeFull: true });
        const mapped = await Promise.all(
            dbInstances.map(async (db: InstanceRecord): Promise<Instance | null> => {
                const world = await worldRegistry.getWorldByDbId(db.worldId);
                return world ? this.toPublicInstance(db, world) : null;
            }),
        );
        const instances: Instance[] = mapped.filter((i: Instance | null): i is Instance => i !== null);
        return options?.includeFull ? instances : instances.filter((i: Instance) => i.status === 'active');
    }

    /**
     * インスタンスのパスワードを検証
     */
    async verifyInstancePassword(instanceId: string, password: string): Promise<boolean> {
        const dbInstance = await instanceRepository.findById(instanceId);
        if (!dbInstance?.passwordHash) {
            return false;
        }
        return bcrypt.compare(password, dbInstance.passwordHash);
    }

    /**
     * サーバー再起動後にインメモリのエンティティ状態が失われた場合、
     * ワールド定義の initialEntities からインスタンスエンティティを再配置する。
     */
    async reinitializeEntities(instanceId: string, worldId: string): Promise<void> {
        const world = await worldRegistry.getWorld(worldId);
        if (!world?.initialEntities?.length) return;
        let placed = 0;
        for (const gameObject of world.initialEntities) {
            for (const flat of flattenGameObject(gameObject)) {
                createEntity(instanceId, flat);
                placed += 1;
            }
        }
        logger.info(
            `インスタンス ${instanceId} のエンティティ状態を再初期化しました (GameObject ${world.initialEntities.length}件 → Component ${placed}件)`,
        );
    }

    /**
     * インスタンスを取得
     */
    async getInstance(instanceId: string): Promise<Instance | undefined> {
        const dbInstance = await instanceRepository.findById(instanceId);
        if (!dbInstance) return undefined;

        const world = await worldRegistry.getWorldByDbId(dbInstance.worldId);
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

        // インスタンスのエンティティ状態をクリーンアップ
        clearInstanceState(instanceId);

        logger.info(`インスタンス終了: ${instanceId}`);

        return { success: true };
    }

    /**
     * userManager の在籍変化通知。emptyTimer を真値に合わせる:
     *   - 1 人以上いるなら走っている削除タイマーをキャンセル
     *   - 0 人なら delete を予約 (発火直前にも再度真値を確認して見送る)
     *
     * DB の currentUsers は触らない (toPublicInstance が常に userManager から導出するため)。
     * 旧 updateUserCount / reconcileUserCounts は不要になったので削除済。
     */
    syncEmptyTimer(instanceId: string): void {
        const count = userManager.getUsersByWorld(instanceId).length;
        const existing = this.emptyTimers.get(instanceId);
        if (count > 0) {
            if (existing) {
                clearTimeout(existing);
                this.emptyTimers.delete(instanceId);
            }
            return;
        }
        if (existing) return; // 既に削除予約済
        const timeoutMs = appConfig.instance.emptyTimeoutMs;
        const timer = setTimeout(async () => {
            this.emptyTimers.delete(instanceId);
            // 削除直前の最終チェック (grace 中に再参加していれば見送る)
            if (userManager.getUsersByWorld(instanceId).length > 0) {
                logger.info(`インスタンス削除を取消（再参加検出）: ${instanceId}`);
                return;
            }
            await instanceRepository.delete(instanceId);
            clearInstanceState(instanceId);
            logger.info(`インスタンス自動削除（${timeoutMs / 1000}秒経過）: ${instanceId}`);
        }, timeoutMs);
        this.emptyTimers.set(instanceId, timer);
    }

    /**
     * ワールドIDからインスタンスを検索（既存インスタンスへの参加用）
     */
    async findInstancesByWorld(worldId: string): Promise<Instance[]> {
        const world = await worldRegistry.getWorld(worldId);
        if (!world) return [];

        const dbInstances = await instanceRepository.findByWorldId(world.dbId);
        return dbInstances.map((dbInstance: InstanceRecord) => this.toPublicInstance(dbInstance, world));
    }

    /**
     * ワールドの環境設定を取得
     */
    async getWorldEnvironment(worldId: string): Promise<WorldEnvironmentData> {
        const world = await worldRegistry.getWorld(worldId);
        if (world) {
            return {
                backgroundColor: world.environment.backgroundColor,
                worldSize: world.environment.worldSize,
            };
        }
        return DEFAULTS.WORLD_ENVIRONMENT;
    }

    /**
     * DB record から公開用のInstanceオブジェクトに変換
     *
     * currentUsers / status は userManager (= 真の在籍) から導出する。
     * DB の currentUsers は一切書き込まれず、参照もされない (将来的にスキーマ削除予定)。
     */
    private toPublicInstance(
        dbInstance: Awaited<ReturnType<typeof instanceRepository.findById>> & object,
        world: {
            id: string;
            version: string;
            displayName: string;
            thumbnail?: string;
            authorId: string;
            authorName?: string;
        },
    ): Instance {
        const access: InstanceAccess = {
            type: dbInstance.accessType,
            tags: dbInstance.accessTags ?? [],
            password: dbInstance.hasPassword,
        };

        const truthCount = userManager.getUsersByWorld(dbInstance.id).length;
        const derivedStatus: Instance['status'] =
            truthCount >= dbInstance.maxUsers ? 'full' : truthCount === 0 ? 'closing' : 'active';

        return {
            id: dbInstance.id,
            status: derivedStatus,
            leaderId: dbInstance.leaderId,
            createdAt: dbInstance.createdAt.toISOString(),
            expiresAt: dbInstance.expiresAt?.toISOString() ?? null,

            world: {
                id: world.id,
                version: world.version,
                displayName: world.displayName,
                thumbnail: world.thumbnail,
                authorId: world.authorId,
                authorName: world.authorName,
            },

            access,
            stats: {
                currentUsers: truthCount,
                maxUsers: dbInstance.maxUsers,
            },
            connection: {
                url: DEFAULTS.WORLD_ID, // 将来的にはサーバーURLを返す
                namespace: `/${dbInstance.id}`,
            },
        };
    }

    /**
     * 全インスタンスを削除（サーバー起動時の孤立レコードクリーンアップ用）
     */
    async cleanupAll(): Promise<number> {
        return instanceRepository.deleteAll();
    }
}

// シングルトンインスタンス
export const instanceManager = new InstanceManager();
