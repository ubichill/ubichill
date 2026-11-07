import { type InstanceRecord, instanceRepository, inviteRepository } from '@ubichill/db';
import type {
    CreateInstanceRequest,
    Instance,
    InstanceAccess,
    WorldIdentity,
    WorldMod,
    WorldSource,
} from '@ubichill/shared';
import { canJoinInstance, canSeeInstance, type InstanceAudience, isPublishable } from '@ubichill/shared';
import bcrypt from 'bcryptjs';
import { appConfig } from '../../config';
import { logger } from '../../utils/logger';
import { friendIdsOf } from '../social/friends';
import { worldRegistry } from '../worlds/worldRegistry';
import { instanceRuntime, type RoomPresence } from './instanceRuntime';

const hasPassword = (record: Pick<InstanceRecord, 'passwordHash'>): boolean => record.passwordHash !== null;

/** 認可・パスワードによる入室拒否。再試行しても結果は変わらない（障害による失敗と区別する）。 */
export type CloseInstanceResult =
    | { success: true }
    | { success: false; reason: 'not-found' | 'forbidden' | 'runtime-unavailable' | 'delete-failed'; error: string };

export class InstanceJoinRejected extends Error {}

/**
 * インスタンスマネージャー
 * インスタンスの CRUD と公開データ変換を担う（DBベース）。
 * 空インスタンスの掃除（寿命管理）は責務を分離し instanceReaper が担当する。
 */
class InstanceManager {
    /**
     * 新しいインスタンスを作成
     */
    async createInstance(request: CreateInstanceRequest, leaderId: string): Promise<Instance | { error: string }> {
        // worldId は id でも URL でもよい（URL の場合は自ホスト/外部＝連合を解決する）
        const resolution = await worldRegistry.resolveRefDetailed(request.worldId);
        if (!resolution.ok) {
            return {
                error: resolution.reason === 'integrity' ? resolution.message : `World not found: ${request.worldId}`,
            };
        }
        const world = resolution.world;

        const maxUsers = request.settings?.maxUsers ?? world.capacity.default;
        const cappedMaxUsers = Math.min(maxUsers, world.capacity.max);

        // パスワードがある場合はハッシュ化
        let passwordHash: string | undefined;
        if (request.access?.password) {
            passwordHash = await bcrypt.hash(request.access.password, 10);
        }

        // DBにインスタンスを作成（ワールドは URL で参照する。official/外部ワールドも instance 化可）
        const dbInstance = await instanceRepository.create({
            worldRef: world.url,
            // 作成時の版。自サーバーで公開した版なら、この行がある間はその版を消さない
            contentHash: world.identity?.contentHash ?? null,
            worldVersionId: resolution.versionId ?? null,
            leaderId,
            accessType: request.access?.type ?? 'public',
            accessTags: request.access?.tags ?? [],
            maxUsers: cappedMaxUsers,
            passwordHash,
        });

        try {
            await instanceRuntime.provision(dbInstance.id, cappedMaxUsers, world);
        } catch (error) {
            await instanceRepository.delete(dbInstance.id);
            throw error;
        }

        logger.info(`インスタンス作成: ${dbInstance.id} (world: ${world.id})`);

        return this.toPublicInstance(dbInstance, world);
    }

    /**
     * インスタンス一覧を取得
     *
     * status / 人数は Go runtime から導出するため DB の status フィルタは信頼しない。
     * 全件取って toPublicInstance で正しい値を計算し、includeFull=false なら ここで post-filter する。
     */
    async listInstances(options?: {
        tag?: string;
        worldId?: string;
        includeFull?: boolean;
        /** 見る人（公開範囲で絞る。ログインしていなければ null でパブリックだけ）。 */
        viewerId?: string | null;
    }): Promise<Instance[]> {
        const viewerId = options?.viewerId ?? null;
        const friends = await friendIdsOf(viewerId);
        const presence = await instanceRuntime.presence();
        const visible = (db: InstanceRecord) => canSeeInstance(this.audienceOf(db, presence), viewerId, friends);
        if (options?.worldId) {
            return this.withViewerAccess(
                await this.findInstancesByWorld(options.worldId, visible, presence),
                viewerId,
                friends,
                presence,
            );
        }
        const dbInstances = (await instanceRepository.findAll({ tag: options?.tag, includeFull: true })).filter(
            visible,
        );
        const mapped = await Promise.all(
            dbInstances.map(async (db: InstanceRecord): Promise<Instance | null> => {
                const world = await worldRegistry.getWorldByUrl(db.worldRef);
                return world ? this.toPublicInstance(db, world, presence) : null;
            }),
        );
        // 未署名ワールドのインスタンスは一覧に出さない（URL を知っている人だけが確認付きで入れる）。
        const instances: Instance[] = mapped.filter(
            (i: Instance | null): i is Instance => i !== null && isPublishable(i.world.identity),
        );
        const shown = options?.includeFull ? instances : instances.filter((i: Instance) => i.status === 'active');
        return this.withViewerAccess(shown, viewerId, friends, presence);
    }

