/**
 * dev サーバー（`ubichill dev`）との約束。世代の正本は SSE だけ: 接続の直後と切り替えのたびに `generation` が届く。
 * ここは純粋な部分（出来事の解釈と、読み直すかの判断）。
 */

export type DevEvent =
    | { type: 'generation'; buildId: string; instanceId: string }
    | { type: 'build-error'; mod: string; message: string }
    | { type: 'world-error'; message: string };

export interface DevGeneration {
    buildId: string;
    instanceId: string;
}

/** SSE の 1 件（event 名と data）を解釈する。知らない形は null。 */
export function parseDevEvent(name: string, data: string): DevEvent | null {
    const parsed = (() => {
        try {
            return JSON.parse(data) as Record<string, unknown>;
        } catch {
            return null;
        }
    })();
    if (!parsed || typeof parsed !== 'object') return null;
    if (name === 'generation' && typeof parsed.buildId === 'string' && typeof parsed.instanceId === 'string') {
        return { type: 'generation', buildId: parsed.buildId, instanceId: parsed.instanceId };
    }
    if (name === 'build-error' && typeof parsed.mod === 'string' && typeof parsed.message === 'string') {
        return { type: 'build-error', mod: parsed.mod, message: parsed.message };
    }
    if (name === 'world-error' && typeof parsed.message === 'string')
        return { type: 'world-error', message: parsed.message };
    return null;
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

/** 診断に残す失敗。同じ mod の新しい失敗は古いものを置き換え、ワールドの失敗は 1 件だけ持つ。 */
export function recordFailure(failures: readonly DevEvent[], event: DevEvent, limit = 20): DevEvent[] {
    if (event.type === 'generation') return [...failures];
    const rest = failures.filter((f) =>
        f.type === 'build-error'
            ? !(event.type === 'build-error' && f.mod === event.mod)
            : event.type !== 'world-error',
    );
    return [...rest, event].slice(-limit);
}
