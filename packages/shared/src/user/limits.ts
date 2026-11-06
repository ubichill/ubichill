import { LIMITS } from '../schemas/world.schema';

export interface UserLimits {
    /** 本体に作れるワールドの数（リポジトリのワールドは数えない）。 */
    maxWorlds: number;
    /** 1 つのワールドに残す公開の版の数。超えて公開すると古い版から消す（公開は拒否しない）。 */
    maxVersionsPerWorld: number;
}

/** 利用者ごとの上限。今は全員同じ。課金を入れるときは、ここでプランを見るように変えるだけにする。 */
export function limitsFor(_user: { id: string }): UserLimits {
    return { maxWorlds: LIMITS.MAX_WORLDS_PER_USER, maxVersionsPerWorld: LIMITS.MAX_VERSIONS_PER_WORLD };
}
