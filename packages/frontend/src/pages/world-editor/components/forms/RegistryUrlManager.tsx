/**
 * RegistryUrlManager — 外部modレジストリ URL の追加/削除 + エクスポート/インポート。
 *
 * 追加した URL はこの端末の localStorage にしか保存されない（呼び出し側が
 * SETTINGS_KEYS.editorRegistryUrls で管理）。他端末・他ユーザーへ引き継ぐ手段として
 * エクスポート（JSONダウンロード）・インポート（JSON読込・マージ）を提供する。
 */
import { useCallback, useRef, useState } from 'react';
import { css } from '@/styled-system/css';

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((v) => typeof v === 'string');

interface RegistryExport {
    version: 1;
    registryUrls: string[];
}

function downloadJson(filename: string, data: unknown): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

interface RegistryUrlManagerProps {
    registryUrls: string[];
    onChange: (next: string[]) => void;
}

export function RegistryUrlManager({ registryUrls, onChange }: RegistryUrlManagerProps) {
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleAdd = useCallback(() => {
        const trimmed = input.trim();
        if (!trimmed) return;
        try {
            new URL(trimmed);
        } catch {
            setError('URL の形式が不正です');
            return;
        }
        if (registryUrls.includes(trimmed)) {
            setError('既に追加されています');
            return;
        }
        onChange([...registryUrls, trimmed]);
        setInput('');
        setError('');
    }, [input, registryUrls, onChange]);

    const handleRemove = useCallback(
        (url: string) => {
            onChange(registryUrls.filter((u) => u !== url));
        },
        [registryUrls, onChange],
    );

    const handleExport = useCallback(() => {
        const data: RegistryExport = { version: 1, registryUrls };
        downloadJson('ubichill-mod-registries.json', data);
    }, [registryUrls]);

    const handleImportFile = useCallback(
        (file: File) => {
            file.text()
                .then((text) => {
                    const parsed = JSON.parse(text) as Partial<RegistryExport>;
                    if (!isStringArray(parsed.registryUrls)) {
                        setError('インポートファイルの形式が不正です');
                        return;
                    }
                    const merged = new Set(registryUrls);
                    for (const url of parsed.registryUrls) merged.add(url);
                    onChange(Array.from(merged));
                    setError('');
                })
                .catch(() => setError('インポートファイルの読み込みに失敗しました'));
        },
        [registryUrls, onChange],
    );

    return (
        <div
            className={css({
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                bg: 'background',
                borderRadius: '10px',
                p: '10px 12px',
                border: '1px solid',
                borderColor: 'border',
            })}
        >
            <span className={css({ fontSize: '12px', color: 'textMuted', fontWeight: '600' })}>
                レジストリ URL を追加（外部mod）
            </span>
            <div className={css({ display: 'flex', gap: '6px' })}>
                <input
                    type="url"
                    value={input}
                    onChange={(e) => {
                        setInput(e.target.value);
                        setError('');
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAdd();
                        }
                    }}
                    placeholder="https://example.com/mods/index.json"
                    className={css({
                        flex: 1,
                        padding: '6px 10px',
                        borderRadius: '8px',
                        border: '1.5px solid',
                        borderColor: error ? 'errorText' : 'border',
                        bg: 'surface',
                        color: 'text',
                        fontSize: '12px',
                        outline: 'none',
                        _focus: { borderColor: 'primary' },
                    })}
                />
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!input.trim()}
                    className={css({
                        padding: '6px 14px',
                        bg: 'primary',
                        color: 'textOnPrimary',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                        _hover: { opacity: 0.9 },
                    })}
                >
                    追加
                </button>
            </div>
            {error && <span className={css({ fontSize: '11px', color: 'errorText' })}>{error}</span>}

            {registryUrls.length > 0 && (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '4px', mt: '2px' })}>
                    {registryUrls.map((url) => (
                        <div
                            key={url}
                            className={css({
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                fontSize: '12px',
                                color: 'textMuted',
                                gap: '6px',
                            })}
                        >
                            <span
                                className={css({
                                    flex: 1,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                })}
                            >
                                {url}
                            </span>
                            <button
                                type="button"
                                onClick={() => handleRemove(url)}
                                className={css({
                                    fontSize: '11px',
                                    color: 'errorText',
                                    bg: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    flexShrink: 0,
                                })}
                            >
                                削除
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className={css({ display: 'flex', gap: '6px', mt: '2px' })}>
                <button
                    type="button"
                    onClick={handleExport}
                    disabled={registryUrls.length === 0}
                    className={css({
                        px: '3',
                        py: '1',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: 'border',
                        bg: 'transparent',
                        color: 'text',
                        fontSize: '11px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                        _hover: { bg: 'surfaceHover' },
                    })}
                >
                    エクスポート
                </button>
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={css({
                        px: '3',
                        py: '1',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: 'border',
                        bg: 'transparent',
                        color: 'text',
                        fontSize: '11px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        _hover: { bg: 'surfaceHover' },
                    })}
                >
                    インポート
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json"
                    className={css({ display: 'none' })}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImportFile(file);
                        e.target.value = '';
                    }}
                />
            </div>
        </div>
    );
}
