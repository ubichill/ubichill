/**
 * 設定の「外部に置いた作品」: `ubichill publish` で署名したときに登録された作品の一覧と削除。
 * ユーザーページには、公開先で本人の署名付きと確かめられたものだけが出る（ここは確認前のものも出す）。
 */
import type { ExternalWork } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { fetchMyExternalWorks, removeMyExternalWork } from '@/lib/externalWorksApi';
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

const removeButton = css({
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
});

export function ExternalWorksSection() {
    const confirm = useConfirm();
    const [works, setWorks] = useState<ExternalWork[] | null>(null);
    const [error, setError] = useState('');

    const load = useCallback(() => {
        fetchMyExternalWorks()
            .then(setWorks)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : '読み込めません'));
    }, []);
    useEffect(load, [load]);

    const remove = async (work: ExternalWork) => {
        if (!(await confirm(`${work.name} をユーザーページから外しますか？（公開先のファイルは消えません）`))) return;
        await removeMyExternalWork(work).catch((e: unknown) => setError(e instanceof Error ? e.message : '消せません'));
        load();
    };

    if (works === null && !error) return null;
    return (
        <section className={css({ mt: '8' })}>
            <h3 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '1' })}>外部に置いた作品</h3>
            <p className={css({ fontSize: '13px', color: 'textMuted', mb: '3', lineHeight: '1.6' })}>
                GitHub Pages などに置いたワールド・mod です。<code>ubichill publish --public-url=…</code>
                で署名すると自動で登録され、公開先で本人の署名付きと確かめられたものがユーザーページに出ます。
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
                                <div className={css({ fontSize: '14px', fontWeight: '600', color: 'text' })}>
                                    {work.name}
                                    {work.version ? ` v${work.version}` : ''}
                                </div>
                                <div className={css({ fontSize: '11px', color: 'textMuted', wordBreak: 'break-all' })}>
                                    {work.url}
                                </div>
                            </div>
                            <button type="button" className={removeButton} onClick={() => void remove(work)}>
                                外す
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
