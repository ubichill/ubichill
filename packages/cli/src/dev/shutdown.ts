/**
 * Ctrl+C（SIGINT）・SIGTERM で dev サーバーを止める。何度届いても止める処理は 1 回だけ走らせ、終わるまで受け続ける。
 *
 * `process.once` にすると、1 回目で受け手が外れて既定の動作（即終了）に戻る。`npm run dev` / `npx` は受けた SIGINT を
 * 子に転送するので、端末からの 1 回目のすぐ後に 2 回目が届き、Go に SIGTERM を送る前に node が終わって Go が残る（実際に起きた）。
 */
export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export interface ShutdownDeps {
    on: (signal: ShutdownSignal, listener: () => void) => void;
    /** シグナルで止め終えたら呼ぶ（片付けに失敗したら 1）。 */
    exit: (code: number) => void;
}

export interface Shutdown {
    /** 止める（抜けはしない。起動の失敗で片付けるとき用）。2 回目以降は 1 回目と同じ Promise を返す。 */
    trigger(): Promise<void>;
    /** 止め始めたか（起動の途中で止められたときに、失敗として扱わないため）。 */
    readonly started: boolean;
}

export function handleShutdown(
    stop: () => Promise<void>,
    deps: ShutdownDeps = { on: (signal, listener) => void process.on(signal, listener), exit: process.exit },
): Shutdown {
    const state = { running: null as Promise<void> | null };
    const trigger = () => {
        state.running ??= stop();
        return state.running;
    };
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        deps.on(
            signal,
            () =>
                void trigger().then(
                    () => deps.exit(0),
                    () => deps.exit(1),
                ),
        );
    }
    return {
        trigger,
        get started() {
            return state.running !== null;
        },
    };
}
