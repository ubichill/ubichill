import { decideDisplayNameChange, displayNameKey } from '@ubichill/shared';
import type { NameAvailability } from '@/lib/account/useHandleAvailability';

export type DisplayNameCheck =
    | { kind: 'unchanged' }
    | { kind: 'ok' }
    | { kind: 'checking' }
    /** 別の名前に変えられるのは一定期間に 1 回（見た目だけの変更はいつでもできる） */
    | { kind: 'cooldown'; availableAt: Date }
    | { kind: 'error'; message: string };

export interface DisplayNameCheckInput {
    /** 今の表示名 */
    current: string;
    /** 移行時に他人と重複していた（変えるまで警告する） */
    conflict: boolean;
    /** 次に別の名前へ変えられる時刻（ISO 8601）。制限が無ければ null */
    availableAt: string | null;
    value: string;
    /** サーバーへの空きの確認の結果 */
    availability: NameAvailability;
    now: Date;
}

/** 表示名の入力を保存してよいか（API と同じ規則。空きはサーバーに確かめた結果を使う）。 */
export function checkDisplayName({
    current,
    conflict,
    availableAt,
    value,
    availability,
    now,
}: DisplayNameCheckInput): DisplayNameCheck {
    const trimmed = value.trim();
    if (trimmed === current && !conflict) return { kind: 'unchanged' };
    const decision = decideDisplayNameChange(
        {
            currentKey: conflict ? null : displayNameKey(current),
            availableAt: availableAt ? new Date(availableAt) : null,
        },
        trimmed,
        now,
    );
    if (decision.kind === 'cooldown') return { kind: 'cooldown', availableAt: decision.availableAt };
    if (trimmed === current) return { kind: 'ok' };
    switch (availability.state) {
        case 'available':
            return { kind: 'ok' };
        case 'invalid':
        case 'taken':
            return { kind: 'error', message: availability.error };
        case 'empty':
            return { kind: 'error', message: '表示名を入力してください' };
        case 'checking':
            return { kind: 'checking' };
    }
}

export const canSaveDisplayName = (check: DisplayNameCheck): boolean =>
    check.kind === 'unchanged' || check.kind === 'ok';
