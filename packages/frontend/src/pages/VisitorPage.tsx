import {
    DEFAULT_SERVER_DESCRIPTION,
    DEFAULT_SERVER_INFO,
    type ServerInfo,
    type ServerOverview,
    UBICHILL_REPOSITORY_URL,
    type WorldListItem,
    worldPagePath,
} from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fetchLocalWorlds, fetchServerOverview } from '@/lib/server/serverInfo';
import { css, cx } from '@/styled-system/css';

/** 並べるワールドの数（多いサーバーでも紹介のページを長くしない） */
const SHOWCASE_WORLDS = 12;

/**
 * `/` をログインしていない人が開いたときの、サーバーの紹介。サーバーの名前と紹介（コントロールパネルの「全般」）、
 * 新規登録とログイン、このサーバーのワールド、運営の情報を出す。
 */
export function VisitorPage() {
    // null は読み込み中（届くまで見えなくしておき、既定の名前から切り替わって見えないようにする）
    const [overview, setOverview] = useState<ServerOverview | null>(null);
    const [worlds, setWorlds] = useState<WorldListItem[] | null>(null);

    useEffect(() => {
        fetchServerOverview()
            .then(setOverview)
            .catch(() => setOverview({ info: DEFAULT_SERVER_INFO, registrationOpen: true, stats: { users: 0 } }));
        fetchLocalWorlds()
            .then(setWorlds)
            .catch(() => setWorlds([]));
    }, []);

    useEffect(() => {
        if (overview) document.title = overview.info.name;
    }, [overview]);

    const info = overview?.info ?? DEFAULT_SERVER_INFO;
    const pending = overview === null;

    return (
        <main className={page}>
            <div className={cx(layout, pending && hidden)} aria-busy={pending}>
                <section className={hero} aria-labelledby="server-name">
                    <img src="/icon.png" alt="" width={72} height={72} className={icon} />
                    <h1 id="server-name" className={name}>
                        {info.name}
                    </h1>
                    <p className={description}>{info.description ?? DEFAULT_SERVER_DESCRIPTION}</p>
                    <div className={actions}>
                        {overview?.registrationOpen !== false && (
                            <Link to="/auth?mode=register" className={primaryAction}>
                                新規登録
                            </Link>
                        )}
                        <Link to="/auth" className={secondaryAction}>
                            ログイン
                        </Link>
                    </div>
                    {overview?.registrationOpen === false && (
                        <p className={note}>いまは新規登録を受け付けていません。</p>
                    )}
                    <dl className={stats}>
                        <div className={stat}>
                            <dt className={statLabel}>ユーザー</dt>
                            <dd className={statValue}>{(overview?.stats.users ?? 0).toLocaleString('ja-JP')}</dd>
                        </div>
                        <div className={stat}>
                            <dt className={statLabel}>ワールド</dt>
                            <dd className={statValue}>{(worlds?.length ?? 0).toLocaleString('ja-JP')}</dd>
                        </div>
                    </dl>
                    <ServerFacts info={info} />
                </section>

                {worlds && worlds.length > 0 && (
                    <section className={showcase} aria-labelledby="worlds-heading">
                        <h2 id="worlds-heading" className={sectionHeading}>
                            ワールド
                        </h2>
                        <ul className={worldGrid}>
                            {worlds.slice(0, SHOWCASE_WORLDS).map((world) => (
                                <li key={world.url}>
                                    <WorldCard world={world} />
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>
        </main>
    );
}

function WorldCard({ world }: { world: WorldListItem }) {
    return (
        <Link to={worldPagePath(world)} className={card}>
            {/* 画像の無いワールドは、空の枠を出さない */}
            {world.thumbnail && (
                <div className={thumbnailBox}>
                    <img src={world.thumbnail} alt="" loading="lazy" className={thumbnail} />
                </div>
            )}
            <div className={cardBody}>
                <span className={cardTitle}>{world.displayName}</span>
                {world.authorName && <span className={cardMeta}>{world.authorName}</span>}
                {world.description && <span className={cardDescription}>{world.description}</span>}
            </div>
        </Link>
    );
}

/** 運営の情報（入れたものだけ並べる）。ソースコードは書いていなければ Ubichill のものを出す */
function ServerFacts({ info }: { info: ServerInfo }) {
    const links = [
        { label: '利用規約', url: info.tosUrl },
        { label: 'プライバシーポリシー', url: info.privacyPolicyUrl },
        { label: '問い合わせ', url: info.inquiryUrl },
        { label: '運営者情報', url: info.impressumUrl },
        { label: 'ソースコード', url: info.repositoryUrl ?? UBICHILL_REPOSITORY_URL },
    ].filter((link): link is { label: string; url: string } => link.url !== null);

    return (
        <footer className={facts}>
            {(info.maintainerName || info.maintainerEmail) && (
                <p>
                    管理者:{' '}
                    {info.maintainerEmail ? (
                        <a className={factLink} href={`mailto:${info.maintainerEmail}`}>
                            {info.maintainerName ?? info.maintainerEmail}
                        </a>
                    ) : (
                        info.maintainerName
                    )}
                </p>
            )}
            <ul className={factLinks}>
                {links.map((link) => (
                    <li key={link.label}>
                        <a className={factLink} href={link.url} target="_blank" rel="noreferrer">
                            {link.label}
                        </a>
                    </li>
                ))}
            </ul>
        </footer>
    );
}

const page = css({ minH: '100dvh', bg: 'background', px: { base: '4', sm: '6' }, py: { base: '6', lg: '12' } });
const hidden = css({ visibility: 'hidden' });
const layout = css({
    maxW: '1120px',
    mx: 'auto',
    display: 'grid',
    gridTemplateColumns: { base: '1fr', lg: '380px 1fr' },
    gap: { base: '6', lg: '10' },
    alignItems: 'start',
});
const hero = css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4',
    p: { base: '6', sm: '8' },
    bg: 'white',
    border: '1px solid',
    borderColor: 'border',
    rounded: 'lg',
    textAlign: 'center',
    position: { lg: 'sticky' },
    top: { lg: '12' },
});
const icon = css({ borderRadius: '16px' });
const name = css({
    fontSize: { base: '2xl', sm: '3xl' },
    fontWeight: 'bold',
    color: 'text',
    lineHeight: '1.3',
    wordBreak: 'auto-phrase',
    overflowWrap: 'anywhere',
});
const description = css({
    fontSize: 'sm',
    color: 'textMuted',
    lineHeight: '1.8',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
});
const actions = css({ display: 'flex', flexDirection: 'column', gap: '2', w: 'full' });
const actionBase = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minH: '44px',
    px: '4',
    fontSize: 'sm',
    fontWeight: 'medium',
    rounded: 'lg',
    transition: 'background-color 0.2s',
} as const;
const primaryAction = css({
    ...actionBase,
    color: 'textOnPrimary',
    bg: 'primaryHover',
    _hover: { bg: 'primaryActive' },
});
const secondaryAction = css({
    ...actionBase,
    color: 'text',
    bg: 'white',
    border: '1px solid',
    borderColor: 'border',
    _hover: { bg: 'surfaceHover' },
});
const note = css({ fontSize: '13px', color: 'textMuted' });
const stats = css({
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    w: 'full',
    borderTopWidth: '1px',
    borderBottomWidth: '1px',
    borderColor: 'border',
    py: '3',
});
const stat = css({ display: 'flex', flexDirection: 'column', gap: '0.5' });
const statLabel = css({ fontSize: '12px', color: 'textMuted' });
const statValue = css({ fontSize: 'xl', fontWeight: 'bold', color: 'text', fontVariantNumeric: 'tabular-nums' });
const facts = css({ display: 'flex', flexDirection: 'column', gap: '2', fontSize: '13px', color: 'textMuted' });
const factLinks = css({ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '3', rowGap: '1' });
const factLink = css({ color: 'textMuted', textDecoration: 'underline', _hover: { color: 'text' } });
const showcase = css({ display: 'flex', flexDirection: 'column', gap: '4', minW: 0 });
const sectionHeading = css({ fontSize: 'lg', fontWeight: 'bold', color: 'text' });
const worldGrid = css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '4',
});
const card = css({
    display: 'flex',
    flexDirection: 'column',
    h: 'full',
    bg: 'white',
    border: '1px solid',
    borderColor: 'border',
    rounded: 'lg',
    overflow: 'hidden',
    transition: 'border-color 0.2s',
    _hover: { borderColor: 'borderStrong' },
});
const thumbnailBox = css({ aspectRatio: '16 / 9', bg: 'surface' });
const thumbnail = css({ w: 'full', h: 'full', objectFit: 'cover' });
const cardBody = css({ display: 'flex', flexDirection: 'column', gap: '0.5', p: '3', minW: 0 });
const cardTitle = css({ fontSize: 'sm', fontWeight: 'bold', color: 'text', overflowWrap: 'anywhere' });
const cardMeta = css({ fontSize: '12px', color: 'textMuted' });
const cardDescription = css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6', lineClamp: 2, mt: '1' });
