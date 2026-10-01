import { css } from '@/styled-system/css';

const item = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    px: '3',
    py: '2',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    bg: 'surface',
    fontSize: '12px',
});

/**
 * 表示できないお気に入り（取得できない・作者を確認できない）。黙って消えたように見せず、本人が整理できるようにする。
 */
export function UnavailableFavorites({ refs, onRemove }: { refs: readonly string[]; onRemove: (ref: string) => void }) {
    return (
        <section className={css({ mt: '6' })}>
            <h3 className={css({ fontSize: '13px', fontWeight: '700', color: 'text', mb: '1' })}>
                表示できないお気に入り（{refs.length}）
            </h3>
            <p className={css({ fontSize: '12px', color: 'textMuted', mb: '2', lineHeight: '1.6' })}>
                取得できないか、作者を確認できないワールドです。配信元が戻る・署名し直されると再び表示されます。
            </p>
            <ul className={css({ display: 'flex', flexDirection: 'column', gap: '1.5' })}>
                {refs.map((ref) => (
                    <li key={ref} className={item}>
                        <span
                            title={ref}
                            className={css({
                                flex: 1,
                                minWidth: 0,
                                color: 'textMuted',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            })}
                        >
                            {ref}
                        </span>
                        <button
                            type="button"
                            onClick={() => onRemove(ref)}
                            className={css({
                                flexShrink: 0,
                                px: '2',
                                py: '1',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: '6px',
                                bg: 'surface',
                                color: 'errorText',
                                cursor: 'pointer',
                                _hover: { bg: 'errorBg' },
                            })}
                        >
                            お気に入りから外す
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
