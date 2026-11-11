import { z } from 'zod';
import { formatAuthorAccount, parseAuthorAccount } from '../account/handle';

export const MOD_CATALOG_REL = 'https://ubichill.com/ns/mods';
export const PackageIdSchema = z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .refine((id) => id !== 'core', 'core は本体の標準 Component 用です');
export const PackageVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export const PackageAuthorSchema = z.string().refine((s) => {
    const account = parseAuthorAccount(s);
    return account !== null && formatAuthorAccount(account) === s;
}, '作者は handle@domain で指定してください');
export interface PackageRef {
    author: string;
    id: string;
    version?: string;
}

/** 完全な作者参照と作品ページを同じ参照にする。暗黙のローカル作者は作らない。 */
export function parsePackageRef(input: string): PackageRef | null {
    let text = input;
    if (input.startsWith('https://')) {
        const path = /^https:\/\/([a-zA-Z0-9.:-]+)\/@([^/]+)\/mods\/([^/?#]+)(?:\/versions\/([^/?#]+))?\/?$/.exec(
            input,
        );
        if (!path) return null;
        text = `@${path[2]}@${path[1]}/${path[3]}${path[4] ? `@${path[4]}` : ''}`;
    }
    const match = /^@([^/]+)\/([^@/]+)(?:@([^/]+))?$/.exec(text);
    if (!match) return null;
    const account = parseAuthorAccount(match[1]);
    if (
        !account ||
        !PackageIdSchema.safeParse(match[2]).success ||
        (match[3] && !PackageVersionSchema.safeParse(match[3]).success)
    )
        return null;
    return { author: formatAuthorAccount(account), id: match[2], ...(match[3] ? { version: match[3] } : {}) };
}
export const formatPackageRef = (ref: PackageRef): string =>
    `@${ref.author}/${ref.id}${ref.version ? `@${ref.version}` : ''}`;
export function packagePagePath(handle: string, id: string): string {
    return `/@${handle}/mods/${id}`;
}

/** 配布物・版履歴は配布先に置く。カタログは作品ごとの取得先だけを返す。 */
export const PackageDescriptorSchema = z.object({
    author: PackageAuthorSchema,
    id: PackageIdSchema,
    version: PackageVersionSchema,
    baseUrl: z.string().url(),
});
export type PackageDescriptor = z.infer<typeof PackageDescriptorSchema>;
