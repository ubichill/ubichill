import { Link } from 'react-router';
import type { ResignCandidate, ResignTarget } from '@/lib/account/resign';
import { css, cva } from '@/styled-system/css';

const box = cva({
    base: { fontSize: '13px', px: '3', py: '3', borderRadius: '8px', mb: '3', lineHeight: '1.6' },
    variants: {
        tone: {
            info: { color: 'text', bg: 'surfaceAccent' },
            warn: { color: 'errorText', bg: 'errorBg' },
        },
    },
});

const smallButton = cva({
    base: {
        px: '3',
        py: '1',
        border: '1px solid',
        borderRadius: '8px',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        _disabled: { opacity: 0.4, cursor: 'not-allowed' },
    },
    variants: {
        tone: {
            primary: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary' },
            secondary: { bg: 'surface', color: 'text', borderColor: 'border', _hover: { bg: 'surfaceHover' } },
        },
    },
});

const formatDateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('ja-JP') : '不明');

function TargetRow<W extends ResignCandidate>({
    target,
    children,
}: {
    target: ResignTarget<W>;
    children?: React.ReactNode;
}) {
    return (
        <li
            className={css({
                display: 'flex',
                alignItems: 'center',
                gap: '3',
                py: '2',
                borderTop: '1px solid',
                borderColor: 'border',
                flexWrap: 'wrap',
            })}
        >
            <div className={css({ flex: 1, minWidth: '200px' })}>
                <p className={css({ fontWeight: '600' })}>{target.world.displayName}</p>
                <p className={css({ fontSize: '12px', color: 'textMuted' })}>
                    署名した環境「{target.signedBy.name}」・ 最終更新 {formatDateTime(target.world.updatedAt)}
                </p>
            </div>
            {children}
        </li>
    );
}

interface ResignPanelProps<W extends ResignCandidate> {
    bulk: ResignTarget<W>[];
    review: ResignTarget<W>[];
    busy: boolean;
    onResignAll: () => void;
    onResignOne: (target: ResignTarget<W>) => void;
}

/**
 * 取り消した鍵で署名したワールドの署名し直し。
 * 紛失で取り消した鍵の分はまとめて署名し直せる。漏えい・心当たりのない環境の分は、攻撃者が書き換えた内容に
 * 本人の鍵で署名してしまわないよう、内容を確かめてから 1 つずつ署名し直させる。
 */
export function ResignPanel<W extends ResignCandidate>({
    bulk,
    review,
    busy,
    onResignAll,
    onResignOne,
}: ResignPanelProps<W>) {
    if (bulk.length === 0 && review.length === 0) return null;
    return (
        <>
            {review.length > 0 && (
                <div className={box({ tone: 'warn' })}>
                    <p className={css({ fontWeight: '700' })}>
                        漏えい・心当たりのない環境で署名されたワールド（{review.length}）
                    </p>
                    <p>
                        攻撃者が内容を書き換えた可能性があります。エディタで中身を確かめ、問題がなければ 1
                        つずつ署名し直してください。心当たりのない変更があれば、直してから「公開する」で公開してください。
                    </p>
                    <ul className={css({ mt: '2' })}>
                        {review.map((t) => (
                            <TargetRow key={t.world.id} target={t}>
                                <Link to={`/world/${t.world.id}/edit`} className={smallButton({ tone: 'secondary' })}>
                                    中身を確かめる
                                </Link>
                                <button
                                    type="button"
                                    className={smallButton({ tone: 'secondary' })}
                                    disabled={busy}
                                    onClick={() => onResignOne(t)}
                                >
                                    確かめたので署名し直す
                                </button>
                            </TargetRow>
                        ))}
                    </ul>
                </div>
            )}
            {bulk.length > 0 && (
                <div className={box({ tone: 'info' })}>
                    <p className={css({ fontWeight: '700' })}>紛失で取り消した鍵で署名したワールド（{bulk.length}）</p>
                    <p>作者が外れて一覧に出ていません。このブラウザで署名し直すと元に戻ります。</p>
                    <ul className={css({ my: '2' })}>
                        {bulk.map((t) => (
                            <TargetRow key={t.world.id} target={t} />
                        ))}
                    </ul>
                    <button
                        type="button"
                        className={smallButton({ tone: 'primary' })}
                        disabled={busy}
                        onClick={onResignAll}
                    >
                        まとめて署名し直す
                    </button>
                </div>
            )}
            <p className={css({ fontSize: '12px', color: 'textMuted', mb: '3' })}>
                GitHub など外部に置いたワールドは、CLI で署名し直して署名ファイルを置き直してください。
            </p>
        </>
    );
}
