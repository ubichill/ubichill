/**
 * 重なったダイアログの順番。Esc は一番手前のダイアログだけが受け取る（確認 → ワールドの詳細 → ランチパッドの順に 1 枚ずつ閉じる）。
 */
import { useEffect, useRef } from 'react';

export interface DialogStack {
    open(id: symbol): void;
    close(id: symbol): void;
    isTop(id: symbol): boolean;
    readonly size: number;
}

export function createDialogStack(): DialogStack {
    const layers: symbol[] = [];
    return {
        open: (id) => {
            if (!layers.includes(id)) layers.push(id);
        },
        close: (id) => {
            const index = layers.indexOf(id);
            if (index >= 0) layers.splice(index, 1);
        },
        isTop: (id) => layers.at(-1) === id,
        get size() {
            return layers.length;
        },
    };
}

const dialogs = createDialogStack();

/** ランチパッドの外で、確認などのダイアログが出ているか。 */
export function hasOpenDialog(): boolean {
    return dialogs.size > 0;
}

/** 変換中（日本語入力）の Esc は変換の取り消しなので、閉じる合図にしない。 */
export function isCloseKey(e: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'>): boolean {
    return e.key === 'Escape' && !e.isComposing && e.keyCode !== 229;
}

/** 開いている間ダイアログとして重なり、一番手前のときだけ Esc で onEscape を呼ぶ。 */
export function useDialogLayer(onEscape: () => void, active = true): void {
    const onEscapeRef = useRef(onEscape);
    onEscapeRef.current = onEscape;
    useEffect(() => {
        if (!active) return;
        const id = Symbol('dialog');
        dialogs.open(id);
        const onKeyDown = (e: KeyboardEvent) => {
            if (isCloseKey(e) && dialogs.isTop(id)) onEscapeRef.current();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            dialogs.close(id);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [active]);
}
