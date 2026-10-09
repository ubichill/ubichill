/**
 * 実行しなかった mod の理由を、利用者向けの文にする（純粋）。
 * 理由は loader の `{ rejected }`（lock の照合・作者署名の確認）。
 */

export interface ModRejectionText {
    message: string;
    /** 時間をおけば通る可能性があるか（通信・作者のサーバーの都合）。確定した拒否は false。 */
    retryable: boolean;
}

const TEXTS: Record<string, ModRejectionText> = {
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
};

// 理由は外から来る文字列なので、Object のプロパティ（constructor など）を引かないよう Map で引く
const TEXT_BY_REASON: ReadonlyMap<string, ModRejectionText> = new Map(Object.entries(TEXTS));

export function describeModRejection(reason: string): ModRejectionText {
    return TEXT_BY_REASON.get(reason) ?? { message: `検証に失敗しました (${reason})`, retryable: false };
}

export interface RejectedMod {
    modId: string;
    message: string;
    retryable: boolean;
    /** この mod で実行しなかった Component 型（`modId:componentName`）。再試行の対象。 */
    entityTypes: string[];
}

/** Component 型ごとの理由を、mod ごとの表示にまとめる。mod の中で理由が分かれたら、再試行できない理由を優先して出す。 */
export function groupRejections(rejections: ReadonlyMap<string, string>): RejectedMod[] {
    const byMod = new Map<string, { entityType: string; reason: string }[]>();
    for (const [entityType, reason] of rejections) {
        const modId = entityType.split(':')[0] ?? entityType;
        byMod.set(modId, [...(byMod.get(modId) ?? []), { entityType, reason }]);
    }
    return [...byMod.entries()]
        .map(([modId, items]) => {
            const texts = items.map((item) => describeModRejection(item.reason));
            const shown = texts.find((t) => !t.retryable) ?? texts[0] ?? describeModRejection('');
            return {
                modId,
                message: shown.message,
                retryable: texts.every((t) => t.retryable),
                entityTypes: items.map((item) => item.entityType).sort(),
            };
        })
        .sort((a, b) => a.modId.localeCompare(b.modId));
}
