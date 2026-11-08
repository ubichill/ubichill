/**
 * actor の文書（Person・Application）を作る・読む。鍵は FEP-521a の assertionMethod（Multikey、Ed25519）。
 *
 * 読むときの規則（オリジンによる信頼。FEP-fe34）:
 * - 文書の id は取りに行った URL と同じ（ほかのオリジンの文書で乗っ取らせない。Mastodon の CVE-2024-23832）
 * - inbox・sharedInbox は actor と同じオリジン（自分のサーバーを使って第三者へ送らせない）
 * - 鍵は controller が actor で、id が `<actor の id>#…`、Ed25519 の Multikey だけ
 */
import { z } from 'zod';
import { parseEd25519Multikey } from './multikey';
import { ACTOR_CONTEXT, AP_ACCEPT, FEDERATION_FEATURES, isActivityMediaType } from './protocol';
import { displayText } from './text';
import { parseFederationUrl, sameOrigin } from './urls';

export interface LocalActorInput {
    id: string;
    type: 'Person' | 'Application';
    preferredUsername: string;
    name: string;
    summary?: string | null;
    /** プロフィールの画面 */
    url?: string;
    icon?: string | null;
    inbox: string;
    outbox?: string;
    sharedInbox: string;
    keyId: string;
    publicKeyMultibase: string;
    /** 鍵の移行の間だけ一緒に載せる前の鍵（前の鍵で署名して送った分を、相手が確かめられるように） */
    previousKeys?: ReadonlyArray<{ keyId: string; publicKeyMultibase: string }>;
    /** `handle@domain`（FEP-2c59） */
    webfinger?: string;
    /** 告知する機能（FEP-844e）。Application actor に付ける */
    implements?: readonly string[];
}

/** このサーバーの actor の文書。 */
export function buildActorDocument(input: LocalActorInput): Record<string, unknown> {
    return {
        '@context': ACTOR_CONTEXT,
        id: input.id,
        type: input.type,
        preferredUsername: input.preferredUsername,
        name: input.name,
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.url ? { url: input.url } : {}),
        ...(input.webfinger ? { webfinger: input.webfinger } : {}),
        ...(input.icon ? { icon: { type: 'Image', url: input.icon } } : {}),
        inbox: input.inbox,
        ...(input.outbox ? { outbox: input.outbox } : {}),
        endpoints: { sharedInbox: input.sharedInbox },
        // フレンドは承認制（片方向の Follow はまだ使わない）
        manuallyApprovesFollowers: true,
        assertionMethod: [
            { keyId: input.keyId, publicKeyMultibase: input.publicKeyMultibase },
            ...(input.previousKeys ?? []),
        ].map((key) => ({
            id: key.keyId,
            type: 'Multikey',
            controller: input.id,
            publicKeyMultibase: key.publicKeyMultibase,
        })),
        ...(input.implements
            ? { implements: input.implements.map((href) => ({ href, name: featureName(href) })) }
            : {}),
    };
}

const featureName = (href: string): string =>
    Object.entries(FEDERATION_FEATURES).find(([, v]) => v === href)?.[0] ?? href;

const LinkSchema = z.union([z.string(), z.object({ href: z.string() }).passthrough()]);
const ImageSchema = z.union([z.string(), z.object({ url: LinkSchema }).passthrough()]);
const MultikeySchema = z
    .object({ id: z.string(), type: z.string(), controller: z.string(), publicKeyMultibase: z.string() })
    .passthrough();
const ImplementsSchema = z.array(z.object({ href: z.string() }).passthrough());

/** 受けた actor の文書（知らない項目は無視する。.strict() にしない）。 */
const RemoteActorSchema = z
    .object({
        id: z.string(),
        type: z.string(),
        preferredUsername: z.string().max(100).optional(),
        name: z.string().nullish(),
        summary: z.string().nullish(),
        url: z.union([LinkSchema, z.array(LinkSchema)]).nullish(),
        icon: z.union([ImageSchema, z.array(ImageSchema)]).nullish(),
        inbox: z.string(),
        endpoints: z.object({ sharedInbox: z.string().optional() }).passthrough().nullish(),
        assertionMethod: z.union([MultikeySchema, z.array(MultikeySchema)]).optional(),
        implements: ImplementsSchema.optional(),
        generator: z.object({ implements: ImplementsSchema.optional() }).passthrough().nullish(),
    })
    .passthrough();

export interface RemoteActorKey {
    id: string;
    publicKey: Uint8Array;
}

