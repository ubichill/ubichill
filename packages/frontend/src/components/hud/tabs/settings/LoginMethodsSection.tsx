import type { LoginMethods } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { SoftwareLogo } from '@/components/auth/FediverseBrandIcons';
import { FediverseServerPicker } from '@/components/auth/FediverseServerPicker';
import { requestAdminRecheck } from '@/lib/account/adminStatus';
import { fetchFediverseSignInOptions, removeLoginMethod, startFediverseSignIn } from '@/lib/account/fediverseSignIn';
import { needsReauthentication, removableLoginMethods } from '@/lib/account/loginMethods';
import { isReauthRequired } from '@/lib/apiError';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { settingsPath } from '../../settingsLink';
import { EmailLinkForm } from './EmailLinkForm';
import { ReauthForm } from './ReauthForm';
import { ReauthPrompt } from './ReauthPrompt';
import {
    settingsCard,
    settingsCardTitle,
    settingsNote,
    settingsTextButton,
    settingsWideButton,
} from './settingsStyles';

/**
 * ログイン方法（設定の「アカウント」）。ログイン方法は連携を足すと増える: フェディバースのアカウントは認証して、
 * メールアドレスは届いたコードで確かめて足す。足す・外すには直近の本人確認が要る（奪った古いセッションで攻撃者の
 * ログイン手段を足させない・本人の手段を外させない）。足した・外したことは連絡先にも知らせる。
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
    /** 足す・外すを押したが、先に直近の本人確認が要る */
    const [reauthing, setReauthing] = useState(false);
    const [reauthRefused, setReauthRefused] = useState(false);
    const [featuredServers, setFeaturedServers] = useState<readonly string[]>([]);
    useEffect(() => {
        fetchFediverseSignInOptions()
            .then((options) => setFeaturedServers(options.featuredServers))
            .catch(() => undefined);
    }, []);
    if (!methods) return null;
    const returnTo = `${location.pathname}${location.search}`;
    const removable = removableLoginMethods(methods);
    const reauthNeeded = needsReauthentication(methods, reauthRefused);

    /** サーバーに直近の本人確認を求められた（画面を開いたまま 10 分を過ぎた）なら本人確認へ。ほかの失敗は知らせる */
    const failed = (error: unknown, fallback: string) => {
        if (!isReauthRequired(error)) {
            pushToast(error instanceof Error ? error.message : fallback, 'error');
            return;
        }
        setReauthRefused(true);
        setAdding(false);
        setReauthing(true);
    };

    const remove = async (id: string) => {
        if (reauthNeeded) {
            setReauthing(true);
            return;
        }
        setBusy(id);
        try {
            await removeLoginMethod(id);
        } catch (error) {
            failed(error, '外せませんでした');
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
            failed(error, '始められませんでした');
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

            {reauthing && reauthNeeded ? (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                    <ReauthPrompt
                        methods={methods}
                        action="ログイン方法の変更"
                        returnTo={settingsPath('account')}
                        onDone={() => {
                            setReauthRefused(false);
                            setReauthing(false);
                            onChanged();
                        }}
                    />
                    <button type="button" className={settingsTextButton} onClick={() => setReauthing(false)}>
                        やめる
                    </button>
                </div>
            ) : adding ? (
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
                <button
                    type="button"
                    className={settingsWideButton}
                    onClick={() => (reauthNeeded ? setReauthing(true) : setAdding(true))}
                >
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
