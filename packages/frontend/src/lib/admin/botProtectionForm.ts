/**
 * コントロールパネルの「ボット対策」の入力から、保存できるか・何を送るかを決める。
 * 使うときは、その鍵の組でウィジェットを通したトークンが要る（誤った鍵で登録を全部止めないように）。
 */
import type { BotProtectionProvider, BotProtectionSettings, BotProtectionUpdate } from '@ubichill/shared';

export interface BotProtectionDraft {
    provider: BotProtectionProvider | null;
    siteKey: string;
    /** 空なら保存済みのものを使う（同じサービスのときだけ） */
    secret: string;
    token: string | null;
}

export type BotProtectionDraftState =
    | { kind: 'unchanged' }
    /** 足りないもの。`check` はウィジェットを通していない */
    | { kind: 'incomplete'; missing: 'siteKey' | 'secret' | 'check' }
    | { kind: 'ready'; update: BotProtectionUpdate };

/** 今の設定から始める入力。シークレットキーは返ってこないので空にしておく。 */
export const draftFrom = (settings: BotProtectionSettings): BotProtectionDraft => ({
    provider: settings.config?.provider ?? null,
    siteKey: settings.config?.siteKey ?? '',
    secret: '',
    token: null,
});

/** 保存済みのシークレットキーを使えるか（同じサービスで、開けるもの）。 */
export const canReuseSecret = (settings: BotProtectionSettings, provider: BotProtectionProvider | null): boolean =>
    provider !== null && settings.config?.provider === provider && settings.secretReadable;

export function botProtectionDraftState(
    settings: BotProtectionSettings,
    draft: BotProtectionDraft,
): BotProtectionDraftState {
    if (draft.provider === null) {
        // 読めない設定（知らないサービスなど）が残っていれば、使わないにして消せる
        const off = settings.config === null && settings.secretReadable;
        return off ? { kind: 'unchanged' } : { kind: 'ready', update: { provider: null } };
    }
    const siteKey = draft.siteKey.trim();
    const secret = draft.secret.trim();
    const reuse = canReuseSecret(settings, draft.provider);
    if (!siteKey) return { kind: 'incomplete', missing: 'siteKey' };
    if (!secret && !reuse) return { kind: 'incomplete', missing: 'secret' };
    if (!secret && settings.config?.siteKey === siteKey) return { kind: 'unchanged' };
    if (!draft.token) return { kind: 'incomplete', missing: 'check' };
    return {
        kind: 'ready',
        update: { provider: draft.provider, siteKey, token: draft.token, ...(secret ? { secret } : {}) },
    };
}
