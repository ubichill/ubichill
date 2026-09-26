import type { ModLock, WorldDefinition, WorldSignature } from '@ubichill/shared';
import { relations } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import { users } from './users';

export const worlds = pgTable('worlds', {
    id: varchar('id', { length: 21 })
        .$defaultFn(() => nanoid())
        .primaryKey(),
    authorId: text('author_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull().unique(),
    version: varchar('version', { length: 50 }).notNull(),
    definition: jsonb('definition').$type<WorldDefinition>().notNull(),
    // mod 完全性ロック。人間が書く definition とは分離して別カラムに保存し、
    // 配信時は兄弟エンドポイント（/worlds/:id/lock）で返す。null 可（未ロックの旧世界）。
    lock: jsonb('lock').$type<ModLock>(),
    // 作者が手元の鍵で付けた署名（definition + lock に対する）。サーバーは鍵を持たず検証して保存するだけ。
    // 内容が変わると無効になるので、配信時に毎回検証する（無効なら配信しない）。
    signature: jsonb('signature').$type<WorldSignature>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const worldsRelations = relations(worlds, ({ one }) => ({
    author: one(users, {
        fields: [worlds.authorId],
        references: [users.id],
    }),
    // favoritedBy は userFavorites.worldRef(URL) 化に伴い drizzle リレーションから外した
}));
