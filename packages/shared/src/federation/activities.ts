/**
 * AP 面の activity（AS2）。人から人への知らせだけを送り合う。
 *
 * | 出来事 | activity |
 * |---|---|
 * | フレンドの申請 | Offer{Relationship friendOf}（AS2 の例 147）。Follow は将来の片方向のフォローに空けておく |
 * | 承認・断る | Accept{Offer}・Reject{Offer} |
 * | 取り消し・解除 | 申請した側は Undo{Offer}、承認した側は Undo{Accept} |
 * | 招待 | Invite{object: Instance, target: 相手}（AS2 の例 24）。権利は部屋のサーバーが持つ |
 * | リクエストインバイト | 拡張の RequestInvite{object: 頼む相手}。応じるときは Invite（inReplyTo） |
 * | プロフィールの更新・削除 | Update{Person}・Delete{actor} |
| フォロー（Mastodon・Misskey などから） | Follow{Person}。答えは Accept{Follow}・Reject{Follow}（Follow を埋め込む）、やめるのは Undo{Follow} |
 *
 * 受けるときは知らない型・知らない項目を捨てる（形を厳しくしない。相手の版が新しくても壊れない）。
 * activity の id と actor は同じオリジン（FEP-fe34）。埋め込まれたほかのオリジンのものは表示のヒントにしか使わない。
 */
import { z } from 'zod';
import { ACTIVITY_CONTEXT, type RoomCard } from './protocol';
import { displayText } from './text';
import { sameOrigin } from './urls';

export const FRIEND_OF = 'http://purl.org/vocab/relationship/friendOf';

/** 送る activity（JSON-LD の文書。id は必ず持つ）。 */
export type ActivityDocument = Record<string, unknown> & { id: string };

export interface ActivityRef {
    id: string;
    type: string;
    actor?: string;
    /** 参照する activity の object（Follow の相手など。分かるときだけ） */
    object?: string;
}

const base = (id: string, type: string, actor: string, to: readonly string[]) => ({
    '@context': ACTIVITY_CONTEXT,
    id,
    type,
    actor,
    to: [...to],
});

export function buildFriendOffer(input: {
    id: string;
    actor: string;
    target: string;
    relationshipId: string;
    published: string;
}): ActivityDocument {
    return {
        ...base(input.id, 'Offer', input.actor, [input.target]),
        target: input.target,
        object: {
            id: input.relationshipId,
            type: 'Relationship',
            subject: input.actor,
            relationship: FRIEND_OF,
            object: input.target,
        },
        published: input.published,
    };
}

/** Accept・Reject・Undo（object は参照する activity の id と型と actor）。 */
export function buildResponse(
    type: 'Accept' | 'Reject' | 'Undo',
    input: { id: string; actor: string; to: string; object: ActivityRef },
): ActivityDocument {
    return { ...base(input.id, type, input.actor, [input.to]), object: { ...input.object } };
}

export function buildInvite(input: {
    id: string;
    actor: string;
    target: string;
    room: Pick<RoomCard, 'id' | 'name' | 'image' | 'accessType'> & { world?: RoomCard['world'] };
    content: string | null;
    endTime: string;
    inReplyTo?: string;
}): ActivityDocument {
    return {
        ...base(input.id, 'Invite', input.actor, [input.target]),
        target: input.target,
        object: {
            id: input.room.id,
            type: 'Instance',
            name: input.room.name,
            ...(input.room.image ? { image: input.room.image } : {}),
            accessType: input.room.accessType,
            ...(input.room.world
                ? { world: { type: 'World', id: input.room.world.url, name: input.room.world.name } }
                : {}),
        },
        ...(input.content ? { content: input.content } : {}),
        endTime: input.endTime,
        ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    };
}

export function buildRequestInvite(input: {
    id: string;
    actor: string;
    target: string;
    content: string | null;
    endTime: string;
}): ActivityDocument {
    return {
        ...base(input.id, 'RequestInvite', input.actor, [input.target]),
        object: input.target,
        ...(input.content ? { content: input.content } : {}),
        endTime: input.endTime,
    };
}

