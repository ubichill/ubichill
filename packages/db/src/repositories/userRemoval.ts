import { eq, inArray } from 'drizzle-orm';
import { instances, userBlocks, users, worlds, worldVersions } from '../schema';
import type { Tx } from './credentialUser';

/**
 * ユーザーの行を消す（ワールド・お気に入り等は FK の cascade で消える）。ほかの人のインスタンスが
 * このユーザーのワールドの版を指していると版を消せない（RESTRICT）ので、先に参照を外す。
 * ほかの人がこのユーザーをブロックした行は、blocked_id が actor の URL も入る列で FK が無いので、ここで消す。
 */
export async function removeUserRows(tx: Tx, id: string): Promise<void> {
    await tx
        .update(instances)
        .set({ worldVersionId: null })
        .where(
            inArray(
                instances.worldVersionId,
                tx
                    .select({ id: worldVersions.id })
                    .from(worldVersions)
                    .innerJoin(worlds, eq(worlds.id, worldVersions.worldId))
                    .where(eq(worlds.authorId, id)),
            ),
        );
    await tx.delete(userBlocks).where(eq(userBlocks.blockedId, id));
    await tx.delete(users).where(eq(users.id, id));
}
