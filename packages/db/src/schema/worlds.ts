import type { ModLock, WorldSignature } from '@ubichill/shared';
import { relations } from 'drizzle-orm';
import {
    type AnyPgColumn,
    foreignKey,
    index,
    jsonb,
    pgTable,
    primaryKey,
    text,
    timestamp,
    unique,
    uniqueIndex,
    varchar,
} from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import { users } from './users';

/**
 * 自サーバーで公開・編集するワールド。中身は版（world_versions）と下書き（world_drafts）に持ち、ここは所有と名前だけ。
 * id は API の `/api/v1/worlds/:worldId` の ID（0023 で、以前の name と同じ値にそろえた）。
 */
export const worlds = pgTable(
    'worlds',
    {
        id: varchar('id', { length: 21 })
            .$defaultFn(() => nanoid())
            .primaryKey(),
        authorId: text('author_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /**
         * 作者が付けた名前（metadata.name）。ホストは書き換えず、作者 + この名前でワールドを区別する
         * （同じ作者が同じ名前で送れば同じワールドの更新）。署名の name と一致し、公開の URL
         * （`/@handle/name`、`/api/v1/authors/handle/worlds/name.yaml`）になる。
         */
        worldName: varchar('world_name', { length: 50 }).notNull(),
        /** 公開中の版。未公開なら NULL（下書きを署名なしとして配る）。 */
        currentVersionId: varchar('current_version_id', { length: 21 }),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex('worlds_author_world_name_unique').on(table.authorId, table.worldName),
        // 別のワールドの版を current に指せないようにする（current_version_id が NULL なら検査されない）
        foreignKey({
            name: 'worlds_current_version_fk',
            columns: [table.id, table.currentVersionId],
            foreignColumns: [worldVersions.worldId, worldVersions.id],
        }),
    ],
);

/**
 * 公開した版。definition・lock・content_hash は変えない（INSERT のみ）。例外は署名し直しで、同じ content_hash への
 * 署名で signature の列だけを置き換える（鍵を取り消したあとなど）。
 */
export const worldVersions = pgTable(
    'world_versions',
    {
        id: varchar('id', { length: 21 })
            .$defaultFn(() => nanoid())
            .primaryKey(),
        worldId: varchar('world_id', { length: 21 })
            .notNull()
            .references((): AnyPgColumn => worlds.id, { onDelete: 'cascade' }),
        /** metadata.version。同じワールドで同じ version の中身は変えられない（上げずに差し替えさせない）。 */
        version: varchar('version', { length: 50 }).notNull(),
        /** 作者が送った YAML を読んだ生の値（スキーマの既定値は入れない。署名の対象そのもの）。 */
        definition: jsonb('definition').$type<unknown>().notNull(),
        lock: jsonb('lock').$type<ModLock>(),
        signature: jsonb('signature').$type<WorldSignature>(),
        /** shared の worldContentHash() の値（`sha256-<base64>`）。保存する側で別のハッシュ計算を書かない。 */
        contentHash: text('content_hash').notNull(),
        publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        unique('world_versions_world_id_version_unique').on(table.worldId, table.version),
        unique('world_versions_world_id_id_unique').on(table.worldId, table.id),
        index('world_versions_world_id_content_hash_idx').on(table.worldId, table.contentHash),
    ],
);

/** 編集中の下書き（ワールドごとに 0..1）。未公開のワールドでは、これを署名なしとして配る。 */
export const worldDrafts = pgTable('world_drafts', {
    worldId: varchar('world_id', { length: 21 })
        .primaryKey()
        .references(() => worlds.id, { onDelete: 'cascade' }),
    definition: jsonb('definition').$type<unknown>().notNull(),
    lock: jsonb('lock').$type<ModLock>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
