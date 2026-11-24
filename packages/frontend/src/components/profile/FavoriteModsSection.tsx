import { type PackageDescriptor, packagePagePath, parseAuthorAccount } from '@ubichill/shared';
import { Link } from 'react-router';
import { ModThumbnail } from '@/components/mods/ModThumbnail';
import { useModPreview } from '@/components/mods/useModPreview';
import { css } from '@/styled-system/css';

const card = css({
    display: 'flex',
    alignItems: 'center',
    gap: '3',
    p: '3',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '12px',
    color: 'text',
    textDecoration: 'none',
    minWidth: 0,
    _hover: { borderColor: 'borderStrong' },
    _focusVisible: { outline: '2px solid', outlineColor: 'primary' },
});

/** 作品ページ。このサーバーの作者ならここの、ほかのサーバーの作者なら作者のサーバーのページ。 */
function pageOf(mod: PackageDescriptor): { local: boolean; href: string } | undefined {
    const account = parseAuthorAccount(mod.author);
    if (!account) return undefined;
    const path = packagePagePath(account.handle, mod.id);
    return account.domain === window.location.host
        ? { local: true, href: path }
        : { local: false, href: `https://${account.domain}${path}` };
}

function FavoriteModCard({ mod }: { mod: PackageDescriptor }) {
    const preview = useModPreview({ id: mod.id, version: mod.version, baseUrl: mod.baseUrl });
    const page = pageOf(mod);
    const body = (
        <>
            <ModThumbnail image={preview?.thumbnail} size={40} />
            <span className={css({ minWidth: 0, display: 'flex', flexDirection: 'column' })}>
                <span className={css({ fontSize: '14px', fontWeight: '700', overflowWrap: 'anywhere' })}>
                    {preview?.name ?? mod.id}
                </span>
                <span className={css({ fontSize: '11px', color: 'textSubtle', overflowWrap: 'anywhere' })}>
                    @{mod.author} · v{mod.version}
                </span>
            </span>
        </>
    );
    if (!page) return <div className={card}>{body}</div>;
    return page.local ? (
        <Link to={page.href} className={card}>
            {body}
        </Link>
    ) : (
        <a href={page.href} target="_blank" rel="noreferrer" className={card}>
            {body}
        </a>
    );
}

/** ユーザーのお気に入りの mod。公開範囲はワールドのお気に入りと同じ（見てよい人にだけ届く）。 */
export function FavoriteModsSection({ mods }: { mods: PackageDescriptor[] }) {
    return (
        <section className={css({ mt: '8' })}>
            <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '3' })}>
                お気に入りの mod
                <span className={css({ ml: '2', fontSize: '13px', fontWeight: '500', color: 'textMuted' })}>
                    {mods.length}
                </span>
            </h2>
            <div
                className={css({
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
                    gap: '3',
                })}
            >
                {mods.map((mod) => (
                    <FavoriteModCard key={`${mod.author}/${mod.id}`} mod={mod} />
                ))}
            </div>
        </section>
    );
}
