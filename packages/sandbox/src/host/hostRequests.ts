/**
 * 実行中の RPC（fetch・アセット読み込み）を取り消せるように保持する。
 * mod の CMD_ABORT・制限時間・Worker 破棄のどれでも通信を止め、後片付けを 1 か所に集める。
 */
export interface HostRequests {
    /** リクエストを登録し、取り消しと制限時間の両方で abort される signal を返す。 */
    open(id: string, timeoutMs: number): AbortSignal;
    /** 完了したリクエストを外す。 */
    close(id: string): void;
    /** 1 件を取り消す（未登録なら何もしない）。 */
    abort(id: string): void;
    /** すべて取り消す（Worker 破棄時）。 */
    abortAll(): void;
    readonly size: number;
}

const abortReason = (): DOMException => new DOMException('リクエストは取り消されました', 'AbortError');

export function createHostRequests(): HostRequests {
    const controllers = new Map<string, AbortController>();
    return {
        open(id, timeoutMs) {
            controllers.get(id)?.abort(abortReason());
            const controller = new AbortController();
            controllers.set(id, controller);
            return AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
        },
        close(id) {
            controllers.delete(id);
        },
        abort(id) {
            controllers.get(id)?.abort(abortReason());
            controllers.delete(id);
        },
        abortAll() {
            for (const controller of controllers.values()) controller.abort(abortReason());
            controllers.clear();
        },
        get size() {
            return controllers.size;
        },
    };
}

/** RPC の戻り値のうち、コピーせずに Worker へ移せるバイト列。 */
export function transferablesOf(value: unknown): Transferable[] {
    if (value instanceof ArrayBuffer) return [value];
    if (typeof value === 'object' && value !== null && 'body' in value && value.body instanceof ArrayBuffer) {
        return [value.body];
    }
    return [];
}
