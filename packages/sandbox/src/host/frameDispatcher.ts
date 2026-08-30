/**
 * 1 フレームで呼ぶ処理の登録簿（DOM も時計も持たない）。
 *
 * 時間の発生源（rAF / setInterval）と切り離してあるので、順序と例外の扱いだけを
 * 単体テストできる。実際にフレームを刻むのは {@link ../SimulationLoop} 側。
 */

export type FrameSubscriber = (deltaMs: number) => void;

export interface FrameDispatcher {
    /** 同じ key で再登録すると差し替える（Worker 再生成時に二重登録しない）。 */
    add(key: string, subscriber: FrameSubscriber): void;
    remove(key: string): void;
    size(): number;
    /**
     * 登録順に 1 フレーム進める。
     *
     * どれか 1 つが例外を投げても残りは必ず実行する。ループを 1 本に束ねた以上、
     * mod 1 つの不具合でワールド全体の時間が止まってはいけない。
     */
    run(deltaMs: number): void;
}

export interface FrameDispatcherOptions {
    /** 例外の通知先。既定は console.error。 */
    onError?: (key: string, error: unknown) => void;
}

export function createFrameDispatcher(options: FrameDispatcherOptions = {}): FrameDispatcher {
    const subscribers = new Map<string, FrameSubscriber>();
    const onError =
        options.onError ??
        ((key, error) => console.error(`[SimulationLoop] frame subscriber "${key}" が例外を投げました`, error));

    return {
        add(key, subscriber) {
            subscribers.set(key, subscriber);
        },
        remove(key) {
            subscribers.delete(key);
        },
        size() {
            return subscribers.size;
        },
        run(deltaMs) {
            // 実行中の add/remove で反復が壊れないよう、スナップショットを取ってから回す。
            for (const [key, subscriber] of [...subscribers]) {
                try {
                    subscriber(deltaMs);
                } catch (error) {
                    onError(key, error);
                }
            }
        },
    };
}
