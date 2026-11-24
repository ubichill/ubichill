import {
    DEFAULT_SERVER_DESCRIPTION,
    DEFAULT_SERVER_INFO,
    type ServerInfo,
    safeReturnTo,
    UBICHILL_REPOSITORY_URL,
    type WorldListItem,
    worldPagePath,
} from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { dividerStyle, linkButtonStyle } from '@/components/auth/authStyles';
import { FediverseSignInPanel } from '@/components/auth/FediverseSignInPanel';
import { FediverseSignUpForm } from '@/components/auth/FediverseSignUpForm';
import { PasswordAuthForm } from '@/components/auth/PasswordAuthForm';
import { TwoFactorSignInForm } from '@/components/auth/TwoFactorSignInForm';
import { Dialog } from '@/components/ui/Dialog';
import { type AuthDialog, type AuthEntry, withAuthDialog } from '@/lib/account/authEntry';
import {
    cancelFediverseSignUp,
    type FediverseSignInOptions,
    fetchFediverseSignInOptions,
} from '@/lib/account/fediverseSignIn';
import { fetchLocalWorlds, loadServerOverview, useServerOverview } from '@/lib/server/serverInfo';
import { css, cva, cx } from '@/styled-system/css';

/** 並べるワールドの数（多いサーバーでも紹介のページを長くしない） */
const SHOWCASE_WORLDS = 12;

const DIALOG_TITLES: Readonly<Record<AuthDialog, string>> = {
    login: 'ログイン',
    register: '新規登録',
    'two-factor': '二段階認証',
    'fediverse-sign-up': 'はじめまして',
};

const FEDIVERSE_OFF: FediverseSignInOptions = { enabled: false, registrationOpen: false, featuredServers: [] };

/**
 * `/` をログインしていない人が開いたときの、サーバーの紹介とログインの入り口。サーバーの名前と紹介（コントロールパネルの「全般」）、
 * Mastodon・Misskey のアカウントでのログイン、このサーバーのワールド、運営の情報を出す。
 * メールアドレス（ID）とパスワードでのログイン・新規登録と、その続き（二段階目・フェディバースでの登録）は、この上のダイアログで開く。
 */
