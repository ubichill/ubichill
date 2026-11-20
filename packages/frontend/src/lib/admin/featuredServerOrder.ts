/** 1 つ上（-1）・下（+1）へ動かした並び。端なら元のまま。 */
export function movedServers(servers: readonly string[], index: number, by: -1 | 1): string[] {
    const to = index + by;
    if (index < 0 || index >= servers.length || to < 0 || to >= servers.length) return [...servers];
    const next = [...servers];
    [next[index], next[to]] = [next[to] as string, next[index] as string];
    return next;
}
