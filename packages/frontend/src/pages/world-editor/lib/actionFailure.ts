/** 保存・公開のどの段階で失敗したか。build は mod の取得・検証と lock の計算。 */
export type FailureStage = 'build' | 'save' | 'publish';

export interface ActionFailure {
    stage: FailureStage;
    message: string;
}

const STAGE_LABEL: Record<FailureStage, string> = { build: 'ビルド', save: '下書き保存', publish: '公開' };
const STAGE_TITLE: Record<FailureStage, string> = {
    build: 'ビルドに失敗しました',
    save: '下書きを保存できませんでした',
    publish: '公開に失敗しました',
};

export function stageLabel(stage: FailureStage): string {
    return STAGE_LABEL[stage];
}

export function failureTitle(stage: FailureStage): string {
    return STAGE_TITLE[stage];
}

class StageError extends Error {
    constructor(
        readonly stage: FailureStage,
        message: string,
    ) {
        super(message);
    }
}

const messageOf = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback;

/** task の失敗に段階を付ける。内側で付いた段階は上書きしない。 */
export async function inStage<T>(stage: FailureStage, task: () => Promise<T>): Promise<T> {
    try {
        return await task();
    } catch (error) {
        throw error instanceof StageError ? error : new StageError(stage, messageOf(error, failureTitle(stage)));
    }
}

/** 投げられたものを失敗の記録にする。段階が付いていなければ fallback の段階にする。 */
export function toActionFailure(error: unknown, fallback: FailureStage): ActionFailure {
    if (error instanceof StageError) return { stage: error.stage, message: error.message };
    return { stage: fallback, message: messageOf(error, failureTitle(fallback)) };
}