export function VisitorPage({ entry }: { entry: AuthEntry }) {
    const navigate = useNavigate();
    const location = useLocation();
    // null は読み込み中（届くまで見えなくしておき、既定の名前から切り替わって見えないようにする）。
    // 読めなければ 'failed'（分からない人数・登録の受け付けは出さない）
    const overview = useServerOverview();
    const [worlds, setWorlds] = useState<WorldListItem[] | null>(null);
    const [fediverse, setFediverse] = useState<FediverseSignInOptions | null>(null);
    // 二段階目の期限が切れてログインからやり直すときの理由
    const [restartMessage, setRestartMessage] = useState('');

    useEffect(() => {
        void loadServerOverview();
        fetchLocalWorlds()
            .then(setWorlds)
            .catch(() => setWorlds([]));
        fetchFediverseSignInOptions()
            .then(setFediverse)
            .catch(() => setFediverse(FEDIVERSE_OFF));
    }, []);

    const loaded = overview !== null && overview !== 'failed' ? overview : null;
    const info = loaded?.info ?? DEFAULT_SERVER_INFO;
    const banner = loaded?.branding?.banner ?? null;
    // 新規登録を受け付けているか（読めなければ受け付けている扱い。止めていれば登録の応答が理由を返す）
    const registrationOpen = overview === 'failed' || loaded?.registrationOpen !== false;
    const pending = overview === null || fediverse === null;
    const returnTo = entry.next ?? '/';

    // 開いているダイアログは URL に残す（読み込み直しても同じものを開く）
    const showDialog = useCallback(
        (dialog: AuthDialog | null) =>
            navigate(
                { pathname: '/', search: withAuthDialog(location.search, dialog), hash: location.hash },
                { replace: true },
            ),
        [navigate, location.search, location.hash],
    );

    // 新規登録を止めているサーバーで ?mode=register を開いたら、ログインにする
    useEffect(() => {
        if (!registrationOpen && entry.dialog === 'register') showDialog('login');
    }, [registrationOpen, entry.dialog, showDialog]);

    useEffect(() => {
        if (!loaded) return;
        const previous = document.title;
        document.title = loaded.info.name;
        return () => {
            document.title = previous;
        };
    }, [loaded]);

    const closeDialog = () => {
        setRestartMessage('');
        // フェディバースでの登録をやめたら、途中の状態を消す（共用の端末で、別の人が続きから登録できないように）
        if (entry.dialog === 'fediverse-sign-up') void cancelFediverseSignUp().finally(() => showDialog(null));
        else showDialog(null);
    };

    return (
        <>
            <main className={page} inert={entry.dialog !== null}>
                <div className={cx(layout, pending && hidden)} aria-busy={pending}>
                    <section className={hero} aria-labelledby="server-name">
                        {banner && <img src={banner} alt="" width={1200} height={630} className={bannerImage} />}
                        <div className={heroBody}>
                            <img
                                src={loaded?.branding?.icon?.icon192 ?? '/icon.png'}
                                alt=""
                                width={72}
                                height={72}
                                className={icon({ overBanner: !!banner })}
                            />
                            <h1 id="server-name" className={name}>
                                {info.name}
                            </h1>
                            <p className={description}>{info.description ?? DEFAULT_SERVER_DESCRIPTION}</p>
                            {entry.adding && <p className={note}>追加するアカウントでログインしてください</p>}
                            <div className={actions}>
                                {loaded?.registrationOpen && (
                                    <button
                                        type="button"
                                        className={primaryAction}
                                        onClick={() => showDialog('register')}
                                    >
                                        新規登録
                                    </button>
                                )}
                                <button type="button" className={secondaryAction} onClick={() => showDialog('login')}>
                                    ログイン
                                </button>
                            </div>
                            {loaded?.registrationOpen === false && (
                                <p className={note}>いまは新規登録を受け付けていません。</p>
                            )}
                            {fediverse?.enabled && (
                                <>
                                    <div className={dividerStyle} role="separator">
                                        または
                                    </div>
                                    <FediverseSignInPanel
                                        returnTo={returnTo}
                                        featuredServers={fediverse.featuredServers}
                                    />
                                </>
                            )}
                            {entry.adding && (
                                <button type="button" className={linkButtonStyle} onClick={() => navigate('/')}>
                                    今のアカウントに戻る
                                </button>
                            )}
                            {loaded && (
                                <dl className={stats}>
                                    <div className={stat}>
                                        <dt className={statLabel}>ユーザー</dt>
                                        <dd className={statValue}>{loaded.stats.users.toLocaleString('ja-JP')}</dd>
                                    </div>
                                    <div className={stat}>
                                        <dt className={statLabel}>ワールド</dt>
                                        {/* 一覧が届くまでは 0 と出さない */}
                                        <dd className={statValue}>
                                            {worlds ? worlds.length.toLocaleString('ja-JP') : ''}
                                        </dd>
                                    </div>
                                </dl>
                            )}
                            <ServerFacts info={info} />
                        </div>
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
            <Dialog
                open={entry.dialog !== null}
                title={entry.dialog ? DIALOG_TITLES[entry.dialog] : ''}
                onClose={closeDialog}
                focusKey={entry.dialog ?? undefined}
                closeButton
            >
                {(entry.dialog === 'login' || entry.dialog === 'register') && (
                    <PasswordAuthForm
                        mode={entry.dialog}
                        onModeChange={showDialog}
                        returnTo={returnTo}
                        adding={entry.adding}
                        registrationOpen={registrationOpen}
                        initialError={restartMessage}
                        onTwoFactor={() => showDialog('two-factor')}
                    />
                )}
                {entry.dialog === 'two-factor' && (
                    <TwoFactorSignInForm
                        // セッションを読み直すため、画面ごと移る
                        onSignedIn={(to) => window.location.assign(safeReturnTo(to ?? returnTo))}
                        onRestart={(message) => {
                            setRestartMessage(message ?? '');
                            showDialog('login');
                        }}
                    />
                )}
                {entry.dialog === 'fediverse-sign-up' && <FediverseSignUpForm onCancel={() => showDialog(null)} />}
            </Dialog>
        </>
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
    bg: 'white',
    border: '1px solid',
    borderColor: 'border',
    rounded: 'lg',
    overflow: 'hidden',
});
const bannerImage = css({ display: 'block', w: 'full', h: 'auto', aspectRatio: '1200 / 630', objectFit: 'cover' });
const heroBody = css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4',
    p: { base: '6', sm: '8' },
    textAlign: 'center',
});
const icon = cva({
    base: { borderRadius: '16px', bg: 'white' },
    variants: {
        // バナーの下の端に重ねる（プロフィールのアイコンと同じ置き方）
        overBanner: { true: { mt: { base: '-60px', sm: '-68px' }, border: '4px solid', borderColor: 'white' } },
    },
});
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
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    _focusVisible: { outline: '2px solid token(colors.primary)', outlineOffset: '2px' },
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
