/**
 * activity の配送（送り直しの間隔・諦める時・相手のサーバーの止め方）の規則。保存と送信は backend。
 *
 * - 送り直しは 30 秒 → 2 分 → 10 分 → 30 分 → 1 時間 → 3 時間 → 6 時間 → 12 時間 → 24 時間（±20% のゆらぎ）
 *   2 倍ずつにしない（相手が戻ってから届くまでの遅れが、止まっていた時間の倍ほどに膨らむ。Lemmy の経験）
 * - 48 時間で諦める。期限のあるもの（招待・リクエスト）は期限で諦める
 * - 400・401・403・404・410 は送り直さない（410 は相手の actor が消えた）。429 は Retry-After に従う（最長 1 時間）
 * - 5 回続けて失敗したら、そのホストへ送るのを 1 分止め、続くたびに 2 倍（最長 1 時間）
 * - 3 日間 1 度も成功しなければ、到達できないサーバーとして新しい配送を止める（6 時間ごとに試す）
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const RETRY_DELAYS_MS = [
    30 * SECOND,
    2 * MINUTE,
    10 * MINUTE,
    30 * MINUTE,
    HOUR,
    3 * HOUR,
    6 * HOUR,
    12 * HOUR,
    24 * HOUR,
] as const;

export const DELIVERY_LIMITS = {
    GIVE_UP_MS: 48 * HOUR,
    JITTER: 0.2,
    MAX_RETRY_AFTER_MS: HOUR,
    CIRCUIT_FAILURES: 5,
    CIRCUIT_PAUSE_MS: MINUTE,
    CIRCUIT_MAX_PAUSE_MS: HOUR,
    UNREACHABLE_AFTER_MS: 3 * 24 * HOUR,
    UNREACHABLE_PROBE_MS: 6 * HOUR,
    /** 1 つのホストへ同時に送る数 */
    PER_HOST_CONCURRENCY: 4,
} as const;

/** attempts 回失敗したあと、次に送るまでの時間（random は 0〜1）。 */
export function retryDelayMs(attempts: number, random: number): number {
    const index = Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1);
    const base = RETRY_DELAYS_MS[index] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    return Math.round(base * (1 - DELIVERY_LIMITS.JITTER + 2 * DELIVERY_LIMITS.JITTER * random));
}

/** 諦める時刻（作ってから 48 時間か、activity の期限の早い方）。 */
export function deliveryDeadline(createdAt: number, endTime?: number): number {
    const limit = createdAt + DELIVERY_LIMITS.GIVE_UP_MS;
    return endTime === undefined ? limit : Math.min(limit, endTime);
}

export type DeliveryOutcome =
    | { kind: 'delivered' }
    /** 送り直さない（相手が受けない・もういない） */
    | { kind: 'rejected'; gone: boolean }
    /** 送り直す（retryAfterMs があれば、その後に） */
    | { kind: 'retry'; retryAfterMs?: number };

/** 相手の応答（ネットワークの失敗は status なし）から、どうするかを決める。 */
export function classifyDelivery(status: number | null, retryAfter?: string | null, now = Date.now()): DeliveryOutcome {
    if (status !== null && status >= 200 && status < 300) return { kind: 'delivered' };
    if (status === 410) return { kind: 'rejected', gone: true };
    if (status === 400 || status === 401 || status === 403 || status === 404 || status === 413 || status === 422) {
        return { kind: 'rejected', gone: false };
    }
    if (status === 429 && retryAfter) {
        const seconds = Number(retryAfter);
        const at = Number.isFinite(seconds) ? now + seconds * SECOND : Date.parse(retryAfter);
        if (Number.isFinite(at)) {
            return { kind: 'retry', retryAfterMs: Math.min(Math.max(at - now, 0), DELIVERY_LIMITS.MAX_RETRY_AFTER_MS) };
        }
    }
    return { kind: 'retry' };
}

/** 続けて failures 回失敗したホストへ送るのを止める時間（0 なら止めない）。 */
export function circuitPauseMs(failures: number): number {
    if (failures < DELIVERY_LIMITS.CIRCUIT_FAILURES) return 0;
    const doublings = failures - DELIVERY_LIMITS.CIRCUIT_FAILURES;
    return Math.min(
        DELIVERY_LIMITS.CIRCUIT_PAUSE_MS * 2 ** Math.min(doublings, 10),
        DELIVERY_LIMITS.CIRCUIT_MAX_PAUSE_MS,
    );
}

/** 到達できないサーバーか（成功しないまま 3 日。failingSince は成功のあと最初に失敗した時刻、成功で消す）。 */
export function isUnreachable(failingSince: number | null, now: number): boolean {
    return failingSince !== null && now - failingSince >= DELIVERY_LIMITS.UNREACHABLE_AFTER_MS;
}
