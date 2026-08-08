/**
 * ModRegistrySection — 外部modレジストリの管理（設定タブ内）。
 *
 * 追加したレジストリ URL はこの端末の localStorage にしか保存されない
 * （SETTINGS_KEYS.editorRegistryUrls、ワールドエディタと共有）。他端末・他ユーザーへ
 * 引き継ぐ手段としてエクスポート（JSONダウンロード）・インポート（JSON読込）を提供する。
 */
import { useCallback, useRef, useState } from 'react';
import { type AvailableMod, useAvailableMods } from '@/lib/mods/useAvailableMods';
import { SETTINGS_KEYS, useSetting } from '@/lib/settings';
import { css } from '@/styled-system/css';
import { cardStyle, sectionHeading } from './shared';

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

function ModRow({ mod }: { mod: AvailableMod }) {
    return (
        <div
            className={css({
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '3',
                p: '3',
                bg: 'surface',
                borderRadius: '12px',
            })}
        >
            <div className={css({ flex: 1, minW: 0 })}>
                <div className={css({ fontSize: '14px', fontWeight: '600', color: 'text' })}>{mod.name}</div>
                <div className={css({ fontSize: '11px', color: 'textSubtle', mt: '1' })}>
                    v{mod.version} · {mod.components.length} components
                </div>
                {mod.components.length > 0 && (
                    <div className={css({ fontSize: '11px', color: 'textMuted', mt: '1' })}>
                        {mod.components.join(', ')}
                    </div>
                )}
            </div>
            <span
                className={css({
                    fontSize: '10px',
                    fontWeight: '700',
                    color: 'textSubtle',
                    flexShrink: 0,
                    px: '2',
                    py: '0.5',
                    borderRadius: '999px',
                    bg: 'secondary',
                })}
            >
                {mod.sourceLabel === 'local' ? 'ローカル' : mod.sourceLabel}
            </span>
        </div>
    );
}

export function ModRegistrySection() {
    const [registryUrls, setRegistryUrls] = useSetting<string[]>(SETTINGS_KEYS.editorRegistryUrls, [], isStringArray);
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { mods, loading } = useAvailableMods(registryUrls);

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
        setRegistryUrls((prev) => [...prev, trimmed]);
        setInput('');
        setError('');
    }, [input, registryUrls, setRegistryUrls]);

    const handleRemove = useCallback(
        (url: string) => {
            setRegistryUrls((prev) => prev.filter((u) => u !== url));
        },
        [setRegistryUrls],
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
                    setRegistryUrls((prev) => {
                        const merged = new Set(prev);
                        for (const url of parsed.registryUrls as string[]) merged.add(url);
                        return [...merged];
                    });
                    setError('');
                })
                .catch(() => setError('インポートファイルの読み込みに失敗しました'));
        },
        [setRegistryUrls],
    );

    return (
        <div className={cardStyle}>
            <h2 className={sectionHeading}>外部modレジストリ</h2>
            <p className={css({ fontSize: '13px', color: 'textMuted', mb: '4', lineHeight: '1.6' })}>
                ワールドで使える外部mod（自分で書いたmod・他の人が公開しているmod）のレジストリ URL を登録する。
                この端末にのみ保存されるため、他端末へ移すにはエクスポート/インポートを使う。
            </p>

            <div className={css({ display: 'flex', gap: '2', mb: '2' })}>
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
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1.5px solid',
                        borderColor: error ? 'errorText' : 'border',
                        bg: 'surface',
                        color: 'text',
                        fontSize: '13px',
                        outline: 'none',
                        _focus: { borderColor: 'primary' },
                    })}
                />
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!input.trim()}
                    className={css({
                        px: '4',
                        py: '2',
                        borderRadius: '8px',
                        border: 'none',
                        bg: 'primary',
                        color: 'textOnPrimary',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                        _hover: { opacity: 0.9 },
                    })}
                >
                    追加
                </button>
            </div>
            {error && <p className={css({ fontSize: '12px', color: 'errorText', mb: '2' })}>{error}</p>}

            {registryUrls.length > 0 && (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '1', mb: '4' })}>
                    {registryUrls.map((url) => (
                        <div
                            key={url}
                            className={css({
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                fontSize: '12px',
                                color: 'textMuted',
                                gap: '2',
                            })}
                        >
                            <span
                                className={css({
                                    flex: 1,
                                    minW: 0,
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

            <div className={css({ display: 'flex', gap: '2', mb: '5' })}>
                <button
                    type="button"
                    onClick={handleExport}
                    disabled={registryUrls.length === 0}
                    className={css({
                        px: '3',
                        py: '1.5',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: 'border',
                        bg: 'transparent',
                        color: 'text',
                        fontSize: '12px',
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
                        py: '1.5',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: 'border',
                        bg: 'transparent',
                        color: 'text',
                        fontSize: '12px',
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

            <h3 className={css({ fontSize: '14px', fontWeight: '700', color: 'text', mb: '2' })}>
                利用可能なmod
                {loading && <span className={css({ color: 'textSubtle', fontWeight: '400' })}> (読み込み中...)</span>}
            </h3>
            <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                {mods.map((mod) => (
                    <ModRow key={`${mod.sourceLabel}:${mod.id}`} mod={mod} />
                ))}
                {!loading && mods.length === 0 && (
                    <div className={css({ fontSize: '13px', color: 'textMuted', p: '4', textAlign: 'center' })}>
                        利用可能なmodが見つかりません
                    </div>
                )}
            </div>
        </div>
    );
}
