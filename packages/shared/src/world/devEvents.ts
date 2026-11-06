/**
 * `ubichill dev` のサーバーと、同じ CLI に入っている world.html の間の約束（SSE `/__ubichill/events`）。
 * 両方が同じ版で配られるので内部の API（docs/PROTOCOLS.md の D）。形はここだけで決め、両側が同じものを使う。
 *
 * 送るのはどちらも「今の状態」で、接続の直後と変わるたびに送る（出来事ではないので、遅れて開いたタブも追いつく）。
 * - `generation`: 今の世代
 * - `diagnostics`: 今の失敗の一覧。空なら診断を消す
 */

/** 診断の 1 件。ビルドの失敗は mod ごと、ワールドの失敗（解決・検証・Go の拒否）は 1 件。 */
export type DevFailure = { kind: 'build'; mod: string; message: string } | { kind: 'world'; message: string };

export type DevEvent =
    | { type: 'generation'; buildId: string; instanceId: string }
    | { type: 'diagnostics'; failures: DevFailure[] };

export const DEV_EVENT_NAMES = ['generation', 'diagnostics'] as const satisfies readonly DevEvent['type'][];

/** SSE の 1 件にする（`event:` が型、`data:` が残りの JSON）。 */
export function formatDevEvent(event: DevEvent): string {
    const { type, ...data } = event;
    return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

const parseFailure = (value: unknown): DevFailure[] => {
    if (!value || typeof value !== 'object') return [];
    const f = value as Record<string, unknown>;
    if (typeof f.message !== 'string') return [];
    if (f.kind === 'build' && typeof f.mod === 'string') return [{ kind: 'build', mod: f.mod, message: f.message }];
    if (f.kind === 'world') return [{ kind: 'world', message: f.message }];
    return [];
};

/** SSE の 1 件（event 名と data）を読む。知らない形は null（診断の中の知らない形の 1 件は捨てる）。 */
export function parseDevEvent(name: string, data: string): DevEvent | null {
    const parsed = (() => {
        try {
            return JSON.parse(data) as unknown;
        } catch {
            return null;
        }
    })();
    if (!parsed || typeof parsed !== 'object') return null;
    const body = parsed as Record<string, unknown>;
    if (name === 'generation' && typeof body.buildId === 'string' && typeof body.instanceId === 'string') {
        return { type: 'generation', buildId: body.buildId, instanceId: body.instanceId };
    }
    if (name === 'diagnostics' && Array.isArray(body.failures)) {
        return { type: 'diagnostics', failures: body.failures.flatMap(parseFailure) };
    }
    return null;
}
