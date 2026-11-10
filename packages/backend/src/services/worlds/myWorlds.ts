/**
 * 本人の作ったワールドの一覧（設定の編集に使う）。ほかの人に見せる一覧は publishedWorks.ts。
 * 本人には未署名（非公開）も返し、署名状態を見せて署名し直せるようにする。配信できない（署名が内容と一致しない）ものは理由も返す。
 */
import { servedWorldOf, userRepository, type WorldState, worldRepository } from '@ubichill/db';
import { limitsFor, parseStoredDefinition } from '@ubichill/shared';
import { selfAccount } from '../authors/authorKeys';
import { repositoryWorldView } from './publishedWorks';
import { worldRegistry } from './worldRegistry';

export async function myWorldsOf(user: Parameters<typeof limitsFor>[0] & { id: string }) {
    const [states, me] = await Promise.all([
        worldRepository.findStatesByAuthorId(user.id),
        userRepository.findById(user.id),
    ]);
    const hosted = await Promise.all(
        states.map(async (state: WorldState) => {
            const r = state.world;
            const served = servedWorldOf(state);
            const resolution = await worldRegistry.resolveLocal(r.id);
            const def = resolution.ok ? resolution.world : parseStoredDefinition(served?.definition)?.spec;
            return {
                id: r.id,
                displayName: def?.displayName ?? r.worldName,
                description: def?.description ?? null,
                thumbnail: def?.thumbnail ?? null,
                version: served?.version ?? '',
                capacity: def?.capacity ?? { default: 0, max: 0 },
                updatedAt: r.updatedAt,
                // 配信の道筋（署名し直すときに、配信している生の値をここから取る）
                ...(me ? { url: worldRegistry.hostedWorldUrl(me.handle, r.worldName) } : {}),
                identity: resolution.ok ? resolution.world.identity : undefined,
                ...(resolution.ok
                    ? {}
                    : {
                          problem: resolution.message,
                          ...(resolution.signatureReason ? { problemCode: resolution.signatureReason } : {}),
                      }),
            };
        }),
    );
    const repository = (await worldRegistry.repositoryWorldsByAuthor(me ? [selfAccount(me.handle)] : [])).map(
        repositoryWorldView,
    );
    // 作成数の上限は本体（DB）に作ったワールドだけで数える（リポジトリ管理のワールドは含めない）
    const limit = limitsFor(user).maxWorlds;
    return { worlds: [...hosted, ...repository], limit, remaining: Math.max(0, limit - hosted.length) };
}