export function buildDeleteActor(input: { id: string; actor: string; to: readonly string[] }): ActivityDocument {
    return { ...base(input.id, 'Delete', input.actor, input.to), object: input.actor };
}

export function buildUpdateActor(input: {
    id: string;
    actor: string;
    to: readonly string[];
    object: Record<string, unknown>;
}): ActivityDocument {
    return { ...base(input.id, 'Update', input.actor, input.to), object: input.object };
}

// ── 受ける ──────────────────────────────────────────────

/** 受けて意味の分かった activity。 */
export type InboundActivity =
    | { type: 'friend-offer'; id: string; actor: string; target: string; relationshipId: string }
    | { type: 'accept' | 'reject' | 'undo'; id: string; actor: string; object: ActivityRef }
    | {
          type: 'invite';
          id: string;
          actor: string;
          target: string;
          room: { id: string; name: string; image: string | null; accessType: RoomCard['accessType'] | null };
          content: string | null;
          endTime: string;
          inReplyTo: string | null;
      }
    | { type: 'request-invite'; id: string; actor: string; target: string; content: string | null; endTime: string }
    | { type: 'follow'; id: string; actor: string; object: string }
    | { type: 'update-actor'; id: string; actor: string }
    | { type: 'delete-actor'; id: string; actor: string }
    | { type: 'unknown'; id: string; actor: string; activityType: string };

export type ActivityRejection = 'malformed' | 'cross-origin';

const RefSchema = z.union([
    z.string(),
    z
        .object({
            id: z.string(),
            type: z.string().optional(),
            actor: z.unknown().optional(),
            object: z.unknown().optional(),
        })
        .passthrough(),
]);
const idOf = (ref: z.infer<typeof RefSchema>): string => (typeof ref === 'string' ? ref : ref.id);

const EnvelopeSchema = z
    .object({ id: z.string().max(2048), type: z.union([z.string(), z.array(z.string())]), actor: RefSchema })
    .passthrough();
const RelationshipSchema = z
    .object({
        id: z.string(),
        type: z.literal('Relationship'),
        subject: RefSchema,
        relationship: z.string(),
        object: RefSchema,
    })
    .passthrough();
const ACCESS_TYPES = ['public', 'friend_plus', 'friend_only', 'invite_only'] as const;
const InstanceObjectSchema = z
    .object({
        id: z.string().max(2048),
        type: z.literal('Instance'),
        name: z.string().optional(),
        image: z.union([z.string(), z.object({ url: z.string() }).passthrough()]).optional(),
        accessType: z.string().optional(),
    })
    .passthrough();
const TextSchema = z.string().nullish();
const TimeSchema = z.string().datetime({ offset: true });

/**
 * 受けた JSON を読む。activity の id と actor が別のオリジンなら cross-origin（署名の確認とは別に、乗っ取りを防ぐ）。
 * 意味の分からない型は unknown（受けて捨てる）。
 */
