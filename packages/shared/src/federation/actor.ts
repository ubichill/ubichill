/**
 * actor の文書（Person・Application）を作る・読む。鍵は 2 つ載せる:
 * - FEP-521a の assertionMethod（Multikey、Ed25519）: ubichill 同士の RFC 9421 の署名
 * - publicKey（RSA の PEM）: Mastodon・Misskey など、ほかの実装の draft-cavage の署名
 *
 * 読むときの規則（オリジンによる信頼。FEP-fe34）:
 * - 文書の id は取りに行った URL と同じ（ほかのオリジンの文書で乗っ取らせない。Mastodon の CVE-2024-23832）
 * - inbox・sharedInbox は actor と同じオリジン（自分のサーバーを使って第三者へ送らせない）
 * - 鍵は controller（owner）が actor で、id が `<actor の id>#…` のものだけ（Ed25519 の Multikey と RSA の PEM）
 */
import { z } from 'zod';
import { type CustomEmoji, type RichSegment, richTextPlain } from '../user/richText';
import { parseEd25519Multikey } from './multikey';
import {
    type LocalProfileFields,
    profileAttachment,
    profileExtensions,
    REMOTE_SUMMARY_MAX_LENGTH,
    type RemoteProfileField,
    readProfileAttachment,
    readProfileExtensions,
} from './profileFields';
import { ACTOR_CONTEXT, AP_ACCEPT, FEDERATION_FEATURES, isActivityMediaType } from './protocol';
import { htmlToRichText, readCustomEmojis } from './richText';
import { displayText, escapeHtml } from './text';
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
    /** バナー（ヘッダー画像） */
    banner?: string | null;
    /** アカウントを作った時刻（ISO 8601。ほかの実装の「登録日」） */
    published?: string;
    /** リンク・話せる言語・ひとこと */
    profile?: LocalProfileFields;
    inbox: string;
    outbox?: string;
    sharedInbox: string;
    keyId: string;
    publicKeyMultibase: string;
    /** 鍵の移行の間だけ一緒に載せる前の鍵（前の鍵で署名して送った分を、相手が確かめられるように） */
    previousKeys?: ReadonlyArray<{ keyId: string; publicKeyMultibase: string }>;
    /** ほかの実装に向けた RSA の公開鍵（SPKI の PEM） */
    rsaKey?: { keyId: string; publicKeyPem: string };
    /** フォロワー・フォローのコレクション（件数だけ公開する） */
    followers?: string;
    following?: string;
    /** 固定ノート（Mastodon の featured） */
    featured?: string;
    /** フォローを承認制にするか（既定は承認制。Application actor はフォローを受けない） */
    manuallyApprovesFollowers?: boolean;
    /** ほかのサーバーの「おすすめ」や検索に出してよいか（Mastodon の discoverable・indexable） */
    discoverable?: boolean;
    /** `handle@domain`（FEP-2c59） */
    webfinger?: string;
    /** 告知する機能（FEP-844e）。Application actor に付ける */
    implements?: readonly string[];
}

/** 平文（自己紹介など）→ ほかの実装が表示する HTML（段落と改行だけ。中身はすべてエスケープする）。 */
export function plainTextToHtml(text: string): string {
    return text
        .trim()
        .split(/\r?\n\s*\r?\n/)
        .map((paragraph) => `<p>${paragraph.split(/\r?\n/).map(escapeHtml).join('<br>')}</p>`)
        .join('');
}

