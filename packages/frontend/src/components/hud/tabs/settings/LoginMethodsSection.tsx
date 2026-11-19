import type { LoginMethods } from '@ubichill/shared';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { FediverseAccountInput } from '@/components/auth/FediverseAccountInput';
import { SoftwareLogo } from '@/components/auth/FediverseBrandIcons';
import { requestAdminRecheck } from '@/lib/account/adminStatus';
import { removeLoginMethod, startFediverseSignIn } from '@/lib/account/fediverseSignIn';
import { removableLoginMethods } from '@/lib/account/loginMethods';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { ReauthForm } from './ReauthForm';
import { settingsNote } from './settingsStyles';

/**
 * ログイン方法（設定の「アカウント」）。パスワードの有無と、追加したフェディバースのアカウント。
 * 追加・解除は直近にログインか本人確認をしたときだけ（奪われたログインで手段を足されないように）。
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
    if (!methods) return null;
    const returnTo = `${location.pathname}${location.search}`;
    const removable = removableLoginMethods(methods);

    const reauthenticated = () => {
        onChanged();
        requestAdminRecheck();
    };

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

    const start = async (server: string, intent: 'link' | 'sign-in') => {
        setBusy('start');
        try {
            await startFediverseSignIn({ server, intent, returnTo });
        } catch (error) {
            pushToast(error instanceof Error ? error.message : '始められませんでした', 'error');
            setBusy(null);
        }
    };

    // SSO だけのユーザーは、使える外部アカウントでログインし直して本人確認をする
    const reloginWith = methods.fediverse.find((a) => a.usable);

    return (
        <section className={card}>
            <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text' })}>ログイン方法</h2>
            {adminRequiresPassword && (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                    <p className={settingsNote}>
                        このログインでは管理者の操作はできません。パスワードで本人確認をすると使えます。
                    </p>
                    {methods.password && <ReauthForm onDone={reauthenticated} />}
                </div>
            )}
            <ul className={css({ display: 'flex', flexDirection: 'column' })}>
                {methods.password && (
                    <li className={row}>
                        <span className={label}>メールアドレスとパスワード</span>
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
                            disabled={!removable.has(account.id) || !methods.recentlyAuthenticated || busy !== null}
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
            {!methods.password && (
                <p className={settingsNote}>
                    メールアドレスが無いため、ログインに使うサーバーが使えなくなると入れなくなります。別のサーバーのアカウントも追加しておくと安心です。
                </p>
            )}

            {methods.recentlyAuthenticated ? (
                <FediverseAccountInput
                    actions={(preview) => (
                        <button
                            type="button"
                            className={addButton}
                            disabled={busy !== null}
                            onClick={() => void start(preview.server.host, 'link')}
                        >
                            このアカウントを追加
                        </button>
                    )}
                />
            ) : methods.password ? (
                // 管理者の案内で本人確認の欄を出しているときは重ねない
                !adminRequiresPassword && (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                        <p className={settingsNote}>ログイン方法を変えるには、パスワードで本人確認をしてください。</p>
                        <ReauthForm onDone={reauthenticated} />
                    </div>
                )
            ) : (
                reloginWith && (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                        <p className={settingsNote}>
                            ログイン方法を変えるには、もう一度ログインして本人確認をしてください。
                        </p>
                        <button
                            type="button"
                            className={addButton}
                            disabled={busy !== null}
                            onClick={() => void start(reloginWith.server, 'sign-in')}
                        >
                            {reloginWith.software && <SoftwareLogo software={reloginWith.software} size={16} />}
                            {reloginWith.username
                                ? `@${reloginWith.username}@${reloginWith.server} でログインし直す`
                                : `${reloginWith.server} でログインし直す`}
                        </button>
                    </div>
                )
            )}
        </section>
    );
}

const card = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '3',
    p: '4',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '12px',
});

const row = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    py: '2',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'border',
});

const label = css({ fontSize: '14px', color: 'text', overflowWrap: 'anywhere', mr: 'auto' });

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

const addButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2',
    w: 'full',
    minH: '40px',
    px: '4',
    fontSize: '13px',
    fontWeight: '700',
    color: 'textOnPrimary',
    bg: 'primary',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
});
