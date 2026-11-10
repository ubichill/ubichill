/**
 * ユーザーのブロックの純粋な規則（backend と frontend で同じ規則を使う）。
 *
 * - ブロックは片方向の行（blocker が blocked をブロックした）。blocked はこのサーバーのユーザー ID か、ほかのサーバーの actor の URL。
 * - 見えなくするのはブロックした側から（{@link hiddenIdsOf}）。ブロックされた側の画面は変えない（ブロックを明かさない）。
 * - やり取り（フレンドの申請・承認、招待、リクエストインバイト、メッセージ、フォロー、通知）は、どちらの向きのブロックでも
 *   止める（{@link interactionRefusal}）。種類ごとの条件（フレンドか・部屋にいるか）は種類ごとの規則
 *   （inviteRefusal・inviteRequestRefusal・messageRefusal）にあり、ここは全部に共通の前提だけを持つ。
 * - mod の作者は作者アカウント（`handle@domain`）で突き合わせる（{@link isModAuthorBlocked}）。
 */
import { z } from 'zod';
import type { UserSummary } from './friends';
import { parseAuthorAccount } from './handle';

/** ブロックの行（blockerId が blockedId をブロックした）。 */
export interface BlockEdge {
    blockerId: string;
    blockedId: string;
}

export const BLOCK_LIMITS = {
    /** 1 人がブロックできる人数 */
    MAX_BLOCKS: 1000,
} as const;

/** blocker が blocked をブロックしているか（向きを見る）。 */
export function hasBlocked(edges: readonly BlockEdge[], blockerId: string, blockedId: string): boolean {
    return edges.some((e) => e.blockerId === blockerId && e.blockedId === blockedId);
}

/**
 * やり取りを止める共通の理由。
 * - `self`: 自分自身とはやり取りしない
 * - `blocking`: from が to をブロックしている（from 本人には理由を明かしてよい）
 * - `blocked`: to が from をブロックしている（from にはブロックを明かさない）
 *
 * 止めたときの答え方は種類ごとに決まっている（ブロックされた側から見て、ブロックと見分けがつかない形にする）:
 *
 * | やり取り | blocking | blocked |
 * |---|---|---|
 * | フレンドの申請 | 解除を促す（409） | 送れたように見せて何もしない |
 * | フレンドの承認 | 申請が無いのと同じ（404） | 同じ |
 * | メッセージ・リアクション | フレンドでないのと同じ | 同じ |
 * | 招待・リクエストインバイト | ブロックでフレンドが消えるので「フレンドでない」 | 同じ |
 * | 連合で届いた申請・フォロー・通知 | 黙って捨てる（フォローは Reject） | 同じ |
 */
export type InteractionRefusal = 'self' | 'blocking' | 'blocked';

/** from が to に何か（申請・招待・メッセージなど）をしてよいか。よければ null。 */
export function interactionRefusal(
    fromId: string,
    toId: string,
    edges: readonly BlockEdge[],
): InteractionRefusal | null {
    if (fromId === toId) return 'self';
    if (hasBlocked(edges, fromId, toId)) return 'blocking';
    if (hasBlocked(edges, toId, fromId)) return 'blocked';
    return null;
}

/** 2 人のどちらかが、もう片方をブロックしているか（{@link interactionRefusal} がブロックで止めるか）。自分自身とは false。 */
export function isBlockedBetween(edges: readonly BlockEdge[], a: string, b: string): boolean {
    const refusal = interactionRefusal(a, b, edges);
    return refusal === 'blocking' || refusal === 'blocked';
}

/** me から見えなくする人（me がブロックした人）。 */
export function hiddenIdsOf(edges: readonly BlockEdge[], me: string): Set<string> {
    return new Set(edges.filter((e) => e.blockerId === me).map((e) => e.blockedId));
}

export type BlockRefusal = 'self' | 'limit';

/** ブロックできない理由（自分自身・上限）。すでにブロックしている相手は数えない（ブロックし直しは何もしない）。 */
export function blockRefusal(input: {
    blockerId: string;
    targetId: string;
    currentCount: number;
    alreadyBlocked: boolean;
}): BlockRefusal | null {
    if (input.blockerId === input.targetId) return 'self';
    if (!input.alreadyBlocked && input.currentCount >= BLOCK_LIMITS.MAX_BLOCKS) return 'limit';
    return null;
}

export const BLOCK_REFUSAL_MESSAGES: Record<BlockRefusal, string> = {
    self: '自分はブロックできません',
    limit: `ブロックできるのは ${BLOCK_LIMITS.MAX_BLOCKS} 人までです`,
};

/**
 * 作者アカウントを突き合わせる形にする（`handle@domain` を小文字に。`@`・`acct:`・前後の空白は除く）。読めなければ null。
 * handle の大文字は作者アカウントとして正しくないが、ブロックの突き合わせでは取りこぼさないよう小文字に揃えて比べる。
 */
export function authorAccountKey(account: string): string | null {
    const parsed = parseAuthorAccount(account.trim().toLowerCase());
    return parsed ? `${parsed.handle}@${parsed.domain}` : null;
}

/** ブロックした人の作者アカウントの集まり（読めないものは捨てる）。 */
export function blockedAuthorKeys(accounts: readonly (string | null | undefined)[]): ReadonlySet<string> {
    return new Set(accounts.flatMap((a) => (a ? (authorAccountKey(a) ?? []) : [])));
}

/**
 * mod の作者（署名で確かめた作者アカウント）がブロックした人か。作者の無い mod（データだけ・開発の未署名）は false。
 * ドメインまで一致したときだけ一致とする（ほかのサーバーの同じ handle は別人）。
 */
export function isModAuthorBlocked(author: string | null | undefined, blocked: ReadonlySet<string>): boolean {
    if (!author || blocked.size === 0) return false;
    const key = authorAccountKey(author);
    return key !== null && blocked.has(key);
}

/** ブロックした人（設定の一覧）。 */
export interface BlockedUser extends UserSummary {
    /** ブロックした日時（ISO 8601） */
    blockedAt: string;
    /** 作者アカウント（`handle@domain`）。この人が作った mod を読み込まないために使う。分からなければ null */
    account: string | null;
}

/** `GET /api/v1/social/blocks` */
export interface BlocksResponse {
    blocks: BlockedUser[];
}

/** `POST /api/v1/social/blocks` */
export const BlockRequestSchema = z.object({ userId: z.string().min(1).max(2048) }).strict();
export type BlockRequest = z.infer<typeof BlockRequestSchema>;
