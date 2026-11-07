/**
 * NodeInfo 2.1（https://nodeinfo.diaspora.software）。ubichill のサーバーかの判別だけに使う。
 * 機能は Application actor の implements（FEP-844e）で告知する（NodeInfo の列挙を機能の判定に使わない。FEP-f1d5）。
 */
import { z } from 'zod';
import { FEDERATION_PATHS, FEDERATION_VERSION } from './protocol';

export const NODEINFO_SCHEMA = 'http://nodeinfo.diaspora.software/ns/schema/2.1';
export const APPLICATION_ACTOR_REL = 'https://www.w3.org/ns/activitystreams#Application';

/** `/.well-known/nodeinfo`。 */
export function nodeInfoLinks(origin: string): Record<string, unknown> {
    return {
        links: [
            { rel: NODEINFO_SCHEMA, href: `${origin}${FEDERATION_PATHS.nodeInfo}` },
            { rel: APPLICATION_ACTOR_REL, href: `${origin}${FEDERATION_PATHS.appActor}` },
        ],
    };
}

/** `/nodeinfo/2.1`。 */
export function buildNodeInfo(input: {
    version: string;
    openRegistrations: boolean;
    users?: number;
}): Record<string, unknown> {
    return {
        version: '2.1',
        software: {
            name: 'ubichill',
            version: input.version,
            repository: 'https://github.com/ubichill/ubichill',
            homepage: 'https://ubichill.com',
        },
        protocols: ['activitypub'],
        services: { inbound: [], outbound: [] },
        openRegistrations: input.openRegistrations,
        usage: { users: input.users === undefined ? {} : { total: input.users } },
        metadata: { ubichill: { federation: { version: FEDERATION_VERSION } } },
    };
}

const NodeInfoSchema = z
    .object({
        software: z.object({ name: z.string(), version: z.string().optional() }).passthrough(),
        metadata: z
            .object({
                ubichill: z
                    .object({ federation: z.object({ version: z.number().int() }).passthrough().optional() })
                    .passthrough()
                    .optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export interface NodeSummary {
    software: string;
    version: string | null;
    /** ubichill の連合の版（ubichill でなければ null） */
    federationVersion: number | null;
}

/** NodeInfo を読む（読めなければ null）。 */
export function readNodeInfo(json: unknown): NodeSummary | null {
    const parsed = NodeInfoSchema.safeParse(json);
    if (!parsed.success) return null;
    const software = parsed.data.software.name.toLowerCase().slice(0, 50);
    return {
        software,
        version: parsed.data.software.version?.slice(0, 50) ?? null,
        federationVersion:
            software === 'ubichill' ? (parsed.data.metadata?.ubichill?.federation?.version ?? null) : null,
    };
}

/** `/.well-known/nodeinfo` から 2.1 の文書の URL を取り出す。 */
export function nodeInfoUrlFrom(links: unknown): string | null {
    const parsed = z
        .object({ links: z.array(z.object({ rel: z.string(), href: z.string() }).passthrough()) })
        .safeParse(links);
    return parsed.success ? (parsed.data.links.find((l) => l.rel === NODEINFO_SCHEMA)?.href ?? null) : null;
}
