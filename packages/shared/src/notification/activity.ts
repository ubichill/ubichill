/**
 * 通知の形（ActivityStreams 2.0 に寄せる）。将来ほかのサーバーと送り合えるように、種類は AS2 の語彙を使う。
 * - Follow: フレンド申請（object は申請された人）
 * - Accept: 申請の承認（object は承認された Follow）
 * - Like: ワールドのお気に入り（object はワールド。`World` は ubichill の拡張の型）
 * - Announce: 運営からのお知らせ（object は Note）
 */
import { z } from 'zod';

export const NOTIFICATION_TYPES = ['Follow', 'Accept', 'Like', 'Announce'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** 保存（notifications の表）する種類。Announce はお知らせの表から読むので行を作らない。 */
export const STORED_NOTIFICATION_TYPES = ['Follow', 'Accept', 'Like'] as const satisfies readonly NotificationType[];
export type StoredNotificationType = (typeof STORED_NOTIFICATION_TYPES)[number];

export const NOTIFICATION_LIMITS = {
    /** 通知・お知らせを残す日数（これより古いものは掃除する） */
    RETENTION_DAYS: 90,
    /** 1 人あたりに残す通知の件数（多い分は古い順に消す） */
    MAX_PER_RECIPIENT: 200,
    /** 一覧の 1 ページの件数の上限 */
    MAX_PAGE_SIZE: 50,
    DEFAULT_PAGE_SIZE: 20,
    /** 一度に既読にできる ID の数 */
    MAX_READ_IDS: 100,
    ANNOUNCEMENT_TITLE_MAX: 100,
    ANNOUNCEMENT_CONTENT_MAX: 2000,
} as const;

/** このサーバーのユーザー ID（nanoid・UUID）。`:` を含まないのでリモートの URI と取り違えない。 */
const LOCAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 認証情報（`user@`）・空白を含まない https の URI。 */
const HTTPS_URI_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/;

/** actor・object の id。このサーバーのユーザー ID か、ほかのサーバーの actor の URI（https）。 */
export const ActorIdSchema = z
    .string()
    .max(2048)
    .refine((v) => LOCAL_ID_PATTERN.test(v) || HTTPS_URI_PATTERN.test(v), 'ユーザー ID か https の URI ではありません');

export const NotificationActorSchema = z
    .object({
        type: z.literal('Person'),
        id: ActorIdSchema,
        name: z.string().min(1).max(200),
        /** handle（リモートの actor は `handle@domain`） */
        preferredUsername: z.string().min(1).max(320).nullable(),
        icon: z.string().max(2048).nullable(),
    })
    .strict();
export type NotificationActor = z.infer<typeof NotificationActorSchema>;

const PersonRefSchema = z.object({ type: z.literal('Person'), id: ActorIdSchema }).strict();

export const FollowObjectSchema = PersonRefSchema;
export const AcceptObjectSchema = z
    .object({ type: z.literal('Follow'), actor: ActorIdSchema, object: ActorIdSchema })
    .strict();
export const LikeObjectSchema = z
    .object({
        type: z.literal('World'),
        id: z.string().url().max(2048),
        name: z.string().min(1).max(200),
    })
    .strict();
export const AnnounceObjectSchema = z
    .object({
        type: z.literal('Note'),
        id: z.string().min(1).max(64),
        summary: z.string().min(1).max(NOTIFICATION_LIMITS.ANNOUNCEMENT_TITLE_MAX),
        content: z.string().min(1).max(NOTIFICATION_LIMITS.ANNOUNCEMENT_CONTENT_MAX),
    })
    .strict();

/** 種類ごとの object の形（DB の jsonb を読み書きするときもこれで確かめる）。 */
export const NOTIFICATION_OBJECT_SCHEMAS = {
    Follow: FollowObjectSchema,
    Accept: AcceptObjectSchema,
    Like: LikeObjectSchema,
    Announce: AnnounceObjectSchema,
} as const satisfies Record<NotificationType, z.ZodType>;

export type NotificationObjectOf<T extends NotificationType> = z.infer<(typeof NOTIFICATION_OBJECT_SCHEMAS)[T]>;

const base = {
    id: z.string().min(1).max(64),
    actor: NotificationActorSchema,
    /** 作られた時刻（ISO 8601） */
    published: z.string().datetime({ offset: true }),
    read: z.boolean(),
};

export const NotificationSchema = z.discriminatedUnion('type', [
    z.object({ ...base, type: z.literal('Follow'), object: FollowObjectSchema }).strict(),
    z.object({ ...base, type: z.literal('Accept'), object: AcceptObjectSchema }).strict(),
    z.object({ ...base, type: z.literal('Like'), object: LikeObjectSchema }).strict(),
    z.object({ ...base, type: z.literal('Announce'), object: AnnounceObjectSchema }).strict(),
]);
export type AppNotification = z.infer<typeof NotificationSchema>;

/** 種類と object の組を確かめる（DB から読んだ jsonb・書く前の値）。取り違えていれば undefined。 */
export function parseNotificationObject<T extends NotificationType>(
    type: T,
    object: unknown,
): NotificationObjectOf<T> | undefined {
    const result = NOTIFICATION_OBJECT_SCHEMAS[type].safeParse(object);
    return result.success ? (result.data as NotificationObjectOf<T>) : undefined;
}

export const isNotificationType = (value: string): value is NotificationType =>
    (NOTIFICATION_TYPES as readonly string[]).includes(value);

// ── API の形 ──────────────────────────────────────────────

export interface NotificationPage {
    items: AppNotification[];
    /** 次のページのカーソル（無ければ最後） */
    nextCursor: string | null;
    unreadCount: number;
}

export const MarkReadRequestSchema = z.union([
    z.object({ all: z.literal(true) }).strict(),
    z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(NOTIFICATION_LIMITS.MAX_READ_IDS) }).strict(),
]);
export type MarkReadRequest = z.infer<typeof MarkReadRequestSchema>;

