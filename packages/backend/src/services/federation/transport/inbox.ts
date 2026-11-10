/**
 * 受けた activity を振り分ける（署名を確かめたあと）。
 *
 * - activity.actor は署名した actor と同じ（ほかの人を名乗らせない）。id と actor は同じオリジン（readActivity）
 * - 同じ id の activity は 2 度目を何もしない（処理し終えたら 7 日覚える）。処理に失敗したら、相手の送り直しを受ける
 * - 処理中に同じ id が届いたら busy（503）で送り直してもらう（受けたことにすると、1 度目が失敗したとき失われる）
 * - 知らない型は受けて捨てる（相手の版が新しくても壊れない）
 */
import { FEDERATION_LIMITS, readActivity } from '@ubichill/shared';
import type { Follows } from '../fediverse/follows';
import type { FriendshipActor, RemoteFriendships } from '../ubichill/friendships';
import type { FederatedInvites } from '../ubichill/invites';

export interface InboxDeps {
    seen: {
        remember(key: string, expiresAt: Date, now: Date): Promise<boolean>;
        has(key: string, now: Date): Promise<boolean>;
        forget(key: string): Promise<void>;
    };
    friendships: Pick<RemoteFriendships, 'onOffer' | 'onAccept' | 'onReject' | 'onUndo' | 'onActorDeleted'>;
    follows: Pick<Follows, 'onFollow' | 'onUndo' | 'onActorDeleted'>;
    invites: Pick<FederatedInvites, 'onInvite' | 'onRequestInvite'>;
    actors: {
        /** 取り直す（Update を受けたとき） */
        refresh(actorId: string): Promise<unknown>;
        markDeleted(actorId: string, at: Date): Promise<void>;
    };
    now(): number;
}

/** 受けた結果（HTTP の答え: accepted は 202、forbidden は 403、malformed は 400、busy は 503）。 */
export type InboxOutcome = 'accepted' | 'forbidden' | 'malformed' | 'busy';

/** 処理中の印を持つ時間（backend が処理中に落ちても、この後は送り直しを受ける） */
const PROCESSING_MS = 60_000;

export function createInbox(deps: InboxDeps) {
    return {
        async receive(actor: FriendshipActor, json: unknown): Promise<InboxOutcome> {
            const read = readActivity(json);
            if (!read.ok) return read.reason === 'cross-origin' ? 'forbidden' : 'malformed';
            const activity = read.activity;
            if (activity.actor !== actor.id) return 'forbidden';

            const now = deps.now();
            const done = `activity|${activity.id}`;
            const processing = `inbox-processing|${activity.id}`;
            if (await deps.seen.has(done, new Date(now))) return 'accepted';
            if (!(await deps.seen.remember(processing, new Date(now + PROCESSING_MS), new Date(now)))) return 'busy';
            try {
                // 印を取る間に、ほかの backend が処理し終えていた
                if (await deps.seen.has(done, new Date(now))) return 'accepted';
                switch (activity.type) {
                    case 'friend-offer':
                        await deps.friendships.onOffer(actor, activity);
                        break;
                    case 'accept':
                        await deps.friendships.onAccept(actor, activity);
                        break;
                    case 'reject':
                        await deps.friendships.onReject(actor, activity);
                        break;
                    case 'undo':
                        // フォローの取り下げでなければ、フレンドの申請・承認の取り消し
                        if (!(await deps.follows.onUndo(actor, activity.object)))
                            await deps.friendships.onUndo(actor, activity);
                        break;
                    case 'follow':
                        await deps.follows.onFollow(actor, activity);
                        break;
                    case 'invite':
                        await deps.invites.onInvite(actor, activity);
                        break;
                    case 'request-invite':
                        await deps.invites.onRequestInvite(actor, activity);
                        break;
                    case 'update-actor':
                        await deps.actors.refresh(actor.id);
                        break;
                    case 'delete-actor':
                        await deps.actors.markDeleted(actor.id, new Date(now));
                        await deps.friendships.onActorDeleted(actor.id);
                        await deps.follows.onActorDeleted(actor.id);
                        break;
                    case 'unknown':
                        break;
                }
                await deps.seen.remember(done, new Date(now + FEDERATION_LIMITS.SEEN_ACTIVITY_MS), new Date(now));
                return 'accepted';
            } finally {
                await deps.seen.forget(processing);
            }
        },
    };
}

export type Inbox = ReturnType<typeof createInbox>;
