import { eq } from 'drizzle-orm';
import { db } from '../index';
import { federationPeers } from '../schema';

export interface CreateFederationPeerInput {
    baseUrl: string;
    displayName?: string | null;
}

export type FederationPeerRecord = typeof federationPeers.$inferSelect;

/**
 * 連合ピアリポジトリ
 * フォローしている他 ubichill インスタンスの CRUD を提供。
 */
export const federationPeerRepository = {
    /**
     * すべてのピアを取得
     */
    async findAll(): Promise<FederationPeerRecord[]> {
        return db.select().from(federationPeers);
    },

    /**
     * ID でピアを取得
     */
    async findById(id: string): Promise<FederationPeerRecord | undefined> {
        const results = await db.select().from(federationPeers).where(eq(federationPeers.id, id));
        return results[0];
    },

    /**
     * baseUrl でピアを取得
     */
    async findByBaseUrl(baseUrl: string): Promise<FederationPeerRecord | undefined> {
        const results = await db.select().from(federationPeers).where(eq(federationPeers.baseUrl, baseUrl));
        return results[0];
    },

    /**
     * ピアを作成
     */
    async create(input: CreateFederationPeerInput): Promise<FederationPeerRecord> {
        const results = await db
            .insert(federationPeers)
            .values({
                baseUrl: input.baseUrl,
                displayName: input.displayName,
            })
            .returning();
        return results[0];
    },

    /**
     * ピアを削除
     */
    async delete(id: string): Promise<boolean> {
        const results = await db.delete(federationPeers).where(eq(federationPeers.id, id)).returning();
        return results.length > 0;
    },
};
