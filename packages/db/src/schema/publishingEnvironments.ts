import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * 作者アカウントの公開環境（ブラウザ・CLI・CI）。1 つの公開環境 = 署名鍵 1 本（+ CLI・CI はアップロード用の API トークン）。
 * 秘密鍵は各環境の手元だけにあり、ここには公開鍵だけを置く。取り消しは削除せず revoked_at を立てる
 * （ほかのサーバーが「取り消し」と「取得失敗」を区別できるように鍵一覧に残す）。
 */
export const publishingEnvironments = pgTable(
    'publishing_environments',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /** browser / cli / ci / legacy（移行した旧 1 本鍵） */
        kind: text('kind').notNull(),
        name: text('name').notNull(),
        publicKey: text('public_key').notNull().unique(),
        apiTokenHash: text('api_token_hash').unique(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        lastUsedAt: timestamp('last_used_at'),
        revokedAt: timestamp('revoked_at'),
    },
    (table) => [index('publishing_environments_user_id_idx').on(table.userId)],
);
