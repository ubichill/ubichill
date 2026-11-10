/** ワールドの名前（metadata.name。URL `/@ID/名前` になる）の最大長。 */
export const WORLD_NAME_MAX_LENGTH = 50;

/**
 * 入力をワールドの名前に使える形（英小文字・数字・-）にそろえる。使えない文字は - にし、続く - は 1 つにする。
 * 入力の途中（末尾の -）は残す。
 */
export function toWorldName(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .slice(0, WORLD_NAME_MAX_LENGTH);
}
