/**
 * SimulationLoop — ワールド全体で 1 本だけ回る「時間の進行」。
 *
 * 以前は Worker（= Component）ごとに rAF を持っていたため、
 *  - Component の数だけループが走り
 *  - 同じフレーム内でどの Worker が先に進むか保証がなく
 *  - ワールド全体を見て何かを計算する場所がどこにも無かった
 * という状態だった。ここに集約することで rAF は常に 1 本になり、実行順は登録順で確定する。
 *
 * フレームの構成は「先にワールドを進め、その結果を持って各 Worker を進める」。
 * こうすると衝突などワールド側で確定した事実を、同じフレームの tick で mod へ渡せる。
 *
 * SharedInputPool と同じく参照カウントで管理し、購読者が居ない間はループを止める。
 */
import { createFrameDispatcher, type FrameSubscriber } from './frameDispatcher';
import { TickController } from './TickController';

/** バックグラウンド（rAF が止まるタブ）でのフォールバック間隔。 */
const BACKGROUND_INTERVAL_MS = 1000 / 60;

/** ワールド側の進行。各 Worker の tick より前に、フレームごとに 1 回だけ呼ばれる。 */
const worldSubscribers = createFrameDispatcher({
    onError: (key, error) => console.error(`[SimulationLoop] world step "${key}" が例外を投げました`, error),
});
/** 各 Worker の tick。 */
const workerSubscribers = createFrameDispatcher();

let controller: TickController | null = null;

function runFrame(deltaMs: number): void {
    worldSubscribers.run(deltaMs);
    workerSubscribers.run(deltaMs);
}

function syncRunning(): void {
    const shouldRun = worldSubscribers.size() + workerSubscribers.size() > 0;
    if (shouldRun && !controller) {
        controller = new TickController({ intervalMs: BACKGROUND_INTERVAL_MS, onTick: runFrame });
        controller.start();
        return;
    }
    if (!shouldRun && controller) {
        controller.stop();
        controller = null;
    }
}

/**
 * ワールドの進行を登録する（衝突判定など）。各 Worker の tick より前に呼ばれる。
 * 同じ key の再登録は差し替え。
 */
export function subscribeWorldStep(key: string, subscriber: FrameSubscriber): void {
    worldSubscribers.add(key, subscriber);
    syncRunning();
}

export function unsubscribeWorldStep(key: string): void {
    worldSubscribers.remove(key);
    syncRunning();
}

/** Worker の tick を登録する。同じ key の再登録は差し替え。 */
export function subscribeWorkerTick(key: string, subscriber: FrameSubscriber): void {
    workerSubscribers.add(key, subscriber);
    syncRunning();
}

export function unsubscribeWorkerTick(key: string): void {
    workerSubscribers.remove(key);
    syncRunning();
}

/** ループが回っているか（テスト・診断用）。 */
export function isSimulationLoopRunning(): boolean {
    return controller !== null;
}
