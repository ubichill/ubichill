/**
 * 受けた activity を振り分ける（署名を確かめたあと）。
 *
 * - activity.actor は署名した actor と同じ（ほかの人を名乗らせない）。id と actor は同じオリジン（readActivity）
 * - 同じ id の activity は 2 度目を何もしない（7 日覚える）。処理に失敗したら忘れて、相手の送り直しを受ける
 * - 知らない型は受けて捨てる（相手の版が新しくても壊れない）
 */
import { FEDERATION_LIMITS, readActivity } from '@ubichill/shared';
import type { FriendshipActor, RemoteFriendships } from './friendships';
import type { FederatedInvites } from './invites';

export interface InboxDeps {
    seen: {
        remember(key: string, expiresAt: Date, now: Date): Promise<boolean>;
        forget(key: string): Promise<void>;
    };
    friendships: Pick<RemoteFriendships, 'onOffer' | 'onAccept' | 'onReject' | 'onUndo' | 'onActorDeleted'>;
    invites: Pick<FederatedInvites, 'onInvite' | 'onRequestInvite'>;
    actors: {
        /** 取り直す（Update を受けたとき） */
        refresh(actorId: string): Promise<unknown>;
        markDeleted(actorId: string, at: Date): Promise<void>;
    };
    now(): number;
}

/** 受けた結果（HTTP の答え: accepted は 202、forbidden は 403、malformed は 400）。 */
export type InboxOutcome = 'accepted' | 'forbidden' | 'malformed';

export function createInbox(deps: InboxDeps) {
    return {
        async receive(actor: FriendshipActor, json: unknown): Promise<InboxOutcome> {
            const read = readActivity(json);
            if (!read.ok) return read.reason === 'cross-origin' ? 'forbidden' : 'malformed';
            const activity = read.activity;
            if (activity.actor !== actor.id) return 'forbidden';

            const now = deps.now();
            const key = `activity|${activity.id}`;
            if (!(await deps.seen.remember(key, new Date(now + FEDERATION_LIMITS.SEEN_ACTIVITY_MS), new Date(now)))) {
                return 'accepted';
            }
            try {
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
                        await deps.friendships.onUndo(actor, activity);
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
                        break;
                    case 'unknown':
                        break;
                }
            } catch (error) {
                await deps.seen.forget(key);
                throw error;
            }
            return 'accepted';
        },
    };
}

export type Inbox = ReturnType<typeof createInbox>;
