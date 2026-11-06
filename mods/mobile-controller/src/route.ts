/**
 * 送り先の決め方の純計算。`Ubi` グローバルに触れないので単体テストできる。
 */
import type { EmitOptions, RefEmitOptions } from 'ubichill';

/**
 * 「操作する Entity」（`target`）が設定されていて Host が参照での配送に対応していればそこへ、
 * そうでなければ自分の Entity（と子）へ送る。v1.0.0 は自分の Entity に送っていたので、
 * `target` の無い既存のワールドはそのまま動く。
 */
export function controllerRoute(target: unknown, hostSupportsRef: boolean): EmitOptions | RefEmitOptions {
    return hostSupportsRef && typeof target === 'string' && target.length > 0
        ? { ref: 'target' }
        : { scope: 'subtree' };
}
