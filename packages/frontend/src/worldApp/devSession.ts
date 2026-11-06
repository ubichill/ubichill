/**
 * dev サーバー（`ubichill dev`）との約束。正本は SSE だけで、届くのはどちらも「今の状態」:
 * `generation`（今の世代）と `diagnostics`（今の失敗の一覧。空なら消す）。接続の直後と変わるたびに届く。
 * ここは純粋な部分（解釈と、読み直すかの判断）。
 */

export type DevFailure = { kind: 'build'; mod: string; message: string } | { kind: 'world'; message: string };

export type DevEvent =
    | { type: 'generation'; buildId: string; instanceId: string }
    | { type: 'diagnostics'; failures: DevFailure[] };

export interface DevGeneration {
    buildId: string;
    instanceId: string;
}

const parseFailure = (value: unknown): DevFailure[] => {
    if (!value || typeof value !== 'object') return [];
    const f = value as Record<string, unknown>;
    if (typeof f.message !== 'string') return [];
    if (f.kind === 'build' && typeof f.mod === 'string') return [{ kind: 'build', mod: f.mod, message: f.message }];
    if (f.kind === 'world') return [{ kind: 'world', message: f.message }];
    return [];
};

/** SSE の 1 件（event 名と data）を解釈する。知らない形は null（診断の中の知らない形の 1 件は捨てる）。 */
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
    if (name === 'diagnostics' && Array.isArray(parsed.failures)) {
        return { type: 'diagnostics', failures: parsed.failures.flatMap(parseFailure) };
    }
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
