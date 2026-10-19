import { relations } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import { users } from './users';
import { worldVersions } from './worlds';

export const instanceStatusEnum = pgEnum('instance_status', ['active', 'full', 'closing']);
export const instanceAccessTypeEnum = pgEnum('instance_access_type', [
    'public',
    'friend_plus',
    'friend_only',
    'invite_only',
]);

export const instances = pgTable(
    'instances',
    {
        id: varchar('id', { length: 21 })
            .$defaultFn(() => nanoid())
            .primaryKey(),
        // ワールド参照＝正規 URL（worlds.id への FK を廃止。official/外部ワールドは DB に無い）
        worldRef: text('world_ref').notNull(),
        /** 作成時に解決したワールドの版（shared の worldContentHash()）。分からなければ NULL。 */
        contentHash: text('content_hash'),
        /**
         * 自サーバーで公開したワールドの版のときだけ。外部・公式・未公開（下書き）は NULL。
         * この行がある間は版を消せない（古い版の自動削除の基準。RESTRICT）。
         */
        worldVersionId: varchar('world_version_id', { length: 21 }).references(() => worldVersions.id, {
            onDelete: 'restrict',
        }),
        leaderId: text('leader_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        status: instanceStatusEnum('status').notNull().default('active'),
        accessType: instanceAccessTypeEnum('access_type').notNull().default('public'),
        accessTags: jsonb('access_tags').$type<string[]>().default([]),
        maxUsers: integer('max_users').notNull().default(10),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        expiresAt: timestamp('expires_at', { withTimezone: true }),
        /** パスワード保護（bcrypt のハッシュ）。パスワードがあるかはこの列が NULL でないかで決める。 */
        passwordHash: varchar('password_hash', { length: 255 }),
    },
    (table) => [
        index('instances_world_ref_idx').on(table.worldRef),
        index('instances_status_idx').on(table.status),
        index('instances_leader_id_idx').on(table.leaderId),
        index('instances_world_version_id_idx').on(table.worldVersionId),
    ],
);

export const instancesRelations = relations(instances, ({ one }) => ({
    // world は URL 参照（worldRef）になったため drizzle リレーションは持たない
    leader: one(users, {
        fields: [instances.leaderId],
        references: [users.id],
    }),
}));
