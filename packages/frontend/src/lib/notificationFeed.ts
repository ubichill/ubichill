/**
 * 通知の一覧の状態の合成（一覧の取得・SSE の差分・既読の楽観的な更新）。どれも純粋な関数。
 * 未読数はサーバーの値が正（読み込んでいないページの未読も数える）。手元の変化は差分で足し引きし、次の取得で正に戻す。
 */
import {
    type AppNotification,
    feedPositionOf,
    isNewerThan,
    type NotificationPage,
    type NotificationStreamEvent,
    sortFeed,
} from '@ubichill/shared';

export interface FeedState {
    items: AppNotification[];
    /** 読み込んだ最後のページの続き（無ければ最後まで読んだ） */
    nextCursor: string | null;
    unreadCount: number;
    loaded: boolean;
}

export const EMPTY_FEED: FeedState = { items: [], nextCursor: null, unreadCount: 0, loaded: false };

export type ReadTarget = { ids: readonly string[] } | { all: true };

/** 既読の楽観的な更新を戻すための記録。 */
export interface ReadUndo {
    ids: string[];
    unreadDelta: number;
}

const clamp = (n: number): number => Math.max(0, n);

/**
 * 最初のページを取り直した（初回・SSE の繋ぎ直し・フォーカス）。ページの範囲は取り直した中身に置き換え
 * （消えた通知を落とし、既読を揃える）、それより古く読み込んであった分は残す。
 */
export function withFirstPage(state: FeedState, page: NotificationPage): FeedState {
    const last = page.items.at(-1);
    const freshIds = new Set(page.items.map((n) => n.id));
    const olderKept =
        page.nextCursor && last
            ? state.items.filter((n) => !freshIds.has(n.id) && isNewerThan(feedPositionOf(last), feedPositionOf(n)))
            : [];
    return {
        items: [...page.items, ...olderKept],
        nextCursor: olderKept.length > 0 ? state.nextCursor : page.nextCursor,
        unreadCount: page.unreadCount,
        loaded: true,
    };
}

/** 続きのページを足す（重なりは手元のものを置き換える）。 */
export function withNextPage(state: FeedState, page: NotificationPage): FeedState {
    const incoming = new Map(page.items.map((n) => [n.id, n]));
    const kept = state.items.filter((n) => !incoming.has(n.id));
    return {
        items: sortFeed([...kept, ...page.items]),
        nextCursor: page.nextCursor,
        unreadCount: page.unreadCount,
        loaded: true,
    };
}

/**
 * どれを既読にするか。お知らせはサーバーが「どこまで読んだか」の位置で持つので、あるお知らせを既読にすると
 * それより前のお知らせも既読になる。手元も同じ規則で揃える。
 */
function readIdsOf(items: readonly AppNotification[], target: ReadTarget): Set<string> {
    if ('all' in target) return new Set(items.filter((n) => !n.read).map((n) => n.id));
    const ids = new Set(target.ids);
    const latestAnnounce = items
        .filter((n) => n.type === 'Announce' && ids.has(n.id))
        .map(feedPositionOf)
        .reduce<ReturnType<typeof feedPositionOf> | undefined>(
            (max, p) => (!max || isNewerThan(p, max) ? p : max),
            undefined,
        );
    return new Set(
        items
            .filter(
                (n) =>
                    !n.read &&
                    (ids.has(n.id) ||
                        (n.type === 'Announce' && latestAnnounce && !isNewerThan(feedPositionOf(n), latestAnnounce))),
            )
            .map((n) => n.id),
    );
}

/** 既読にする（楽観的）。戻すための記録を返す。 */
export function markReadLocally(state: FeedState, target: ReadTarget): { state: FeedState; undo: ReadUndo } {
    const ids = readIdsOf(state.items, target);
    const unreadCount = 'all' in target ? 0 : clamp(state.unreadCount - ids.size);
    return {
        state: { ...state, items: state.items.map((n) => (ids.has(n.id) ? { ...n, read: true } : n)), unreadCount },
        undo: { ids: [...ids], unreadDelta: state.unreadCount - unreadCount },
    };
}

/** 既読にできなかった（通信の失敗）。楽観的に変えた分だけ戻す（そのあと届いた通知・消えた通知はそのまま）。 */
export function undoMarkRead(state: FeedState, undo: ReadUndo): FeedState {
    const ids = new Set(undo.ids);
    return {
        ...state,
        items: state.items.map((n) => (ids.has(n.id) ? { ...n, read: false } : n)),
        unreadCount: state.unreadCount + undo.unreadDelta,
    };
}

/** SSE で届いた差分を当てる。 */
export function withStreamEvent(state: FeedState, event: NotificationStreamEvent): FeedState {
    switch (event.type) {
        case 'notification': {
            const existing = state.items.find((n) => n.id === event.notification.id);
            const unreadDelta = existing
                ? Number(!event.notification.read) - Number(!existing.read)
                : Number(!event.notification.read);
            return {
                ...state,
                items: sortFeed([...state.items.filter((n) => n.id !== event.notification.id), event.notification]),
                unreadCount: clamp(state.unreadCount + unreadDelta),
            };
        }
        case 'read':
            return markReadLocally(state, event.ids ? { ids: event.ids } : { all: true }).state;
        case 'removed': {
            const ids = new Set(event.ids);
            const removedUnread = state.items.filter((n) => ids.has(n.id) && !n.read).length;
            return {
                ...state,
                items: state.items.filter((n) => !ids.has(n.id)),
                unreadCount: clamp(state.unreadCount - removedUnread),
            };
        }
    }
}

/** 既読にしたあとのサーバーの未読数で揃える。 */
export const withUnreadCount = (state: FeedState, unreadCount: number): FeedState => ({ ...state, unreadCount });
