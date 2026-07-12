/**
 * toast — アプリ全体で使う軽量トースト通知ストア（モジュールレベル pub/sub）。
 *
 * React 外（例: setDiagnosticHandler で登録する権限拒否ハンドラ）からも `pushToast` で
 * 通知を出せるようにするため、Context ではなくモジュールストアにしている。
 * 表示は `ToastHost`（useSyncExternalStore で購読）が担当する。
 */

export type ToastLevel = 'info' | 'warn' | 'error';

export interface ToastItem {
    id: number;
    message: string;
    level: ToastLevel;
}

const AUTO_DISMISS_MS = 5000;
/** 同一メッセージの連投を抑制する窓（ループ fetch のトースト氾濫を防ぐ）。 */
const DEDUP_MS = 3000;

let _toasts: ToastItem[] = [];
let _seq = 0;
const _listeners = new Set<() => void>();
const _recent = new Map<string, number>();

function emit(): void {
    for (const listener of _listeners) listener();
}

export function subscribeToasts(onChange: () => void): () => void {
    _listeners.add(onChange);
    return () => {
        _listeners.delete(onChange);
    };
}

export function getToasts(): ToastItem[] {
    return _toasts;
}

export function dismissToast(id: number): void {
    _toasts = _toasts.filter((t) => t.id !== id);
    emit();
}

export function pushToast(message: string, level: ToastLevel = 'info'): void {
    const now = Date.now();
    const last = _recent.get(message) ?? 0;
    if (now - last < DEDUP_MS) return; // 直近の同一メッセージは抑制
    _recent.set(message, now);

    const item: ToastItem = { id: _seq++, message, level };
    _toasts = [..._toasts, item];
    emit();
    setTimeout(() => dismissToast(item.id), AUTO_DISMISS_MS);
}
