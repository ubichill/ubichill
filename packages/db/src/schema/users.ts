import { relations } from 'drizzle-orm';
import {
    type AnyPgColumn,
    boolean,
    index,
    jsonb,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from 'drizzle-orm/pg-core';
import { instanceAccessTypeEnum } from './instanceAccessType';
import { worlds } from './worlds';

export const friendStatusEnum = pgEnum('friend_status', ['pending', 'accepted']);

/** お気に入り一覧の公開範囲（値は shared の FAVORITES_VISIBILITIES と同じ）。 */
export const favoritesVisibilityEnum = pgEnum('favorites_visibility', ['private', 'friends', 'public']);
export const presenceVisibilityEnum = pgEnum('presence_visibility', ['location', 'online', 'hidden']);

// Better Auth統合ユーザーテーブル
// Better Authが必要とするフィールド + アプリ独自のフィールド
export const users = pgTable('users', {
    // Better Auth required fields (text型、UUIDではなくnanoid)
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    /** プロフィール画像の URL。書くのはサーバーだけ（better-auth の /update-user は HTTP から塞いでいる）。 */
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // App-specific fields
    /**
     * 表示名（name）の一意性キー（displayNameKey: NFKC・空白圧縮・小文字化）。VRChat のように表示名を一意にする。
     * 移行時に他人と重複していた既存ユーザーは null（表示名の変更を促す）。
     */
    displayNameKey: varchar('display_name_key', { length: 120 }).unique(),
    /** 最後に表示名の一意キーを変えた時刻（変更の制限に使う）。登録時の名前と、見た目だけの変更は数えない。 */
    displayNameChangedAt: timestamp('display_name_changed_at', { withTimezone: true }),
    /** URL・署名・機械処理用の ID（英小文字・数字・_、一意、変更不可）。作者アカウントは handle@domain。 */
    handle: varchar('handle', { length: 30 }).notNull().unique(),
    /** 自己紹介（任意。プロフィールとリンクのプレビューに出す） */
    bio: text('bio'),
    /** 初期パスワードのまま（公式アカウントの初期作成時など）。変更するまで変更を促す。 */
    passwordChangeRequired: boolean('password_change_required').default(false).notNull(),
});

// Better Auth session table
export const sessions = pgTable(
    'sessions',
    {
        id: text('id').primaryKey(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        token: text('token').notNull().unique(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        ipAddress: text('ip_address'),
        userAgent: text('user_agent'),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /**
         * このセッションでパスワードを確かめた時刻（パスワードでのログイン・変更・再認証）。null は外部の SSO だけで入った。
         * 管理者の操作は、これがあるセッションだけに許す（外部サーバーが乗っ取られても管理者の権限は渡さない）。
         */
        passwordVerifiedAt: timestamp('password_verified_at', { withTimezone: true }),
        /** SSO で入ったときの外部アカウント（accounts.id）。外部アカウントを外すと、そのアカウントで作ったセッションも消える */
        authAccountId: text('auth_account_id').references((): AnyPgColumn => accounts.id, { onDelete: 'cascade' }),
    },
    (table) => [
        index('sessions_user_id_idx').on(table.userId),
        index('sessions_auth_account_id_idx').on(table.authAccountId),
    ],
);

// Better Auth account table (for password/oauth)
export const accounts = pgTable(
    'accounts',
    {
        id: text('id').primaryKey(),
        accountId: text('account_id').notNull(),
        providerId: text('provider_id').notNull(),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        accessToken: text('access_token'),
        refreshToken: text('refresh_token'),
        idToken: text('id_token'),
        accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
        refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
        scope: text('scope'),
        password: text('password'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        index('accounts_user_id_idx').on(table.userId),
        // 外部アカウント（providerId = 方式と認証サーバー、accountId = そのサーバー内の ID）は 1 人にだけ結び付く
        uniqueIndex('accounts_provider_account_unique').on(table.providerId, table.accountId),
    ],
);

// Better Auth verification table (for email verification)
export const verifications = pgTable('verifications', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const userSettings = pgTable('user_settings', {
    userId: text('user_id')
        .primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    disableExternalUrls: boolean('disable_external_urls').default(false).notNull(),
    /** お気に入り一覧の公開範囲。初期値は本人だけ（行が無いユーザーも private として扱う）。 */
    favoritesVisibility: favoritesVisibilityEnum('favorites_visibility').default('private').notNull(),
    /** ホームワールドの正規 URL。NULL は公式の既定ワールド（shared の DEFAULT_HOME_WORLD_REF）。 */
    homeWorldRef: text('home_world_ref'),
    /** ホームの部屋の公開範囲。初期値は招待のみ。 */
    homeAccessType: instanceAccessTypeEnum('home_access_type').default('invite_only').notNull(),
    /** フェディバースからのフォローを承認制にするか（shared の DEFAULT_FEDIVERSE_SETTINGS と同じ初期値） */
    fediverseManuallyApprovesFollowers: boolean('fediverse_manually_approves_followers').default(false).notNull(),
    /** フェディバースのおすすめ・検索に出してよいか */
    fediverseDiscoverable: boolean('fediverse_discoverable').default(true).notNull(),
    /** オンライン状態をフレンドにどこまで見せるか（shared の DEFAULT_PRESENCE_VISIBILITY と同じ初期値） */
    presenceVisibility: presenceVisibilityEnum('presence_visibility').default('location').notNull(),
    /** 使われていないワールドの画像を自動で消すか（shared の DEFAULT_STORAGE_SETTINGS と同じ初期値） */
    worldAssetAutoCleanup: boolean('world_asset_auto_cleanup').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * プロフィールの項目（ひとこと・バナー・リンク・言語）。users（better-auth の表）は広げず、1 対 1 の表に分ける。
 * 行は最初に編集したときに作る（無ければ全部未設定として扱う）。自己紹介（bio）とアイコン（image）は users にある。
 */
export const userProfiles = pgTable('user_profiles', {
    userId: text('user_id')
        .primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    /** ひとこと（任意・1 行。shared の ProfileStatusSchema） */
    status: text('status'),
    /** バナー画像の URL（アップロードしたもの。中身は profile_images） */
    bannerImage: text('banner_image'),
    /** プロフィールのリンク（正規形の https の URL の配列。shared の ProfileLinksSchema） */
    links: jsonb('links').$type<string[]>().notNull().default([]),
    /** 話せる言語（BCP 47 のコードの配列。shared の PROFILE_LANGUAGES から選ぶ） */
    languages: jsonb('languages').$type<string[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userFriends = pgTable(
    'user_friends',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        friendId: text('friend_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        status: friendStatusEnum('status').default('pending').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    },
    // 主キーは (user_id, friend_id)。相手側（friend_id）で引くときの索引
    (table) => [
        primaryKey({ columns: [table.userId, table.friendId] }),
        index('user_friends_friend_id_idx').on(table.friendId),
    ],
);

export const userFavorites = pgTable(
    'user_favorites',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        // ワールド参照＝正規 URL（worlds.id への FK を廃止。official/外部ワールドは DB に無い）
        worldRef: text('world_ref').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [primaryKey({ columns: [table.userId, table.worldRef] })],
);

export const usersRelations = relations(users, ({ one, many }) => ({
    settings: one(userSettings),
    profile: one(userProfiles),
    friends: many(userFriends, { relationName: 'userFriends' }),
    friendsOf: many(userFriends, { relationName: 'friendUsers' }),
    favorites: many(userFavorites),
    worlds: many(worlds),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
    user: one(users, {
        fields: [userSettings.userId],
        references: [users.id],
    }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
    user: one(users, {
        fields: [userProfiles.userId],
        references: [users.id],
    }),
}));

export const userFriendsRelations = relations(userFriends, ({ one }) => ({
    user: one(users, {
        fields: [userFriends.userId],
        references: [users.id],
        relationName: 'userFriends',
    }),
    friend: one(users, {
        fields: [userFriends.friendId],
        references: [users.id],
        relationName: 'friendUsers',
    }),
}));

export const userFavoritesRelations = relations(userFavorites, ({ one }) => ({
    user: one(users, {
        fields: [userFavorites.userId],
        references: [users.id],
    }),
    // world は URL 参照（worldRef）になったため drizzle リレーションは持たない
}));
