import { index, pgTable, primaryKey, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { instances } from './instances';

/**
 * 部屋への招待。招待された人は、期限まで（部屋が消えれば一緒に消える）公開範囲にかかわらずその部屋に入れる。
 * 送れるかは送るときに shared の inviteRefusal で確かめる。同じ部屋・同じ相手には 1 つ（送り直すと期限と一言を新しくする）。
 * 送った人・招待された人は、このサーバーのユーザーの ID か、ほかのサーバーの actor の URL（連合）。
 */
export const instanceInvites = pgTable(
    'instance_invites',
    {
        id: text('id').primaryKey(),
        instanceId: varchar('instance_id', { length: 21 })
            .notNull()
            .references(() => instances.id, { onDelete: 'cascade' }),
        inviterId: text('inviter_id').notNull(),
        inviteeId: text('invitee_id').notNull(),
        message: text('message'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (table) => [
        uniqueIndex('instance_invites_instance_invitee_idx').on(table.instanceId, table.inviteeId),
        index('instance_invites_invitee_idx').on(table.inviteeId),
        index('instance_invites_expires_idx').on(table.expiresAt),
    ],
);

/**
 * リクエストインバイト（requester が target に「あなたのいる部屋に入れて」と頼んだ）。2 人の間に 1 つ。
 * target が答える（招待する・断る）か、期限が過ぎたら消える。どちらも、ほかのサーバーの actor の URL のことがある（連合。
 * ほかのサーバーの人へ頼んだ記録は、同じ相手へ期限内に何度も送らないための印）。
 */
export const inviteRequests = pgTable(
    'invite_requests',
    {
        requesterId: text('requester_id').notNull(),
        /** ほかのサーバーから来たリクエストの RequestInvite の id（応じる Invite の inReplyTo に使う） */
        activityId: text('activity_id'),
        targetId: text('target_id').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (table) => [
        primaryKey({ name: 'invite_requests_pk', columns: [table.requesterId, table.targetId] }),
        index('invite_requests_target_idx').on(table.targetId),
        index('invite_requests_expires_idx').on(table.expiresAt),
    ],
);
