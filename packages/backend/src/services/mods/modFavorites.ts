/**
 * お気に入りの mod（手元に持っておく mod）。作者と ID で覚え、見るたびに作者のカタログで今の版を引く。
 * 足すときは、作者のカタログに公開されている mod だけを受け付ける。実体（DB・カタログ・通知）は modFavoriteService.ts。
 */
import {
    type FavoriteMods,
    LIMITS,
    type ModFavoriteRef,
    ModFavoriteRefSchema,
    type PackageDescriptor,
} from '@ubichill/shared';
import { mapInChunks } from '../../utils/mapInChunks';
import type { ModLookup } from './modLookup';

export interface ModFavoritesDeps {
    list: (userId: string) => Promise<ModFavoriteRef[]>;
    addWithinLimit: (userId: string, ref: ModFavoriteRef, max: number) => Promise<'added' | 'exists' | 'limit'>;
    remove: (userId: string, ref: ModFavoriteRef) => Promise<void>;
    lookup: (ref: ModFavoriteRef) => Promise<ModLookup>;
    /** 一覧が変わった（ほかの人に見せる一覧のキャッシュを捨てる）。 */
    changed: (userId: string) => void;
}

export type ModFavoriteOutcome =
    | { ok: true; mod: ModFavoriteRef }
    | { ok: false; status: 400 | 404 | 409 | 503; error: string };

const MAX = LIMITS.MAX_FAVORITES_PER_USER;
const INVALID = { ok: false, status: 400, error: 'mod は作者（handle@domain）と ID で指定してください' } as const;
const same = (a: ModFavoriteRef, b: ModFavoriteRef) => a.author === b.author && a.id === b.id;

export function createModFavorites(deps: ModFavoritesDeps) {
    /** 作者のカタログで引けたものは今の版に、引けないもの（無い・届かない）は unavailable に分ける。順序は保つ。 */
    const resolve = async (refs: readonly ModFavoriteRef[]): Promise<FavoriteMods> => {
        const looked = await mapInChunks(
            refs,
            async (ref) => ({ ref, found: await deps.lookup(ref).catch((): ModLookup => ({ status: 'unreachable' })) }),
            8,
        );
        return {
            mods: looked.flatMap(({ found }): PackageDescriptor[] =>
                found.status === 'found' ? [found.descriptor] : [],
            ),
            unavailable: looked.filter(({ found }) => found.status !== 'found').map(({ ref }) => ref),
        };
    };

    return {
        refs: (userId: string) => deps.list(userId),

        resolved: async (userId: string): Promise<FavoriteMods> => resolve(await deps.list(userId)),

        /** 足す。もう入っていれば作者のサーバーに問い合わせずに成功にする。 */
        async add(userId: string, input: unknown): Promise<ModFavoriteOutcome> {
            const parsed = ModFavoriteRefSchema.safeParse(input);
            if (!parsed.success) return INVALID;
            const ref = { author: parsed.data.author, id: parsed.data.id };
            if ((await deps.list(userId)).some((r) => same(r, ref))) return { ok: true, mod: ref };
            const found = await deps.lookup(ref);
            if (found.status === 'missing')
                return { ok: false, status: 404, error: '公開されている mod が見つかりません' };
            if (found.status === 'unreachable')
                return {
                    ok: false,
                    status: 503,
                    error: '作者のサーバーにいま確認できません。少し待ってから試してください',
                };
            const outcome = await deps.addWithinLimit(userId, ref, MAX);
            if (outcome === 'limit') return { ok: false, status: 409, error: `お気に入りの mod は ${MAX} 件までです` };
            if (outcome === 'added') deps.changed(userId);
            return { ok: true, mod: ref };
        },

        /** 外す。公開をやめた mod・届かない作者の mod も外せるように、カタログには問い合わせない。 */
        async remove(userId: string, input: unknown): Promise<ModFavoriteOutcome> {
            const parsed = ModFavoriteRefSchema.safeParse(input);
            if (!parsed.success) return INVALID;
            const ref = { author: parsed.data.author, id: parsed.data.id };
            await deps.remove(userId, ref);
            deps.changed(userId);
            return { ok: true, mod: ref };
        },

        /** ほかの人に見せる一覧（引けたものだけ）。公開範囲の判定は呼び出し側（お気に入り全体で 1 つ）。 */
        visible: async (userId: string): Promise<PackageDescriptor[]> => (await resolve(await deps.list(userId))).mods,
    };
}