/** このサーバーの actor の文書。 */
export function buildActorDocument(input: LocalActorInput): Record<string, unknown> {
    return {
        '@context': ACTOR_CONTEXT,
        id: input.id,
        type: input.type,
        preferredUsername: input.preferredUsername,
        name: input.name,
        ...(input.summary ? { summary: plainTextToHtml(input.summary) } : {}),
        ...(input.url ? { url: input.url } : {}),
        ...(input.webfinger ? { webfinger: input.webfinger } : {}),
        ...(input.icon ? { icon: { type: 'Image', url: input.icon } } : {}),
        ...(input.banner ? { image: { type: 'Image', url: input.banner } } : {}),
        ...(input.published ? { published: input.published } : {}),
        ...(input.profile ? profileDocument(input.profile) : {}),
        inbox: input.inbox,
        ...(input.outbox ? { outbox: input.outbox } : {}),
        ...(input.followers ? { followers: input.followers } : {}),
        ...(input.following ? { following: input.following } : {}),
        ...(input.featured ? { featured: input.featured } : {}),
        endpoints: { sharedInbox: input.sharedInbox },
        manuallyApprovesFollowers: input.manuallyApprovesFollowers ?? true,
        ...(input.discoverable !== undefined
            ? { discoverable: input.discoverable, indexable: input.discoverable }
            : {}),
        ...(input.rsaKey
            ? { publicKey: { id: input.rsaKey.keyId, owner: input.id, publicKeyPem: input.rsaKey.publicKeyPem } }
            : {}),
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

function profileDocument(profile: LocalProfileFields): Record<string, unknown> {
    const attachment = profileAttachment(profile);
    return { ...(attachment.length > 0 ? { attachment } : {}), ...profileExtensions(profile) };
}

const featureName = (href: string): string =>
    Object.entries(FEDERATION_FEATURES).find(([, v]) => v === href)?.[0] ?? href;

const LinkSchema = z.union([z.string(), z.object({ href: z.string() }).passthrough()]);
const ImageSchema = z.union([z.string(), z.object({ url: LinkSchema }).passthrough()]);
const MultikeySchema = z
    .object({ id: z.string(), type: z.string(), controller: z.string(), publicKeyMultibase: z.string() })
    .passthrough();
const ImplementsSchema = z.array(z.object({ href: z.string() }).passthrough());
const PublicKeySchema = z
    .object({ id: z.string(), owner: z.string().optional(), publicKeyPem: z.string().max(8192) })
    .passthrough();

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
        image: z.union([ImageSchema, z.array(ImageSchema)]).nullish(),
        inbox: z.string(),
        endpoints: z.object({ sharedInbox: z.string().optional() }).passthrough().nullish(),
        assertionMethod: z.union([MultikeySchema, z.array(MultikeySchema)]).optional(),
        publicKey: z.union([PublicKeySchema, z.array(PublicKeySchema)]).nullish(),
        implements: ImplementsSchema.optional(),
        generator: z.object({ implements: ImplementsSchema.optional() }).passthrough().nullish(),
    })
    .passthrough();

export interface RemoteActorKey {
    id: string;
    publicKey: Uint8Array;
}

/** ほかの実装の RSA の公開鍵（draft-cavage の署名を確かめる）。 */
export interface RemoteRsaKey {
    id: string;
    publicKeyPem: string;
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
    /** バナー（https） */
    banner: string | null;
    /** 項目の表（ほかの実装の PropertyValue） */
    fields: RemoteProfileField[];
    /** 自己紹介のリンク・メンションの並び（summary はこれをつないだ文字） */
    bio: RichSegment[];
    /** 名前・自己紹介・項目に使うカスタム絵文字 */
    emojis: CustomEmoji[];
    /** ubichill のひとことと話せる言語（ほかの実装には無い） */
    statusMessage: string | null;
    spokenLanguages: string[];
    inbox: string;
    sharedInbox: string | null;
    keys: RemoteActorKey[];
    rsaKeys: RemoteRsaKey[];
    /** 告知している機能（FEP-844e） */
    features: string[];
}

export type ActorRejection = 'malformed' | 'id-mismatch' | 'inbox-origin';

/** SPKI（`PUBLIC KEY`）か PKCS#1（`RSA PUBLIC KEY`）の PEM。中身が RSA かは使うときに確かめる。 */
const PEM_PUBLIC_KEY =
    /^-----BEGIN (RSA )?PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END (RSA )?PUBLIC KEY-----$/;

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
    const rsaKeys = (doc.publicKey ? [doc.publicKey].flat() : []).flatMap((k): RemoteRsaKey[] => {
        if (k.owner !== undefined && k.owner !== id.href) return [];
        if (!k.id.startsWith(`${id.href}#`) || !PEM_PUBLIC_KEY.test(k.publicKeyPem.trim())) return [];
        return [{ id: k.id, publicKeyPem: k.publicKeyPem.trim() }];
    });

    const imageUrl = (value: typeof doc.icon) => {
        const raw = first(value);
        const url = typeof raw === 'string' ? raw : hrefOf(raw?.url);
        return url && parseFederationUrl(url, options) ? url : null;
    };
    const urlRaw = hrefOf(first(doc.url));
    const bio = htmlToRichText(doc.summary, REMOTE_SUMMARY_MAX_LENGTH, options);
    const features = [...(doc.implements ?? []), ...(doc.generator?.implements ?? [])].map((i) => i.href);
    return {
        ok: true,
        actor: {
            id: id.href,
            type: doc.type,
            preferredUsername: displayText(doc.preferredUsername, 100),
            name: displayText(doc.name, 100),
            summary: richTextPlain(bio) || null,
            bio,
            emojis: readCustomEmojis(doc.tag, options),
            url: urlRaw && parseFederationUrl(urlRaw, options) ? urlRaw : null,
            icon: imageUrl(doc.icon),
            banner: imageUrl(doc.image),
            fields: readProfileAttachment(doc.attachment),
            ...readProfileExtensions(doc),
            inbox: inbox.href,
            sharedInbox: sharedInbox?.href ?? null,
            keys,
            rsaKeys,
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
