export interface ConfirmGate {
    /** 確かめる画面を出し、答えを返す。前の確認が出ていれば、それを「やめた」（false）で閉じてから出す。 */
    ask(message: string): Promise<boolean>;
    /** 出ている確認に答える。出ていなければ何もしない（ボタンと Esc が続けて来ても 1 回だけ）。 */
    settle(result: boolean): void;
}

/**
 * 確かめる画面は一度に 1 つで、後から来た確認を出す（画面を移った・入り直した側が今の確認）。前の確認は false で
 * 終わらせ、答えを待ったまま残さない。
 */
export function createConfirmGate(onChange: (message: string | null) => void): ConfirmGate {
    const slot: { pending: { resolve: (result: boolean) => void } | null } = { pending: null };
    return {
        ask: (message) =>
            new Promise<boolean>((resolve) => {
                const replaced = slot.pending;
                slot.pending = { resolve };
                onChange(message);
                replaced?.resolve(false);
            }),
        settle: (result) => {
            const pending = slot.pending;
            if (!pending) return;
            slot.pending = null;
            onChange(null);
            pending.resolve(result);
        },
    };
}
