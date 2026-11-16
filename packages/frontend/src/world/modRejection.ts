/**
 * 実行しなかった mod の理由を、利用者向けの文にする（純粋）。
 * 理由は loader の `{ rejected }`（lock の照合・作者署名の確認）と、作者をブロックしている（{@link blockedAuthorRejection}）。
 */
import { isModAuthorBlocked } from '@ubichill/shared';
import type { ConsoleInput } from '@/lib/console/console';

export interface ModRejectionText {
    message: string;
    /** 時間をおけば通る可能性があるか（通信・作者のサーバーの都合）。確定した拒否は false。 */
    retryable: boolean;
}

const TEXTS: Record<string, ModRejectionText> = {
    'load-unavailable': { message: 'mod のファイルを取得できません。時間をおいて再試行してください', retryable: true },
    'lock-missing': { message: 'ワールドがこの mod の内容を固定していません', retryable: false },
    'integrity-mismatch': { message: 'ワールドが固定した内容と違うコードが配られています', retryable: false },
    'manifest-mismatch': { message: 'ワールドが固定した内容と違う定義が配られています', retryable: false },
    'signature-missing': { message: '作者の署名がありません', retryable: false },
    'signature-malformed': { message: '作者の署名を読めません', retryable: false },
    'signature-mod-mismatch': { message: '別の mod・別の版の署名が付いています', retryable: false },
    'signature-content-mismatch': { message: '署名された内容と、ワールドが固定した内容が違います', retryable: false },
    'signature-invalid': { message: '作者の署名が正しくありません', retryable: false },
    'author-unconfirmed': {
        message: '署名した鍵が作者のものと確認できません（取り消された可能性があります）',
        retryable: false,
    },
    'author-pending': { message: 'いまは作者を確認できません（通信、または作者のサーバーの都合）', retryable: true },
    'author-blocked': { message: 'ブロックした人が作った mod です', retryable: false },
};

/**
 * 署名で確かめた作者がブロックした人なら、実行しない理由を返す。作者の無い mod（データだけ・開発の未署名）は止めない。
 * 作者は署名を確かめたあとの値なので、作者を名乗るだけの mod では一致しない（作者の鍵で署名されたものだけが一致する）。
 */
export function blockedAuthorRejection(
    author: string | undefined,
    blockedAuthors: ReadonlySet<string>,
): { rejected: 'author-blocked' } | null {
    return isModAuthorBlocked(author, blockedAuthors) ? { rejected: 'author-blocked' } : null;
}

// 理由は外から来る文字列なので、Object のプロパティ（constructor など）を引かないよう Map で引く
const TEXT_BY_REASON: ReadonlyMap<string, ModRejectionText> = new Map(Object.entries(TEXTS));

export function describeModRejection(reason: string): ModRejectionText {
    return TEXT_BY_REASON.get(reason) ?? { message: `検証に失敗しました (${reason})`, retryable: false };
}

/** Component 型（`modId:componentName`）の mod の ID。 */
export function modIdOfType(entityType: string): string {
    return entityType.split(':')[0] ?? entityType;
}

/**
 * 読み込めなかった mod のコンソールの記録。確定した拒否（署名・内容の不一致）はエラー、
 * 時間をおけば通るもの（通信・作者のサーバーの都合）は警告にして再試行を付ける。
 */
export function modRejectionLog(modId: string, reason: string, retry: () => void): ConsoleInput {
    const text = describeModRejection(reason);
    const hint = text.retryable
        ? '通信が回復したら、再試行してください。'
        : '署名や内容の問題です。ワールドの作者にこの理由を伝えてください。';
    return {
        level: text.retryable ? 'warning' : 'error',
        source: modId,
        message: `読み込めませんでした: ${text.message}`,
        detail: `${hint}\n理由: ${reason}`,
        ...(text.retryable ? { action: { label: '再試行', run: retry } } : {}),
    };
}

/** 再試行で読み込み直す Component 型（その mod のうち、再試行で通る可能性のあるもの）と、止まっている数。 */
export function retryTargets(
    rejections: ReadonlyMap<string, string>,
    modId: string,
): { targets: string[]; rejected: number } {
    const ofMod = [...rejections].filter(([type]) => modIdOfType(type) === modId);
    return {
        targets: ofMod.filter(([, reason]) => describeModRejection(reason).retryable).map(([type]) => type),
        rejected: ofMod.length,
    };
}