export const CreateAnnouncementRequestSchema = z
    .object({
        title: z.string().trim().min(1).max(NOTIFICATION_LIMITS.ANNOUNCEMENT_TITLE_MAX),
        content: z.string().trim().min(1).max(NOTIFICATION_LIMITS.ANNOUNCEMENT_CONTENT_MAX),
    })
    .strict();
export type CreateAnnouncementRequest = z.infer<typeof CreateAnnouncementRequestSchema>;

export interface Announcement {
    id: string;
    title: string;
    content: string;
    published: string;
}

/**
 * SSE（`GET /api/v1/notifications/stream`）で届く出来事。`event:` の名前が type。
 * - notification: 新しい通知（お知らせを含む）
 * - read: ほかのタブ・端末で既読にした（ids が無ければ全部）
 * - removed: 通知が要らなくなった（申請の取り消し・拒否など）
 */
export const NotificationStreamEventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('notification'), notification: NotificationSchema }).strict(),
    z.object({ type: z.literal('read'), ids: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal('removed'), ids: z.array(z.string()).min(1) }).strict(),
]);
export type NotificationStreamEvent = z.infer<typeof NotificationStreamEventSchema>;

// ── 一覧のカーソル ─────────────────────────────────────────

/** 一覧の並び（新しい順）の位置。時刻が同じものは id の降順。 */
export interface FeedPosition {
    publishedMs: number;
    id: string;
}

export const encodeFeedCursor = (p: FeedPosition): string => `${p.publishedMs.toString(36)}.${p.id}`;

export function decodeFeedCursor(cursor: string): FeedPosition | undefined {
    const match = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{1,64})$/.exec(cursor);
    if (!match) return undefined;
    const publishedMs = Number.parseInt(match[1] as string, 36);
    return Number.isSafeInteger(publishedMs) ? { publishedMs, id: match[2] as string } : undefined;
}

/** a が b より前（新しい）か。 */
export const isNewerThan = (a: FeedPosition, b: FeedPosition): boolean =>
    a.publishedMs !== b.publishedMs ? a.publishedMs > b.publishedMs : a.id > b.id;

export const feedPositionOf = (n: Pick<AppNotification, 'published' | 'id'>): FeedPosition => ({
    publishedMs: Date.parse(n.published),
    id: n.id,
});

/** 新しい順に並べる（同じ時刻は id の降順。サーバーのカーソルと同じ順）。 */
export const sortFeed = <T extends Pick<AppNotification, 'published' | 'id'>>(items: readonly T[]): T[] =>
    [...items].sort((a, b) => {
        const [pa, pb] = [feedPositionOf(a), feedPositionOf(b)];
        if (isNewerThan(pa, pb)) return -1;
        return isNewerThan(pb, pa) ? 1 : 0;
    });
