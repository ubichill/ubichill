/**
 * dev サーバー（`ubichill dev`）から届いた世代をどう扱うか（純粋な部分）。SSE の形は `@ubichill/shared` の devEvents。
 */

export interface DevGeneration {
    buildId: string;
    instanceId: string;
}

/**
 * 届いた世代に対して何をするか。まだ世代を持っていなければ使い始め、持っている世代と違えばページを読み直す
 * （entity と共有状態は Go にあるので残る。消えるのは Worker 内のローカルな状態だけ）。
 */
export function generationAction(current: DevGeneration | null, incoming: DevGeneration): 'adopt' | 'reload' | 'keep' {
    if (current === null) return 'adopt';
    return current.buildId === incoming.buildId ? 'keep' : 'reload';
}

export const generationLockUrl = (buildId: string): string => `/__ubichill/g/${encodeURIComponent(buildId)}/lock.json`;
