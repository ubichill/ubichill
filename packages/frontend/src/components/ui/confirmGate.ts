export interface ConfirmGate {
    /** 確かめる画面を出し、答えを返す。もう出ているときは出さずに false（やめた）を返す。 */
    ask(message: string): Promise<boolean>;
    /** 出ている確認に答える。出ていなければ何もしない（ボタンと Esc が続けて来ても 1 回だけ）。 */
    settle(result: boolean): void;
}

/**
 * 確かめる画面は一度に 1 つ。後から来た確認で上書きすると、確かめた人が見ていない行き先へ進み、
 * 先に待っていた側はいつまでも答えを受け取れない（ポータルを 2 つ続けて押したときなど）。
 */
export function createConfirmGate(onChange: (message: string | null) => void): ConfirmGate {
    const slot: { pending: { message: string; resolve: (result: boolean) => void } | null } = { pending: null };
    return {
        ask: (message) => {
            if (slot.pending) return Promise.resolve(false);
            return new Promise<boolean>((resolve) => {
                slot.pending = { message, resolve };
                onChange(message);
            });
        },
        settle: (result) => {
            const pending = slot.pending;
            if (!pending) return;
            slot.pending = null;
            onChange(null);
            pending.resolve(result);
        },
    };
}