    /**
     * 見る人がそれぞれの部屋にそのまま入れるかを付ける（招待のみの部屋がフレンドに見えているだけなら false）。
     * 画面は false の部屋に「入る」ではなく「リクエスト」を出す。
     */
    async withViewerAccess(
        instances: Instance[],
        viewerId: string | null,
        friends: ReadonlySet<string>,
        presence: Map<string, RoomPresence>,
    ): Promise<Instance[]> {
        const audienceOf = (instance: Instance) => ({
            accessType: instance.access.type,
            leaderId: instance.leaderId,
            memberIds: presence.get(instance.id)?.memberIds ?? [],
        });
        // 招待を引くのは、招待が無いと入れない部屋だけ（ほとんどの部屋は引かずに済む）
        const needsInvite = instances.filter((i) => !canJoinInstance(audienceOf(i), viewerId, friends));
        const invited =
            viewerId && needsInvite.length > 0
                ? await inviteRepository.validInstanceIdsFor(
                      viewerId,
                      needsInvite.map((i) => i.id),
                  )
                : new Set<string>();
        return instances.map((instance) => ({
            ...instance,
            canJoin: canJoinInstance(audienceOf(instance), viewerId, friends, { invited: invited.has(instance.id) }),
        }));
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
     * インスタンスを取得 (公開用 Instance。world 解決が必要)。
     * world が解決できない場合は undefined を返す。
     */
    async getInstance(instanceId: string): Promise<Instance | undefined> {
        const dbInstance = await instanceRepository.findById(instanceId);
        if (!dbInstance) {
            logger.debug(`getInstance: DB に instance がありません (id: ${instanceId})`);
            return undefined;
        }

        const world = await worldRegistry.getWorldByUrl(dbInstance.worldRef);
        if (!world) {
            logger.warn(`getInstance: world 解決失敗 (instanceId: ${instanceId}, worldRef: ${dbInstance.worldRef})`);
            return undefined;
        }

        return this.toPublicInstance(dbInstance, world);
    }

    /**
     * 見る人に見える・入れるインスタンスだけを返す（入れるかは canJoin）。見えなければ、あることも伏せる（undefined）。
     * 招待のみの部屋は、中にいる人のフレンドには見えるが、招待が無ければ canJoin が false。
     */
    async getInstanceFor(instanceId: string, viewerId: string | null): Promise<Instance | undefined> {
        const dbInstance = await instanceRepository.findById(instanceId);
        if (!dbInstance) return undefined;
        const access = await this.accessFor(dbInstance, viewerId);
        if (!access.canSee && !access.canJoin) return undefined;
        const instance = await this.getInstance(instanceId);
        return instance && { ...instance, canJoin: access.canJoin };
    }

    /** 見る人がインスタンスに入れるか（公開範囲と招待）。 */
    async canJoin(instanceId: string, viewerId: string): Promise<boolean> {
        const dbInstance = await instanceRepository.findById(instanceId);
        return !!dbInstance && (await this.accessFor(dbInstance, viewerId)).canJoin;
    }

    /** 見えるか・入れるか。招待は期限内のものだけ効く。 */
    private async accessFor(
        dbInstance: Pick<InstanceRecord, 'id' | 'accessType' | 'leaderId'>,
        viewerId: string | null,
    ): Promise<{ canSee: boolean; canJoin: boolean }> {
        const [presence, friends] = await Promise.all([instanceRuntime.presence(), friendIdsOf(viewerId)]);
        const audience = this.audienceOf(dbInstance, presence);
        const canSee = canSeeInstance(audience, viewerId, friends);
        if (canJoinInstance(audience, viewerId, friends)) return { canSee, canJoin: true };
        // 公開範囲で入れないときだけ招待を引く
        const invited = viewerId ? (await inviteRepository.findValid(dbInstance.id, viewerId)) !== undefined : false;
        return { canSee, canJoin: canJoinInstance(audience, viewerId, friends, { invited }) };
    }

    /** 公開範囲の判定に要る情報（参加している人は Go runtime が真）。 */
    audienceOf(
        dbInstance: Pick<InstanceRecord, 'id' | 'accessType' | 'leaderId'>,
        presence: Map<string, RoomPresence>,
    ): InstanceAudience {
        return {
            accessType: dbInstance.accessType,
            leaderId: dbInstance.leaderId,
            memberIds: presence.get(dbInstance.id)?.memberIds ?? [],
        };
    }

    /**
     * SNSの入室可否を確認し、Go用の短期チケットを発行する。
     * 表示名もチケットに入れ、Go はクライアントが送る名前より優先する（ほかの参加者になりすませないように）。
     */
    async join(instanceId: string, participant: { id: string; name: string }, password?: string) {
        const userId = participant.id;
        const record = await instanceRepository.findById(instanceId);
        if (!record) throw new InstanceJoinRejected('このインスタンスには入れません');
        const access = await this.accessFor(record, userId);
        if (!access.canJoin) {
            throw new InstanceJoinRejected(
                access.canSee ? 'このインスタンスに入るには招待が要ります' : 'このインスタンスには入れません',
            );
        }
        if (hasPassword(record) && (!password || !(await this.verifyInstancePassword(instanceId, password)))) {
            throw new InstanceJoinRejected('パスワードが正しくありません');
        }
        const world = await worldRegistry.getWorldByUrl(record.worldRef);
        if (!world) throw new Error('ワールドを取得できません');
        const owner = await instanceRuntime.provision(record.id, record.maxUsers, world);
        return instanceRuntime.ticket(record.id, userId, ticketName(participant.name), owner);
    }

    /**
     * インスタンスを終了する。Go 側の部屋を閉じられたと確かめてから DB を消す（確かめられなければ DB を残して失敗を返す。
     * 先に DB だけ消すと、Go に部屋が残ったまま誰からも見えなくなる）。
     */
    async closeInstance(instanceId: string, userId: string): Promise<CloseInstanceResult> {
        const dbInstance = await instanceRepository.findById(instanceId);
        if (!dbInstance) return { success: false, reason: 'not-found', error: 'Instance not found' };
        if (dbInstance.leaderId !== userId) {
            return { success: false, reason: 'forbidden', error: 'Only the leader can close the instance' };
        }

        if (!(await instanceRuntime.close(instanceId))) {
            return {
                success: false,
                reason: 'runtime-unavailable',
                error: 'インスタンスを終了できませんでした。しばらくしてからやり直してください',
            };
        }

        const deleted = await instanceRepository.deleteByLeader(instanceId, userId);
        if (!deleted) return { success: false, reason: 'delete-failed', error: 'Failed to delete instance' };

        logger.info(`インスタンス終了: ${instanceId}`);
        return { success: true };
    }

    /**
     * ワールドIDからインスタンスを検索（既存インスタンスへの参加用）
     */
    async findInstancesByWorld(
        worldRef: string,
        visible: (db: InstanceRecord) => boolean,
        presence: Map<string, RoomPresence>,
    ): Promise<Instance[]> {
        const world = await worldRegistry.resolveRef(worldRef);
        if (!world) return [];

        const dbInstances = (await instanceRepository.findByWorldRef(world.url)).filter(visible);
        return Promise.all(
            dbInstances.map((dbInstance: InstanceRecord) => this.toPublicInstance(dbInstance, world, presence)),
        );
    }

    /**
     * DB record から公開用のInstanceオブジェクトに変換
     *
     * currentUsers / status は Go runtime (= 真の在籍) から導出する（DB には持たない）。
     */
    private async toPublicInstance(
        dbInstance: Awaited<ReturnType<typeof instanceRepository.findById>> & object,
        world: {
            id: string;
            version: string;
            displayName: string;
            description?: string;
            thumbnail?: string;
            authorId?: string;
            authorName?: string;
            source?: WorldSource;
            mods?: WorldMod[];
            identity?: WorldIdentity;
        },
        knownPresence?: Map<string, RoomPresence>,
    ): Promise<Instance> {
        const access: InstanceAccess = {
            type: dbInstance.accessType,
            tags: dbInstance.accessTags ?? [],
            password: hasPassword(dbInstance),
        };

        const presence = knownPresence ?? (await instanceRuntime.presence());
        const truthCount = presence.get(dbInstance.id)?.memberIds.length ?? 0;
        const derivedStatus: Instance['status'] = truthCount >= dbInstance.maxUsers ? 'full' : 'active';

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
                description: world.description,
                thumbnail: world.thumbnail,
                // 本体作成ワールドは authorId を持つ。外部/official ワールドは空（provenance は source 側）。
                authorId: world.authorId ?? '',
                authorName: world.authorName,
                source: world.source,
                mods: world.mods ?? [],
                identity: world.identity,
            },

            access,
            stats: {
                currentUsers: truthCount,
                maxUsers: dbInstance.maxUsers,
            },
            connection: {
                url: appConfig.runtime.publicUrl,
                namespace: `/${dbInstance.id}`,
            },
        };
    }
}

// シングルトンインスタンス
export const instanceManager = new InstanceManager();

/** Go が受け付ける表示名（1〜30 文字）に収める。収まらない古い名前はチケットに入れず、Go はクライアントの名前を使う。 */
export function ticketName(name: string): string | undefined {
    const trimmed = name.trim();
    const length = [...trimmed].length;
    return length >= 1 && length <= 30 ? trimmed : undefined;
}
