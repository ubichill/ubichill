/**
 * ユーザーのブロックの純粋な規則（backend と frontend で同じ規則を使う）。
 *
 * - ブロックは片方向の行（blocker が blocked をブロックした）。blocked はこのサーバーのユーザー ID か、ほかのサーバーの actor の URL。
 * - 見えなくするのはブロックした側から（{@link hiddenIdsOf}）。ブロックされた側の画面は変えない（ブロックを明かさない）。
 * - やり取り（フレンド申請・招待・リクエスト・メッセージ）は、どちらの向きのブロックでも止める（{@link isBlockedBetween}）。
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

/** 2 人のどちらかが、もう片方をブロックしているか（やり取りを止める判定）。自分自身とは false。 */
export function isBlockedBetween(edges: readonly BlockEdge[], a: string, b: string): boolean {
    if (a === b) return false;
    return hasBlocked(edges, a, b) || hasBlocked(edges, b, a);
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