export function readActivity(
    json: unknown,
): { ok: true; activity: InboundActivity } | { ok: false; reason: ActivityRejection } {
    const envelope = EnvelopeSchema.safeParse(json);
    if (!envelope.success) return { ok: false, reason: 'malformed' };
    const raw = envelope.data;
    const actor = idOf(raw.actor);
    if (!sameOrigin(raw.id, actor)) return { ok: false, reason: 'cross-origin' };
    const type = Array.isArray(raw.type) ? (raw.type[0] ?? '') : raw.type;
    const unknown: InboundActivity = { type: 'unknown', id: raw.id, actor, activityType: type };
    const field = (name: string): unknown => (raw as Record<string, unknown>)[name];

    switch (type) {
        case 'Offer': {
            const relationship = RelationshipSchema.safeParse(field('object'));
            const target = RefSchema.safeParse(field('target'));
            if (!relationship.success || !target.success) return { ok: true, activity: unknown };
            const rel = relationship.data;
            if (rel.relationship !== FRIEND_OF || idOf(rel.subject) !== actor) return { ok: true, activity: unknown };
            if (idOf(rel.object) !== idOf(target.data)) return { ok: true, activity: unknown };
            return {
                ok: true,
                activity: {
                    type: 'friend-offer',
                    id: raw.id,
                    actor,
                    target: idOf(target.data),
                    relationshipId: rel.id,
                },
            };
        }
        case 'Accept':
        case 'Reject':
        case 'Undo': {
            const object = RefSchema.safeParse(field('object'));
            if (!object.success) return { ok: false, reason: 'malformed' };
            const ref = object.data;
            const refActor = typeof ref === 'string' ? undefined : ref.actor;
            const refObject = typeof ref === 'string' ? undefined : RefSchema.safeParse(ref.object);
            return {
                ok: true,
                activity: {
                    type: type === 'Accept' ? 'accept' : type === 'Reject' ? 'reject' : 'undo',
                    id: raw.id,
                    actor,
                    object: {
                        id: idOf(ref),
                        type: typeof ref === 'string' ? '' : (ref.type ?? ''),
                        ...(typeof refActor === 'string'
                            ? { actor: refActor }
                            : refActor &&
                                typeof refActor === 'object' &&
                                'id' in refActor &&
                                typeof refActor.id === 'string'
                              ? { actor: refActor.id }
                              : {}),
                        ...(refObject?.success ? { object: idOf(refObject.data) } : {}),
                    },
                },
            };
        }
        case 'Invite': {
            const object = InstanceObjectSchema.safeParse(field('object'));
            const target = RefSchema.safeParse(field('target'));
            const endTime = TimeSchema.safeParse(field('endTime'));
            if (!object.success || !target.success || !endTime.success) return { ok: true, activity: unknown };
            const image = object.data.image;
            const accessType = ACCESS_TYPES.find((t) => t === object.data.accessType) ?? null;
            const inReplyTo = RefSchema.safeParse(field('inReplyTo'));
            return {
                ok: true,
                activity: {
                    type: 'invite',
                    id: raw.id,
                    actor,
                    target: idOf(target.data),
                    room: {
                        id: object.data.id,
                        name: displayText(object.data.name, 200) ?? '部屋',
                        image: typeof image === 'string' ? image : (image?.url ?? null),
                        accessType,
                    },
                    content: displayText(TextSchema.safeParse(field('content')).data, 80),
                    endTime: endTime.data,
                    inReplyTo: inReplyTo.success ? idOf(inReplyTo.data) : null,
                },
            };
        }
        case 'RequestInvite': {
            const object = RefSchema.safeParse(field('object'));
            const endTime = TimeSchema.safeParse(field('endTime'));
            if (!object.success || !endTime.success) return { ok: true, activity: unknown };
            return {
                ok: true,
                activity: {
                    type: 'request-invite',
                    id: raw.id,
                    actor,
                    target: idOf(object.data),
                    content: displayText(TextSchema.safeParse(field('content')).data, 80),
                    endTime: endTime.data,
                },
            };
        }
        case 'Follow': {
            const object = RefSchema.safeParse(field('object'));
            if (!object.success) return { ok: true, activity: unknown };
            return { ok: true, activity: { type: 'follow', id: raw.id, actor, object: idOf(object.data) } };
        }
        case 'Update': {
            const object = RefSchema.safeParse(field('object'));
            if (!object.success || idOf(object.data) !== actor) return { ok: true, activity: unknown };
            return { ok: true, activity: { type: 'update-actor', id: raw.id, actor } };
        }
        case 'Delete': {
            const object = RefSchema.safeParse(field('object'));
            if (!object.success || idOf(object.data) !== actor) return { ok: true, activity: unknown };
            return { ok: true, activity: { type: 'delete-actor', id: raw.id, actor } };
        }
        default:
            return { ok: true, activity: unknown };
    }
}
