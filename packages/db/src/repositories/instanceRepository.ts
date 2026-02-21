import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import { instances } from '../schema';

export type InstanceRecord = typeof instances.$inferSelect;

export interface CreateInstanceInput {
    id?: string;
    worldId: string;
    leaderId: string;
    accessType?: 'public' | 'friend_plus' | 'friend_only' | 'invite_only';
    accessTags?: string[];
    hasPassword?: string;
    maxUsers?: number;
    passwordHash?: string;
}

export interface UpdateInstanceInput {
    status?: 'active' | 'full' | 'closing';
    currentUsers?: number;
    expiresAt?: Date | null;
}

export const instanceRepository = {
    async findById(id: string): Promise<InstanceRecord | undefined> {
        const results = await db.select().from(instances).where(eq(instances.id, id));
        return results[0];
    },

    async findByWorldId(worldId: string): Promise<InstanceRecord[]> {
        return db.select().from(instances).where(eq(instances.worldId, worldId));
    },

    async findByLeaderId(leaderId: string): Promise<InstanceRecord[]> {
        return db.select().from(instances).where(eq(instances.leaderId, leaderId));
    },

    async findAll(options?: { includeFull?: boolean; tag?: string }): Promise<InstanceRecord[]> {
        let query = db.select().from(instances);

        if (!options?.includeFull) {
            query = query.where(and(eq(instances.status, 'active'), eq(instances.status, 'active'))) as typeof query;
        }

        const results = await query;

        // タグフィルタリングはメモリ上で行う（jsonbフィールドのため）
        if (options?.tag) {
            const tag = options.tag;
            return results.filter((i) => i.accessTags?.includes(tag));
        }

        return results;
    },

    async create(input: CreateInstanceInput): Promise<InstanceRecord> {
        const results = await db
            .insert(instances)
            .values({
                id: input.id,
                worldId: input.worldId,
                leaderId: input.leaderId,
                accessType: input.accessType ?? 'public',
                accessTags: input.accessTags ?? [],
                hasPassword: input.hasPassword ?? 'false',
                maxUsers: input.maxUsers ?? 10,
                currentUsers: 0,
                passwordHash: input.passwordHash,
            })
            .returning();
        return results[0];
    },

    async update(id: string, input: UpdateInstanceInput): Promise<InstanceRecord | undefined> {
        const results = await db
            .update(instances)
            .set({
                ...input,
            })
            .where(eq(instances.id, id))
            .returning();
        return results[0];
    },

    async updateUserCount(id: string, delta: number): Promise<InstanceRecord | undefined> {
        const instance = await this.findById(id);
        if (!instance) return undefined;

        const newCount = Math.max(0, instance.currentUsers + delta);
        const newStatus: 'active' | 'full' | 'closing' =
            newCount >= instance.maxUsers ? 'full' : newCount === 0 ? 'closing' : 'active';

        return this.update(id, {
            currentUsers: newCount,
            status: newStatus,
        });
    },

    async delete(id: string): Promise<boolean> {
        const result = await db.delete(instances).where(eq(instances.id, id)).returning();
        return result.length > 0;
    },

    async deleteByLeader(id: string, leaderId: string): Promise<boolean> {
        const result = await db
            .delete(instances)
            .where(and(eq(instances.id, id), eq(instances.leaderId, leaderId)))
            .returning();
        return result.length > 0;
    },
};
