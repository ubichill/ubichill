import type { LoginMethods } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { SoftwareLogo } from '@/components/auth/FediverseBrandIcons';
import { FediverseServerPicker } from '@/components/auth/FediverseServerPicker';
import { requestAdminRecheck } from '@/lib/account/adminStatus';
import { fetchFediverseSignInOptions, removeLoginMethod, startFediverseSignIn } from '@/lib/account/fediverseSignIn';
import { removableLoginMethods } from '@/lib/account/loginMethods';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { EmailLinkForm } from './EmailLinkForm';
import { ReauthForm } from './ReauthForm';
import {
    settingsCard,
    settingsCardTitle,
    settingsNote,
    settingsTextButton,
    settingsWideButton,
} from './settingsStyles';

/**
 * ログイン方法（設定の「アカウント」）。ログイン方法は連携を足すと増える: フェディバースのアカウントは認証して、
 * メールアドレスは届いたコードで確かめて足す。パスワードの入れ直しは求めない（足した・外したことは連絡先に知らせる）。
 * 今の設定で使える手段が残らなくなる解除はできない（サーバーも同じ規則で断る）。
 */
export function LoginMethodsSection({
    methods,
    adminRequiresPassword,
    onChanged,
}: {
    methods: LoginMethods | null;
    adminRequiresPassword: boolean;
    onChanged: () => void;
}) {
    const location = useLocation();
    const [busy, setBusy] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [featuredServers, setFeaturedServers] = useState<readonly string[]>([]);
    useEffect(() => {
        fetchFediverseSignInOptions()
            .then((options) => setFeaturedServers(options.featuredServers))
            .catch(() => undefined);
    }, []);
    if (!methods) return null;
    const returnTo = `${location.pathname}${location.search}`;
    const removable = removableLoginMethods(methods);

    const remove = async (id: string) => {
        setBusy(id);
        try {
            await removeLoginMethod(id);
        } catch (error) {
            pushToast(error instanceof Error ? error.message : '外せませんでした', 'error');
        } finally {
            setBusy(null);
            onChanged();
        }
    };

    const link = async (server: string) => {
        setBusy('start');
        try {
            await startFediverseSignIn({ server, intent: 'link', returnTo });
        } catch (error) {
            pushToast(error instanceof Error ? error.message : '始められませんでした', 'error');
            setBusy(null);
        }
    };

    const emailLinked = () => {
        pushToast('メールアドレスを追加しました。メールアドレスとパスワードでもログインできます', 'info');
        onChanged();
        requestAdminRecheck();
    };

    return (
        <section className={settingsCard}>
            <h2 className={settingsCardTitle}>ログイン方法</h2>
            {adminRequiresPassword && methods.password && (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                    <p className={settingsNote}>
                        このログインでは管理者の操作はできません。パスワードで本人確認をすると使えます。
                    </p>
                    <ReauthForm
                        onDone={() => {
                            onChanged();
                            requestAdminRecheck();
                        }}
                    />
                </div>
            )}
            <ul className={css({ display: 'flex', flexDirection: 'column' })}>
                {methods.password && (
                    <li className={row}>
                        <span className={label}>
                            {methods.email ? (
                                <>
                                    メールアドレス
                                    <span className={detail}>{methods.email}</span>
                                </>
                            ) : (
                                'メールアドレスとパスワード'
                            )}
                        </span>
                    </li>
                )}
                {methods.fediverse.map((account) => (
                    <li key={account.id} className={row}>
                        {account.software && <SoftwareLogo software={account.software} size={18} />}
                        <span className={label}>
                            {account.username ? `@${account.username}@${account.server}` : account.server}
                        </span>
                        {!account.usable && <span className={unusable}>今は使えません</span>}
                        <button
                            type="button"
                            className={removeButton}
                            disabled={!removable.has(account.id) || busy !== null}
                            title={
                                removable.has(account.id) ? undefined : 'ほかに使えるログイン方法が無いため外せません'
                            }
                            onClick={() => void remove(account.id)}
                        >
                            {busy === account.id ? '外しています...' : '外す'}
                        </button>
                    </li>
                ))}
            </ul>

            {adding ? (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                    <FediverseServerPicker
                        featuredServers={featuredServers}
                        busy={busy !== null}
                        confirmLabel="このサーバーのアカウントを追加"
                        onChoose={(host) => void link(host)}
                    />
                    <button
                        type="button"
                        className={settingsTextButton}
                        disabled={busy !== null}
                        onClick={() => setAdding(false)}
                    >
                        やめる
                    </button>
                </div>
            ) : (
                <button type="button" className={settingsWideButton} onClick={() => setAdding(true)}>
                    フェディバースのアカウントを追加
                </button>
            )}

            {!methods.password && (
                <>
                    <p className={settingsNote}>
                        メールアドレスを追加しておくと、使っているサーバーが止まってもログインでき、お知らせもメールで届きます。
                    </p>
                    <EmailLinkForm methods={methods} onLinked={emailLinked} onReauthenticated={onChanged} />
                </>
            )}
        </section>
    );
}

const row = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    py: '2',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'border',
});

const label = css({
    display: 'flex',
    flexDirection: 'column',
    fontSize: '14px',
    color: 'text',
    overflowWrap: 'anywhere',
    mr: 'auto',
});

const detail = css({ fontSize: '12px', color: 'textMuted' });

const unusable = css({ fontSize: '12px', color: 'textMuted', flexShrink: 0 });

const removeButton = css({
    flexShrink: 0,
    px: '3',
    py: '1',
    fontSize: '12px',
    fontWeight: '700',
    color: 'text',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover' },
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});
