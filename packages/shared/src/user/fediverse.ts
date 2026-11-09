/**
 * フェディバース（Mastodon・Misskey など）とのつながりの純粋な知識。ubichill のフレンドとは別の、片方向のフォロー。
 *
 * - フォロワーに見えるのはプロフィール（とこれから公開するノート）だけ。現在地・来訪・招待はフレンドだけ
 * - manuallyApprovesFollowers: フォローを承認制にするか。初期値は承認しない（Misskey・Mastodon と同じ）
 * - discoverable: ほかのサーバーのおすすめ・検索に出してよいか。アカウントを直接検索すれば、どちらでも見つかる
 */
import { z } from 'zod';

export interface FediverseSettings {
    manuallyApprovesFollowers: boolean;
    discoverable: boolean;
}

export const DEFAULT_FEDIVERSE_SETTINGS: FediverseSettings = { manuallyApprovesFollowers: false, discoverable: true };

/** `PUT /api/v1/fediverse/settings`。省略した項目は変えない。 */
export const FediverseSettingsUpdateSchema = z
    .object({ manuallyApprovesFollowers: z.boolean().optional(), discoverable: z.boolean().optional() })
    .strict()
    .refine((v) => v.manuallyApprovesFollowers !== undefined || v.discoverable !== undefined, {
        message: 'manuallyApprovesFollowers か discoverable のどちらかを指定してください',
    });
export type FediverseSettingsUpdate = z.infer<typeof FediverseSettingsUpdateSchema>;

export const FEDIVERSE_LIMITS = {
    /** 承認待ちのフォローの上限（1 人あたり。超えた分は断る） */
    MAX_PENDING_FOLLOWS: 500,
    /** 一覧で返すフォロワーの数 */
    FOLLOWERS_PAGE: 200,
} as const;

export type FollowerState = 'pending' | 'accepted';

/** フォロワー（ほかのサーバーの actor）。 */
export interface FediverseFollower {
    actorId: string;
    /** `handle@domain` */
    account: string;
    name: string | null;
    icon: string | null;
    /** プロフィールの画面 */
    url: string | null;
    state: FollowerState;
    /** フォローされた（申請された）時刻（ISO 8601） */
    since: string;
}

/** `GET /api/v1/fediverse`。enabled が false なら、このサーバーは連合していない（フォローされない）。 */
export interface FediverseOverview {
    enabled: boolean;
    /** フェディバースでのアカウント（`handle@domain`） */
    account: string;
    settings: FediverseSettings;
    pending: FediverseFollower[];
    followers: FediverseFollower[];
    followerCount: number;
}

/** `POST /api/v1/fediverse/followers/{approve,reject}` */
export const FollowerActionSchema = z.object({ actorId: z.string().url().max(2048) }).strict();
