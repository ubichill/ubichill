import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { instances } from './instances';
import { users } from './users';

/**
 * サーバー間の連合（docs/design/federation.md）。ほかのサーバーのことは、ほかのサーバーが権威で、ここに持つのはキャッシュと
 * このサーバーが決めたこと（フレンドの関係・配送の予定・付き合い方）だけ。
 */

/** actor の鍵（ubichill 同士の Ed25519 か、Mastodon・Misskey などの RSA）。 */
export type RemoteActorKeyRecord = { id: string; publicKeyMultibase: string } | { id: string; publicKeyPem: string };

/** ほかのサーバーの actor（取りに行った文書のキャッシュ。WebFinger の往復で確かめたものだけ）。 */
export const remoteActors = pgTable(
    'remote_actors',
    {
        /** actor の id（https の URL） */
        id: text('id').primaryKey(),
        /** `handle@domain`（WebFinger で確かめたもの） */
        account: text('account').notNull().unique(),
        /** ホスト（ポート付き。account の domain と同じ） */
        domain: text('domain').notNull(),
        type: text('type').notNull().default('Person'),
        name: text('name'),
        summary: text('summary'),
        icon: text('icon'),
        /** プロフィールの画面 */
        url: text('url'),
        inbox: text('inbox').notNull(),
        sharedInbox: text('shared_inbox'),
        /** 鍵（Ed25519 の Multikey と、ほかの実装の RSA の PEM） */
        keys: jsonb('keys').$type<RemoteActorKeyRecord[]>().notNull().default([]),
        /** 告知している機能（FEP-844e） */
        features: jsonb('features').$type<string[]>().notNull().default([]),
        fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
        /** 消えた（410・Delete を受けた） */
        deletedAt: timestamp('deleted_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('remote_actors_domain_idx').on(table.domain)],
);

/** 知っているほかのサーバー（連絡がつくたびに自動で記録する）と、配送の調子。 */
export const remoteServers = pgTable('remote_servers', {
    /** ホスト（ポート付き） */
    domain: text('domain').primaryKey(),
    software: text('software'),
    version: text('version'),
    /** ubichill の連合の版（ubichill でなければ NULL） */
    federationVersion: integer('federation_version'),
    /** Application actor が告知している機能 */
    features: jsonb('features').$type<string[]>().notNull().default([]),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    /** 成功のあと最初に失敗した時刻（成功で消す）。3 日続けば到達できないとみなす */
    failingSince: timestamp('failing_since', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** この時刻まで送らない（続けて失敗したとき） */
    pausedUntil: timestamp('paused_until', { withTimezone: true }),
    nodeInfoFetchedAt: timestamp('node_info_fetched_at', { withTimezone: true }),
});

/** ほかのサーバーとの付き合い方（管理者が決める。無ければ連合する）。 */
export const domainPolicies = pgTable(
    'domain_policies',
    {
        domain: text('domain').primaryKey(),
        policy: text('policy').$type<'limit' | 'block'>().notNull(),
        reason: text('reason'),
        createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [check('domain_policies_policy_check', sql`${table.policy} IN ('limit', 'block')`)],
);

/**
 * このサーバーのユーザーと、ほかのサーバーの actor のフレンドの関係。
 * - outgoing: こちらから申請した（相手の承認待ち）
 * - incoming: 相手から申請が来た（こちらの承認待ち）
 * - accepted: フレンド
 * - rejected: こちらが断った（冷却期間の間、同じ相手からの申請を受けない）
 */
export const remoteFriendships = pgTable(
    'remote_friendships',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        actorId: text('actor_id')
            .notNull()
            .references(() => remoteActors.id, { onDelete: 'cascade' }),
        state: text('state').$type<'outgoing' | 'incoming' | 'accepted' | 'rejected'>().notNull(),
        /** 申請の Offer の id（どちらが出したものでも） */
        offerId: text('offer_id').notNull(),
        /** 申請の Relationship の id */
        relationshipId: text('relationship_id').notNull(),
        /** 承認の Accept の id（承認した側の Undo に使う） */
        acceptId: text('accept_id'),
        /** お互いに申請したときの、相手の Offer の id（相手は解除をこの Offer の Undo で送ってくる） */
        peerOfferId: text('peer_offer_id'),
        /** 相手のホームに関係を確かめた時刻（届かなかった知らせの埋め合わせ。null は早く確かめる） */
        checkedAt: timestamp('checked_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({ name: 'remote_friendships_pk', columns: [table.userId, table.actorId] }),
        index('remote_friendships_checked_idx').on(table.checkedAt),
        check(
            'remote_friendships_state_check',
            sql`${table.state} IN ('outgoing', 'incoming', 'accepted', 'rejected')`,
        ),
        index('remote_friendships_actor_idx').on(table.actorId),
        index('remote_friendships_offer_idx').on(table.offerId),
        index('remote_friendships_peer_offer_idx').on(table.peerOfferId),
    ],
);

/** 送る activity の予定（宛先のホストごとに、同じ 2 人の間は順に送る）。 */
export const federationDeliveries = pgTable(
    'federation_deliveries',
    {
        id: text('id').primaryKey(),
        /** 署名する actor（このサーバーのユーザー。NULL なら Application actor） */
        senderUserId: text('sender_user_id').references(() => users.id, { onDelete: 'cascade' }),
        inbox: text('inbox').notNull(),
        host: text('host').notNull(),
        body: jsonb('body').notNull(),
        /** 順に送る組（`<送り手>|<受け手>`） */
        orderKey: text('order_key').notNull(),
        attempts: integer('attempts').notNull().default(0),
        nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
        deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
        /** 送っている間（ほかの backend が同時に取らない） */
        lockedUntil: timestamp('locked_until', { withTimezone: true }),
        lastError: text('last_error'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('federation_deliveries_due_idx').on(table.nextAttemptAt),
        index('federation_deliveries_order_idx').on(table.orderKey, table.createdAt),
        index('federation_deliveries_host_idx').on(table.host),
    ],
);

/** 受けた activity の id・RPC の (keyid, nonce)。2 度目は何もしない・断る。 */
export const federationSeen = pgTable(
    'federation_seen',
    {
        key: text('key').primaryKey(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (table) => [index('federation_seen_expires_idx').on(table.expiresAt)],
);

/** このサーバーのユーザーが、ほかのサーバーの部屋に来訪している（ホームが仲介した入室と、画面からの知らせ）。 */
export const remoteVisits = pgTable('remote_visits', {
    userId: text('user_id')
        .primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    /** 部屋の URL */
    roomUrl: text('room_url').notNull(),
    /** 部屋の作り（RoomCard）。現在地の答えに使う */
    room: jsonb('room').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** このサーバーの部屋に入れた、ほかのサーバーの来訪者（部屋が続く間は、入り直しに招待を求めない）。 */
export const federatedAdmissions = pgTable(
    'federated_admissions',
    {
        instanceId: varchar('instance_id', { length: 21 })
            .notNull()
            .references(() => instances.id, { onDelete: 'cascade' }),
        actorId: text('actor_id').notNull(),
        admittedAt: timestamp('admitted_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [primaryKey({ name: 'federated_admissions_pk', columns: [table.instanceId, table.actorId] })],
);

/**
 * このサーバーの actor の RSA の鍵（Mastodon・Misskey など、ほかの実装の署名に使う）。Ed25519 と違い種から導けないので、
 * 初めて要るときに作って保存する。秘密鍵は種から導いた鍵で暗号化する（DB だけ漏れても署名できない）。
 */
export const federationActorKeys = pgTable('federation_actor_keys', {
    /** このサーバーの actor の id（ユーザーか Application actor） */
    actorId: text('actor_id').primaryKey(),
    /** ユーザーの鍵なら、そのユーザー（消えたら鍵も消す）。Application actor は NULL */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** SPKI の PEM */
    publicKeyPem: text('public_key_pem').notNull(),
    /** 暗号化した PKCS#8 の秘密鍵（base64。AES-256-GCM の iv・tag・本文） */
    privateKeyEncrypted: text('private_key_encrypted').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * このサーバーのユーザーをフォローしている、ほかのサーバーの actor（片方向。フレンドとは別）。
 * - pending: 承認待ち（承認制のユーザー）
 * - accepted: フォロワー
 */
export const federationFollowers = pgTable(
    'federation_followers',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        actorId: text('actor_id')
            .notNull()
            .references(() => remoteActors.id, { onDelete: 'cascade' }),
        state: text('state').$type<'pending' | 'accepted'>().notNull(),
        /** 相手の Follow の id（Accept・Reject に埋め込み、Undo で引く） */
        followId: text('follow_id').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({ name: 'federation_followers_pk', columns: [table.userId, table.actorId] }),
        check('federation_followers_state_check', sql`${table.state} IN ('pending', 'accepted')`),
        index('federation_followers_actor_idx').on(table.actorId),
        index('federation_followers_follow_idx').on(table.followId),
    ],
);
