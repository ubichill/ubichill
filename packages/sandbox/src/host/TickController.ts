/**
 * TickController — Tick（時間経過）生成の関心事を ModHostManager から分離したもの。
 *
 * 前面タブは requestAnimationFrame、バックグラウンド（document.hidden）では
 * setInterval にフォールバックする（rAF は不可視タブで止まるため）。visibilitychange で
 * 双方を切り替える。onTick には前フレームからの経過 ms を渡す。
 */
export interface TickControllerOptions {
    /** バックグラウンド時の setInterval 間隔 (ms)。 */
    intervalMs: number;
    /** 各 Tick で呼ばれる。deltaMs = 前フレームからの経過時間。 */
    onTick: (deltaMs: number) => void;
}

export class TickController {
    private readonly intervalMs: number;
    private readonly onTick: (deltaMs: number) => void;
    private animationFrameId?: number;
    private intervalId?: ReturnType<typeof setInterval>;
    private lastTime = performance.now();
    private running = false;

    // bind 済み arrow field（毎フレーム bind しない）。
    private readonly _animate = (time: number): void => {
        this.onTick(time - this.lastTime);
        this.lastTime = time;
        this.animationFrameId = requestAnimationFrame(this._animate);
    };

    private readonly _intervalTick = (): void => {
        const now = performance.now();
        this.onTick(now - this.lastTime);
        this.lastTime = now;
    };

    private readonly _onVisibilityChange = (): void => {
        this.lastTime = performance.now();
        if (!document.hidden) {
            this._clearInterval();
            this.animationFrameId = requestAnimationFrame(this._animate);
        } else {
            this._clearAnimationFrame();
            this.intervalId = setInterval(this._intervalTick, this.intervalMs);
        }
    };

    constructor(options: TickControllerOptions) {
        this.intervalMs = options.intervalMs;
        this.onTick = options.onTick;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        document.addEventListener('visibilitychange', this._onVisibilityChange);
        if (!document.hidden) {
            this.animationFrameId = requestAnimationFrame(this._animate);
        } else {
            this.intervalId = setInterval(this._intervalTick, this.intervalMs);
        }
    }

    stop(): void {
        if (!this.running) return;
        this.running = false;
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        this._clearAnimationFrame();
        this._clearInterval();
    }

    private _clearAnimationFrame(): void {
        if (this.animationFrameId !== undefined) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = undefined;
        }
    }

    private _clearInterval(): void {
        if (this.intervalId !== undefined) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
    }
}
