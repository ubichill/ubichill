import type { ModLock, WorldSignature } from '@ubichill/shared';
import { relations } from 'drizzle-orm';
import { jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import { users } from './users';

export const worlds = pgTable(
    'worlds',
    {
        id: varchar('id', { length: 21 })
            .$defaultFn(() => nanoid())
            .primaryKey(),
        authorId: text('author_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /** 内部の ID（エディタ・API の `/api/v1/worlds/:name`）。サーバーが作る。公開の URL は作者 + world_name。 */
        name: varchar('name', { length: 255 }).notNull().unique(),
        /**
         * 作者が付けた名前（metadata.name）。ホストは書き換えず、作者 + この名前でワールドを区別する
         * （同じ作者が同じ名前で送れば同じワールドの更新）。署名の name と一致し、公開の URL
         * （`/@handle/name`、`/api/v1/authors/handle/worlds/name.yaml`）になる。
         */
        worldName: varchar('world_name', { length: 50 }).notNull(),
        version: varchar('version', { length: 50 }).notNull(),
        // 作者が送った YAML を読んだ生の値（スキーマの既定値は入れない。署名の対象そのもの）。読む側でスキーマを通す
        definition: jsonb('definition').$type<unknown>().notNull(),
        // mod 完全性ロック。人間が書く definition とは分離して別カラムに保存し、
        // 配信時は兄弟エンドポイント（/worlds/:id/lock）で返す。null 可（未ロックの旧世界）。
        lock: jsonb('lock').$type<ModLock>(),
        // 作者が手元の鍵で付けた署名（definition + lock に対する）。サーバーは鍵を持たず検証して保存するだけ。
        // 内容が変わると無効になるので、配信時に毎回検証する（無効なら配信しない）。
        signature: jsonb('signature').$type<WorldSignature>(),
        // 公開中のワールドを編集したときの下書き（公開中の版＝definition/lock/signature はそのまま残す）。
        // 公開すると definition 側へ反映して消す。未公開のワールドは下書きを definition に直接保存する。
        draftDefinition: jsonb('draft_definition').$type<unknown>(),
        draftLock: jsonb('draft_lock').$type<ModLock>(),
        draftUpdatedAt: timestamp('draft_updated_at'),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => [uniqueIndex('worlds_author_world_name_unique').on(table.authorId, table.worldName)],
);

/**
 * 名前を変えたワールドの以前の名前。以前の URL（お気に入り・インスタンス・共有したリンク）からも同じワールドをたどれるようにする。
 * 同じ作者が以前の名前で新しいワールドを作ったら、そちらが優先される（行を消す）。
 */
export const worldNameAliases = pgTable(
    'world_name_aliases',
    {
        authorId: text('author_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 50 }).notNull(),
        worldId: varchar('world_id', { length: 21 })
            .notNull()
            .references(() => worlds.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [primaryKey({ columns: [table.authorId, table.name] })],
);

export const worldsRelations = relations(worlds, ({ one }) => ({
    author: one(users, {
        fields: [worlds.authorId],
        references: [users.id],
    }),
    // favoritedBy は userFavorites.worldRef(URL) 化に伴い drizzle リレーションから外した
}));
