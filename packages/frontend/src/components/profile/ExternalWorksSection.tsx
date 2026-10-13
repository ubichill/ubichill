/**
 * 設定の「外部に置いた作品」: `ubichill publish` で署名したときに登録された作品の一覧・状態・再確認・削除。
 * ユーザーページには、公開先で本人の署名付きと確かめられたもの（公開済み）だけが出る。
 */
import type { ExternalWork } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { describeExternalWorkStatus, fetchMyExternalWorks, removeMyExternalWork } from '@/lib/externalWorksApi';
import { css } from '@/styled-system/css';

const row = css({
    display: 'flex',
    alignItems: 'center',
    gap: '3',
    p: '3',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '10px',
});

const smallButton = css({
    flexShrink: 0,
    px: '3',
    py: '1',
    borderRadius: '8px',
    border: '1px solid',
    borderColor: 'border',
    bg: 'background',
    color: 'text',
    fontSize: '12px',
    cursor: 'pointer',
    _hover: { borderColor: 'borderStrong' },
    _disabled: { opacity: 0.6, cursor: 'default' },
});

function StatusBadge({ work }: { work: ExternalWork }) {
    const { label, hint, ok } = describeExternalWorkStatus(work.status);
    return (
        <span
            title={`${hint}（確認 ${new Date(work.checkedAt).toLocaleString()}）`}
            className={css({
                flexShrink: 0,
                px: '2',
                py: '0.5',
                borderRadius: '999px',
                fontSize: '10px',
                fontWeight: '700',
                bg: ok ? 'successBg' : 'errorBg',
                color: ok ? 'successText' : 'errorText',
            })}
        >
            {label}
        </span>
    );
}

export function ExternalWorksSection() {
    const confirm = useConfirm();
    const [works, setWorks] = useState<ExternalWork[] | null>(null);
    const [error, setError] = useState('');
    const [checking, setChecking] = useState(false);

    const load = useCallback((refresh: boolean) => {
        setError('');
        setChecking(refresh);
        fetchMyExternalWorks(refresh)
            .then(setWorks)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : '読み込めません'))
            .finally(() => setChecking(false));
    }, []);
    useEffect(() => load(false), [load]);

    const remove = async (work: ExternalWork) => {
        if (!(await confirm(`${work.name} をユーザーページから外しますか？（公開先のファイルは消えません）`))) return;
        await removeMyExternalWork(work).catch((e: unknown) => setError(e instanceof Error ? e.message : '外せません'));
        load(false);
    };

    if (works === null && !error) return null;
    return (
        <section className={css({ mt: '8' })}>
            <div className={css({ display: 'flex', alignItems: 'center', gap: '3', mb: '1' })}>
                <h3 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', flex: 1 })}>外部に置いた作品</h3>
                {works && works.length > 0 && (
                    <button type="button" className={smallButton} disabled={checking} onClick={() => load(true)}>
                        {checking ? '確認中...' : '再確認'}
                    </button>
                )}
            </div>
            <p className={css({ fontSize: '13px', color: 'textMuted', mb: '3', lineHeight: '1.6' })}>
                GitHub Pages などに置いたワールド・mod です。<code>ubichill publish --public-url=…</code>
                で署名すると自動で登録され、公開先で本人の署名付きと確かめられたもの（公開済み）がユーザーページに出ます。
            </p>
            {error && <p className={css({ fontSize: '13px', color: 'errorText', mb: '2' })}>{error}</p>}
            {works?.length === 0 ? (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>まだありません</p>
            ) : (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                    {works?.map((work) => (
                        <div key={`${work.kind} ${work.url} ${work.name}`} className={row}>
                            <span
                                className={css({
                                    flexShrink: 0,
                                    fontSize: '11px',
                                    fontWeight: '700',
                                    color: 'textMuted',
                                    minW: '52px',
                                })}
                            >
                                {work.kind === 'world' ? 'ワールド' : 'mod'}
                            </span>
                            <div className={css({ flex: 1, minW: 0 })}>
                                <div className={css({ display: 'flex', alignItems: 'center', gap: '2' })}>
                                    <span className={css({ fontSize: '14px', fontWeight: '600', color: 'text' })}>
                                        {work.name}
                                        {work.version ? ` v${work.version}` : ''}
                                    </span>
                                    <StatusBadge work={work} />
                                </div>
                                <div className={css({ fontSize: '11px', color: 'textMuted', wordBreak: 'break-all' })}>
                                    {work.url}
                                </div>
                                {work.status !== 'published' && (
                                    <div className={css({ fontSize: '11px', color: 'textMuted', mt: '0.5' })}>
                                        {describeExternalWorkStatus(work.status).hint}
                                    </div>
                                )}
                            </div>
                            <button type="button" className={smallButton} onClick={() => void remove(work)}>
                                外す
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
