import { css } from '@/styled-system/css';
import type { AvailableEntityKind } from './useAvailableEntityKinds';

interface EditorAssetsProps {
    kinds: AvailableEntityKind[];
    loading: boolean;
    placedKinds: Set<string>;
    onAdd: (k: AvailableEntityKind) => void;
}

/**
 * 下ドックの「アセット」パネル。
 * 利用可能エンティティをカードで横並べ表示し、クリックで追加。
 */
export function EditorAssets({ kinds, loading, placedKinds, onAdd }: EditorAssetsProps) {
    return (
        <section
            className={css({
                gridArea: 'bottom',
                bg: 'surface',
                borderTop: '1px solid',
                borderColor: 'border',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                minH: 0,
            })}
        >
            <div
                className={css({
                    padding: '10px 12px',
                    fontSize: '11px',
                    fontWeight: '700',
                    color: 'textMuted',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    borderBottom: '1px solid',
                    borderColor: 'border',
                    flexShrink: 0,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                })}
            >
                <span>アセット</span>
                {loading && <span className={css({ color: 'textSubtle', fontWeight: '500' })}>読み込み中...</span>}
            </div>
            <div
                className={css({
                    flex: 1,
                    overflowY: 'hidden',
                    overflowX: 'auto',
                    padding: '8px 12px',
                    display: 'flex',
                    gap: '8px',
                    minH: 0,
                })}
            >
                {kinds.length === 0 ? (
                    <div className={css({ fontSize: '12px', color: 'textSubtle', alignSelf: 'center' })}>
                        {loading
                            ? ''
                            : '「ワールド情報」モーダルの「使用するプラグイン」からプラグインを追加してください'}
                    </div>
                ) : (
                    kinds.map((k) => {
                        const disabled = !!k.singleton && placedKinds.has(k.kind);
                        return (
                            <button
                                key={k.kind}
                                type="button"
                                disabled={disabled}
                                onClick={() => onAdd(k)}
                                title={disabled ? 'singleton: 既に配置済み' : `+ ${k.kind}`}
                                className={css({
                                    flexShrink: 0,
                                    width: '140px',
                                    p: '10px',
                                    bg: 'background',
                                    border: '1px solid',
                                    borderColor: 'border',
                                    borderRadius: '8px',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px',
                                    _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                                    _hover: { borderColor: 'primary' },
                                })}
                            >
                                <div
                                    className={css({
                                        fontSize: '10px',
                                        color: 'textSubtle',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em',
                                    })}
                                >
                                    {k.pluginName}
                                </div>
                                <div className={css({ fontSize: '13px', fontWeight: '600', color: 'text' })}>
                                    {k.kind.split(':').slice(1).join(':') || k.kind}
                                </div>
                                {k.singleton && (
                                    <div className={css({ fontSize: '10px', color: 'textSubtle' })}>singleton</div>
                                )}
                            </button>
                        );
                    })
                )}
            </div>
        </section>
    );
}
