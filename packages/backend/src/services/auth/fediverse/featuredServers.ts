/**
 * ログイン画面に並べるサーバー（コントロールパネルの「認証」）。足すときはログインと同じ判定に通るかを確かめる
 * （使えないサーバーを入口に並べない）。保存先と判定は注入する（本番は featuredServerService.ts）。
 */
import type { AddFeaturedServerOutcome } from '@ubichill/db';
import { fediverseSignInErrorMessage, parseFediverseServer } from '@ubichill/shared';
import { z } from 'zod';
import type { LookupOutcome } from './lookup';

export interface FeaturedServersDeps {
    repository: {
        list(): Promise<string[]>;
        add(host: string, max: number): Promise<AddFeaturedServerOutcome>;
        remove(host: string): Promise<boolean>;
        reorder(hosts: readonly string[]): Promise<'reordered' | 'mismatch'>;
    };
    lookup(host: string): Promise<LookupOutcome>;
    /** 並べるサーバーが変わった（覚えた一覧を捨て、ほかの backend に知らせる） */
    changed(): void;
    max: number;
}

export type FeaturedServersOutcome =
    | { ok: true; value: { servers: string[] } }
    | { ok: false; status: 400 | 404 | 409; error: string };

const ReorderSchema = z.object({ servers: z.array(z.string().max(300)).max(100) });

export function createFeaturedServers(deps: FeaturedServersDeps) {
    const current = async (): Promise<FeaturedServersOutcome> => ({
        ok: true,
        value: { servers: await deps.repository.list() },
    });
    const updated = (): Promise<FeaturedServersOutcome> => {
        deps.changed();
        return current();
    };

    return {
        list: current,

        /** 末尾に足す。ログインの判定に通らないサーバー（未対応・接続できない・許可の外・block）は足さない。 */
        async add(input: unknown): Promise<FeaturedServersOutcome> {
            const parsed = parseFediverseServer(typeof input === 'string' ? input : '');
            if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
            const looked = await deps.lookup(parsed.host);
            if (!looked.ok) {
                return {
                    ok: false,
                    status: 400,
                    error: fediverseSignInErrorMessage(looked.error) ?? 'このサーバーはログインに使えません',
                };
            }
            switch (await deps.repository.add(looked.server.host, deps.max)) {
                case 'exists':
                    return { ok: false, status: 409, error: 'このサーバーは既に並んでいます' };
                case 'full':
                    return { ok: false, status: 400, error: `並べられるのは ${deps.max} 件までです` };
                case 'added':
                    return updated();
            }
        },

        async remove(host: string): Promise<FeaturedServersOutcome> {
            if (!(await deps.repository.remove(host.toLowerCase()))) {
                return { ok: false, status: 404, error: 'このサーバーは並んでいません' };
            }
            return updated();
        },

        /** 並べ替える（今の一覧を並べ替えたものだけ受け付ける。足し引きは add・remove で）。 */
        async reorder(input: unknown): Promise<FeaturedServersOutcome> {
            const parsed = ReorderSchema.safeParse(input);
            if (!parsed.success) return { ok: false, status: 400, error: '並び順が正しくありません' };
            const outcome = await deps.repository.reorder(parsed.data.servers.map((host) => host.toLowerCase()));
            if (outcome === 'mismatch') {
                return { ok: false, status: 409, error: 'ほかの管理者が一覧を変えました。読み直してください' };
            }
            return updated();
        },
    };
}

export type FeaturedServers = ReturnType<typeof createFeaturedServers>;

/**
 * ログイン画面に出す並び。使えるサーバーを環境変数（FEDIVERSE_SIGN_IN_SERVERS）で限っているなら、その中のものだけ。
 * 1 つも残らなければ、使えるサーバーをそのまま並べる（入口が空にならないように）。
 */
export function featuredServersFor(featured: readonly string[], allowed: ReadonlySet<string>): string[] {
    if (allowed.size === 0) return [...featured];
    const shown = featured.filter((host) => allowed.has(host));
    return shown.length > 0 ? shown : [...allowed];
}
