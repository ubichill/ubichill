import type { ProfileField } from '@ubichill/shared';
import { css } from '@/styled-system/css';
import { profileSectionTitle } from './profileStyles';

const list = css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)',
    columnGap: '4',
    rowGap: '1.5',
    m: 0,
    fontSize: '14px',
    lineHeight: '1.6',
});
const term = css({ color: 'textMuted', fontWeight: '700', overflowWrap: 'anywhere' });
const detail = css({ m: 0, color: 'text', overflowWrap: 'anywhere' });

/** ほかのサーバーの人の項目の表（Mastodon・Misskey の補足情報。リンクにできたものはリンクの欄に出す）。 */
export function ProfileFieldsTable({ fields }: { fields: readonly ProfileField[] | undefined }) {
    if (!fields || fields.length === 0) return null;
    return (
        <section>
            <h2 className={profileSectionTitle}>補足情報</h2>
            <dl className={list}>
                {fields.map((field) => (
                    // 同じ名前と値の組は shared の remoteProfileView で 1 つにしてある
                    <div key={`${field.name}\n${field.value}`} className={css({ display: 'contents' })}>
                        <dt className={term}>{field.name}</dt>
                        <dd className={detail}>{field.value}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
