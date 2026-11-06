import { DISPLAY_NAME_CHANGE_COOLDOWN_DAYS, DISPLAY_NAME_MAX_LENGTH } from '@ubichill/shared';
import type { DisplayNameCheck } from '@/lib/profile/displayNameCheck';
import { css } from '@/styled-system/css';
import { fieldHint, fieldInput, fieldLabel } from './profileStyles';

function hintOf(check: DisplayNameCheck, conflict: boolean): { tone: 'muted' | 'error'; text: string } | null {
    switch (check.kind) {
        case 'unchanged':
            return conflict
                ? { tone: 'error', text: '表示名が他のユーザーと重複しています。変更してください。' }
                : null;
        case 'ok':
            return { tone: 'muted', text: 'この表示名は使えます' };
        case 'checking':
            return { tone: 'muted', text: '使えるか確認しています...' };
        case 'cooldown':
            return {
                tone: 'error',
                text: `別の名前に変えられるのは ${DISPLAY_NAME_CHANGE_COOLDOWN_DAYS} 日に 1 回までです。次は ${check.availableAt.toLocaleDateString('ja-JP')} 以降に変えられます（大文字小文字・全角半角だけの変更はいつでもできます）。`,
            };
        case 'error':
            return { tone: 'error', text: check.message };
    }
}

/** 表示名の入力（一意・別の名前に変えられるのは一定期間に 1 回）。空きはサーバーに確かめる。 */
export function DisplayNameField({
    value,
    current,
    conflict,
    check,
    disabled,
    onChange,
}: {
    value: string;
    current: string;
    conflict: boolean;
    check: DisplayNameCheck;
    disabled: boolean;
    onChange: (value: string) => void;
}) {
    const hint = hintOf(check, conflict);
    return (
        <label className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
            <span className={fieldLabel}>表示名</span>
            <input
                value={value}
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                disabled={disabled}
                placeholder={current}
                onChange={(e) => onChange(e.target.value)}
                className={fieldInput({ invalid: check.kind === 'error' || check.kind === 'cooldown' })}
            />
            {hint && <span className={fieldHint({ tone: hint.tone })}>{hint.text}</span>}
        </label>
    );
}