export interface RemoteActor {
    id: string;
    type: string;
    preferredUsername: string | null;
    name: string | null;
    summary: string | null;
    /** プロフィールの画面（https） */
    url: string | null;
    icon: string | null;
    inbox: string;
    sharedInbox: string | null;
    keys: RemoteActorKey[];
    /** 告知している機能（FEP-844e） */
    features: string[];
}

export type ActorRejection = 'malformed' | 'id-mismatch' | 'inbox-origin';

const first = <T>(value: T | readonly T[] | null | undefined): T | undefined =>
    Array.isArray(value) ? value[0] : ((value ?? undefined) as T | undefined);

const hrefOf = (link: z.infer<typeof LinkSchema> | undefined): string | undefined =>
    typeof link === 'string' ? link : link?.href;

/**
 * 取りに行った actor の文書を読む。fetchedUrl は実際に取りに行った URL（リダイレクトの前）。
 */
export function readActorDocument(
    json: unknown,
    fetchedUrl: string,
    options: { allowHttp?: boolean } = {},
): { ok: true; actor: RemoteActor } | { ok: false; reason: ActorRejection } {
    const parsed = RemoteActorSchema.safeParse(json);
    if (!parsed.success) return { ok: false, reason: 'malformed' };
    const doc = parsed.data;
    const id = parseFederationUrl(doc.id, options);
    const fetched = parseFederationUrl(fetchedUrl, options);
    if (!id || !fetched || id.href !== fetched.href) return { ok: false, reason: 'id-mismatch' };
    const inbox = parseFederationUrl(doc.inbox, options);
    const sharedInboxRaw = doc.endpoints?.sharedInbox;
    const sharedInbox = sharedInboxRaw ? parseFederationUrl(sharedInboxRaw, options) : null;
    if (
        !inbox ||
        inbox.origin !== id.origin ||
        (sharedInboxRaw && (!sharedInbox || sharedInbox.origin !== id.origin))
    ) {
        return { ok: false, reason: 'inbox-origin' };
    }

    const methods = doc.assertionMethod === undefined ? [] : [doc.assertionMethod].flat();
    const keys = methods.flatMap((m): RemoteActorKey[] => {
        if (m.type !== 'Multikey' || m.controller !== id.href || !m.id.startsWith(`${id.href}#`)) return [];
        const publicKey = parseEd25519Multikey(m.publicKeyMultibase);
        return publicKey ? [{ id: m.id, publicKey }] : [];
    });

    const iconRaw = first(doc.icon);
    const icon = typeof iconRaw === 'string' ? iconRaw : hrefOf(iconRaw?.url);
    const urlRaw = hrefOf(first(doc.url));
    const features = [...(doc.implements ?? []), ...(doc.generator?.implements ?? [])].map((i) => i.href);
    return {
        ok: true,
        actor: {
            id: id.href,
            type: doc.type,
            preferredUsername: displayText(doc.preferredUsername, 100),
            name: displayText(doc.name, 100),
            summary: displayText(doc.summary, 300),
            url: urlRaw && parseFederationUrl(urlRaw, options) ? urlRaw : null,
            icon: icon && parseFederationUrl(icon, options) ? icon : null,
            inbox: inbox.href,
            sharedInbox: sharedInbox?.href ?? null,
            keys,
            features: [...new Set(features)],
        },
    };
}

/** actor の鍵を keyid で選ぶ（無ければ null）。 */
export function actorKey(actor: Pick<RemoteActor, 'keys'>, keyId: string): Uint8Array | null {
    return actor.keys.find((k) => k.id === keyId)?.publicKey ?? null;
}

/** 相手が機能を告知しているか。 */
export const implementsFeature = (actor: Pick<RemoteActor, 'features'>, feature: string): boolean =>
    actor.features.includes(feature);

const JrdSchema = z
    .object({
        subject: z.string().optional(),
        links: z.array(
            z.object({ rel: z.string(), type: z.string().optional(), href: z.string().optional() }).passthrough(),
        ),
    })
    .passthrough();

/** WebFinger の JRD から actor の URL（rel="self"、AP のメディアタイプ）を取り出す。 */
export function webfingerActorUrl(jrd: unknown): string | null {
    const parsed = JrdSchema.safeParse(jrd);
    if (!parsed.success) return null;
    const self = parsed.data.links.find((l) => l.rel === 'self' && isActivityMediaType(l.type) && l.href);
    return self?.href ?? null;
}

/** actor の文書を取りに行くときの Accept ヘッダー。 */
export const ACTOR_ACCEPT = AP_ACCEPT;

/** 自分の actor か（同じオリジン）。 */
export const isLocalActor = (actorId: string, selfOrigin: string): boolean => sameOrigin(actorId, selfOrigin);
