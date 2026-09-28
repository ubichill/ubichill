import { useState } from 'react';
import { setMyDisplayName } from '@/lib/account/me';
import { useDisplayNameAvailability } from '@/lib/account/useHandleAvailability';
import { css } from '@/styled-system/css';

interface DisplayNameEditorProps {
    name: string;
    /** 移行時に他人と重複していた。変更するまで警告を出す。 */
    conflict: boolean;
    onChanged: (name: string) => void;
}

/** 自分の表示名の変更（一意。全角半角・大文字小文字・空白の違いは同じ名前として扱う）。 */
export function DisplayNameEditor({ name, conflict, onChanged }: DisplayNameEditorProps) {
    const [editing, setEditing] = useState(conflict);
    const [value, setValue] = useState(name);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const status = useDisplayNameAvailability(value, editing && value.trim() !== name);

    const save = async () => {
        setBusy(true);
        setError('');
        try {
            const result = await setMyDisplayName(value.trim());
            onChanged(result.name);
            setEditing(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : '変更できませんでした');
        } finally {
            setBusy(false);
        }
    };

    if (!editing) {
        return (
            <button
                type="button"
                onClick={() => setEditing(true)}
                className={css({
                    fontSize: '12px',
                    color: 'textMuted',
                    bg: 'transparent',
                    border: 'none',
                    p: 0,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                })}
            >
                表示名を変更
            </button>
        );
    }

    const unchanged = value.trim() === name && !conflict;
    return (
        <div className={css({ mt: '2' })}>
            {conflict && (
                <p className={css({ fontSize: '12px', color: 'errorText', mb: '1' })}>
                    表示名が他のユーザーと重複しています。重複しない名前に変更してください。
                </p>
            )}
            <div className={css({ display: 'flex', gap: '2', alignItems: 'center', flexWrap: 'wrap' })}>
                <input
                    value={value}
                    onChange={(e) => setValue(e.target.value.slice(0, 30))}
                    aria-label="表示名"
                    className={css({
                        px: '3',
                        py: '2',
                        border: '1px solid',
                        borderColor: 'border',
                        borderRadius: '8px',
                        fontSize: '14px',
                        bg: 'background',
                        color: 'text',
                    })}
                />
                <button
                    type="button"
                    disabled={busy || unchanged || (value.trim() !== name && status.state !== 'available')}
                    onClick={() => void save()}
                    className={css({
                        px: '3',
                        py: '2',
                        bg: 'primary',
                        color: 'textOnPrimary',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                    })}
                >
                    保存
                </button>
                {!conflict && (
                    <button
                        type="button"
                        onClick={() => {
                            setValue(name);
                            setEditing(false);
                        }}
                        className={css({
                            px: '3',
                            py: '2',
                            bg: 'surface',
                            color: 'textMuted',
                            border: '1px solid',
                            borderColor: 'border',
                            borderRadius: '8px',
                            fontSize: '13px',
                            cursor: 'pointer',
                        })}
                    >
                        キャンセル
                    </button>
                )}
            </div>
            {'error' in status && (
                <p className={css({ mt: '1', fontSize: '12px', color: 'errorText' })}>{status.error}</p>
            )}
            {error && <p className={css({ mt: '1', fontSize: '12px', color: 'errorText' })}>{error}</p>}
        </div>
    );
}
