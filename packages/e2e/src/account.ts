/** スモークが作るテスト用のアカウント。プレビューの DB ごと消えるので残すが、名前で見分けられるようにする。 */
export interface SmokeAccount {
    readonly email: string;
    readonly password: string;
    readonly displayName: string;
    readonly handle: string;
}

/** 印。ID（handle）・表示名・メールアドレスのどれもこれで始まる。 */
export const SMOKE_MARK = 'smoke';

/**
 * @param runId 走らせるごとに変える英小文字・数字（ID は英小文字・数字・_ の 3〜30 文字）
 * @param role 同じ走りの中の何人目か（a, b など）
 */
export function smokeAccount(runId: string, role: string): SmokeAccount {
    const id = `${runId}_${role}`.toLowerCase();
    if (!/^[a-z0-9_]+$/.test(id)) throw new Error(`runId・role は英小文字・数字だけにしてください: ${id}`);
    const handle = `${SMOKE_MARK}_${id}`;
    if (handle.length > 30) throw new Error(`ID が 30 文字を超えます: ${handle}`);
    return {
        email: `${SMOKE_MARK}+${id}@example.com`,
        password: `${SMOKE_MARK}-${id}-password`,
        displayName: `${SMOKE_MARK}-${id}`,
        handle,
    };
}

/** 走りごとの ID。時刻と乱数で、並べて走らせても重ならない。 */
export function newRunId(now: number, random: () => number): string {
    const time = now.toString(36).slice(-6);
    const noise = Math.floor(random() * 36 ** 4)
        .toString(36)
        .padStart(4, '0');
    return `${time}${noise}`;
}
