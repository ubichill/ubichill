import { MAX_PROFILE_LINKS, PROFILE_LINK_LABELS, parseProfileLink } from '@ubichill/shared';
import type { ProfileDraftAction } from '@/lib/profile/profileDraft';
import { css } from '@/styled-system/css';
import { ProfileLinkIcon } from './ProfileLinkIcon';
import { CloseIcon, PlusIcon } from './profileIcons';
import { fieldHint, fieldInput, fieldLabel, profileButton, roundIconButton } from './profileStyles';

const kindBadge = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: '36px',
    height: '36px',
    borderRadius: 'full',
    bg: 'background',
    border: '1px solid',
    borderColor: 'border',
    color: 'text',
});

/** リンクの編集（https だけ・最大件数まで）。入力した URL からサービスを判定してアイコンを出す。 */
export function ProfileLinksEditor({
    links,
    problems,
    disabled,
    dispatch,
}: {
    links: readonly string[];
    problems: ReadonlyArray<string | null>;
    disabled: boolean;
    dispatch: (action: ProfileDraftAction) => void;
}) {
    return (
        <fieldset className={css({ display: 'flex', flexDirection: 'column', gap: '2', border: 'none', p: 0, m: 0 })}>
            <legend className={fieldLabel}>
                リンク（{links.length} / {MAX_PROFILE_LINKS}）
            </legend>
            {links.map((value, index) => {
                const parsed = parseProfileLink(value);
                const kind = parsed.ok ? parsed.kind : 'website';
                const problem = problems[index];
                return (
                    <div key={index} className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
                        <div className={css({ display: 'flex', alignItems: 'center', gap: '2' })}>
                            <span className={kindBadge} title={PROFILE_LINK_LABELS[kind]}>
                                <ProfileLinkIcon kind={kind} size={18} />
                            </span>
                            <input
                                value={value}
                                type="url"
                                inputMode="url"
                                placeholder="https://"
                                aria-label={`リンク ${index + 1}`}
                                disabled={disabled}
                                onChange={(e) => dispatch({ type: 'setLink', index, value: e.target.value })}
                                className={fieldInput({ invalid: !!problem })}
                            />
                            <button
                                type="button"
                                className={roundIconButton({ size: 'sm' })}
                                aria-label={`リンク ${index + 1} を消す`}
                                disabled={disabled}
                                onClick={() => dispatch({ type: 'removeLink', index })}
                            >
                                <CloseIcon size={14} />
                            </button>
                        </div>
                        {problem && <span className={fieldHint({ tone: 'error' })}>{problem}</span>}
                    </div>
                );
            })}
            <div>
                <button
                    type="button"
                    className={profileButton({ size: 'md' })}
                    disabled={disabled || links.length >= MAX_PROFILE_LINKS}
                    onClick={() => dispatch({ type: 'addLink' })}
                >
                    <PlusIcon />
                    リンクを追加
                </button>
            </div>
        </fieldset>
    );
}
