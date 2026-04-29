import { css } from '@/styled-system/css';

interface YamlEditorFormProps {
    yamlText: string;
    yamlDirty: boolean;
    onChange: (text: string) => void;
    onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * YAML 編集モーダルの中身。textarea + ファイルアップロード。
 */
export function YamlEditorForm({ yamlText, yamlDirty, onChange, onFileUpload }: YamlEditorFormProps) {
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <div
                className={css({
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                })}
            >
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                    `metadata.name` はサーバー側で自動管理されます。
                </p>
                <label
                    className={css({
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 14px',
                        bg: 'secondary',
                        color: 'text',
                        borderRadius: '10px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        _hover: { opacity: 0.9 },
                    })}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                    </svg>
                    YAML ファイルを読み込む
                    <input
                        type="file"
                        accept=".yaml,.yml,application/x-yaml,text/yaml"
                        onChange={onFileUpload}
                        className={css({ display: 'none' })}
                    />
                </label>
            </div>
            <textarea
                value={yamlText}
                onChange={(e) => onChange(e.target.value)}
                spellCheck={false}
                rows={20}
                placeholder="apiVersion: ubichill.com/v1alpha1\nkind: World\n..."
                className={css({
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1.5px solid',
                    borderColor: 'border',
                    bg: 'background',
                    color: 'text',
                    fontFamily: 'mono',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    resize: 'vertical',
                    outline: 'none',
                    _focus: { borderColor: 'primary' },
                })}
            />
            {yamlDirty && (
                <div className={css({ fontSize: '12px', color: 'errorText' })}>
                    YAML 解析エラー — 構文を確認してください（保存はできません）
                </div>
            )}
        </div>
    );
}
