import { relations } from 'drizzle-orm';
import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';

/**
 * 連合ピア（他の ubichill インスタンス）。
 *
 * 自インスタンスが「フォロー」した他サーバーの一覧。
 * ワールド一覧の「グローバル」タブで、これらのピアから取得したワールドを表示する。
 */
export const federationPeers = pgTable('federation_peers', {
    id: varchar('id', { length: 21 })
        .$defaultFn(() => nanoid())
        .primaryKey(),
    /** ピアの base URL（例: https://other.example.com）。末尾のスラッシュは保存時に除去。 */
    baseUrl: text('base_url').notNull().unique(),
    /** ピアの表示名（省略時は baseUrl）。 */
    displayName: text('display_name'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const federationPeersRelations = relations(federationPeers, () => ({
    // ピアは独立したエンティティ。worlds とは URL 経由で解決するためリレーションは持たない。
}));
