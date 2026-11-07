/**
 * お気に入り（ワールドの正規 URL の集合）の純粋なロジック。DB と解決は呼び出し側で注入する。
 */
import { LIMITS, type WorldListItem } from '@ubichill/shared';
import { normalizeWorldUrl } from './worldResolver';

export type FavoriteRefResult = { ok: true; ref: string } | { ok: false; error: string };

/** 追加する worldRef を検証し、一覧のワールド URL と同じ形に正規化する（共有 URL も受け付ける）。 */
export function favoriteRefOf(input: unknown): FavoriteRefResult {
    if (typeof input !== 'string') return { ok: false, error: 'worldRef は必須です' };
    const trimmed = input.trim();
    if (trimmed.length === 0 || trimmed.length > LIMITS.MAX_WORLD_URL_LENGTH) {
        return { ok: false, error: 'worldRef が不正です' };
    }
    const url = URL.parse(trimmed);
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
        return { ok: false, error: 'worldRef は http(s) のワールド URL です' };
    }
    return { ok: true, ref: normalizeWorldUrl(url.href) };
}

/**
 * お気に入りをワールドとして解決する。公開ルールを満たす（作者まで確認できた）ものだけを worlds に、
 * 取得できない・公開ルールを満たさないものを unavailable に分ける（本人が整理できるように）。
 * 外部ワールドの取得が一度に集中しないよう、同時に解決する数を絞る。お気に入りの順序は保つ。
 */
export async function resolveFavoriteWorlds(
    refs: readonly string[],
    resolve: (ref: string) => Promise<WorldListItem | undefined>,
    concurrency = 8,
): Promise<{ worlds: WorldListItem[]; unavailable: string[] }> {
    const chunks = Array.from({ length: Math.ceil(refs.length / concurrency) }, (_, i) =>
        refs.slice(i * concurrency, (i + 1) * concurrency),
    );
    const resolved = await chunks.reduce<Promise<Array<{ ref: string; world: WorldListItem | undefined }>>>(
        async (prev, chunk) => [
            ...(await prev),
            ...(await Promise.all(
                chunk.map(async (ref) => ({ ref, world: await resolve(ref).catch(() => undefined) })),
            )),
        ],
        Promise.resolve([]),
    );
    const seen = new Set<string>();
    const worlds = resolved.flatMap(({ world }) => {
        if (!world || seen.has(world.url)) return [];
        seen.add(world.url);
        return [world];
    });
    return { worlds, unavailable: resolved.filter((r) => !r.world).map((r) => r.ref) };
}
