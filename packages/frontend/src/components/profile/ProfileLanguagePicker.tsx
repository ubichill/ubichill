import { MAX_PROFILE_LANGUAGES, PROFILE_LANGUAGES, type ProfileLanguageCode } from '@ubichill/shared';
import { css } from '@/styled-system/css';
import { chip, fieldLabel } from './profileStyles';

/** 話せる言語を選ぶ（決まった一覧から最大件数まで。上限に達したら、選んでいないものは押せない）。 */
export function ProfileLanguagePicker({
    selected,
    disabled,
    onToggle,
}: {
    selected: readonly ProfileLanguageCode[];
    disabled: boolean;
    onToggle: (code: ProfileLanguageCode) => void;
}) {
    const full = selected.length >= MAX_PROFILE_LANGUAGES;
    return (
        <fieldset className={css({ border: 'none', p: 0, m: 0 })}>
            <legend className={fieldLabel}>
                言語（{selected.length} / {MAX_PROFILE_LANGUAGES}）
            </legend>
            <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '2', mt: '2' })}>
                {PROFILE_LANGUAGES.map(({ code, label }) => {
                    const isSelected = selected.includes(code);
                    return (
                        <button
                            key={code}
                            type="button"
                            lang={code}
                            aria-pressed={isSelected}
                            disabled={disabled || (full && !isSelected)}
                            onClick={() => onToggle(code)}
                            className={chip({ selected: isSelected, interactive: true })}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>
        </fieldset>
    );
}
