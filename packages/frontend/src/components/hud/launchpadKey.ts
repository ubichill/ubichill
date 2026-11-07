/**
 * Esc でランチパッドを開け閉めするかの判定。Esc はホストが使うキーで、mod にも同じキーは届く。
 * 乗り物に乗っている間の Esc は「降りる」に譲る（降りてからもう一度 Esc で開く）。
 */

export interface KeyLike {
    key: string;
    isComposing: boolean;
    /** 日本語入力の変換中は 229（isComposing を立てないブラウザがある） */
    keyCode: number;
    repeat: boolean;
}

export interface KeyContext {
    /** ランチパッドが開いている */
    open: boolean;
    /** 文字を打っている入力欄にフォーカスがある */
    typing: boolean;
    /** ランチパッドのほかに、確認などのダイアログが出ている（そちらが Esc で閉じる） */
    otherDialogOpen: boolean;
    /** 乗り物に乗っている（mod が Esc で降ろす） */
    riding: boolean;
}

export function isLaunchpadToggle(e: KeyLike, ctx: KeyContext): boolean {
    if (e.key !== 'Escape' || e.repeat) return false;
    // 変換中の Esc は変換の取り消し
    if (e.isComposing || e.keyCode === 229) return false;
    if (ctx.typing || ctx.otherDialogOpen) return false;
    return ctx.open || !ctx.riding;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'password', 'number', 'tel', '']);

export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}
