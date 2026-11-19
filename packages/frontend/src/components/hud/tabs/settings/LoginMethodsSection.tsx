import type { LoginMethods } from '@ubichill/shared';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { FediverseSignInForm } from '@/components/auth/FediverseSignInForm';
import { removeLoginMethod } from '@/lib/account/fediverseSignIn';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { settingsNote } from './settingsStyles';

/**
 * ログイン方法（設定の「アカウント」）。パスワードの有無と、追加したフェディバースのアカウント。
 * 最後のログイン方法は外せない（サーバーも同じ規則で断る）。
 */
export function LoginMethodsSection({ methods, onChanged }: { methods: LoginMethods | null; onChanged: () => void }) {
    const location = useLocation();
    const [removing, setRemoving] = useState<string | null>(null);
    if (!methods) return null;
    const total = methods.fediverse.length + (methods.password ? 1 : 0);

    const remove = async (id: string) => {
        setRemoving(id);
        try {
            await removeLoginMethod(id);
            onChanged();
        } catch (error) {
            pushToast(error instanceof Error ? error.message : '外せませんでした', 'error');
        } finally {
            setRemoving(null);
        }
    };

    return (
        <section className={card}>
            <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text' })}>ログイン方法</h2>
            <ul className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
                {methods.password && (
                    <li className={row}>
                        <span className={label}>メールアドレスとパスワード</span>
                    </li>
                )}
                {methods.fediverse.map((account) => (
                    <li key={account.id} className={row}>
                        <span className={label}>
                            {account.username ? `@${account.username}@${account.server}` : account.server}
                        </span>
                        <button
                            type="button"
                            className={removeButton}
                            disabled={total <= 1 || removing !== null}
                            title={total <= 1 ? 'ほかにログインする方法が無いため外せません' : undefined}
                            onClick={() => void remove(account.id)}
                        >
                            {removing === account.id ? '外しています...' : '外す'}
                        </button>
                    </li>
                ))}
            </ul>
            {!methods.password && (
                <p className={settingsNote}>
                    メールアドレスが無いため、ログインに使うサーバーが使えなくなると入れなくなります。別のサーバーのアカウントも追加しておくと安心です。
                </p>
            )}
            <FediverseSignInForm
                intent="link"
                returnTo={`${location.pathname}${location.search}`}
                submitLabel="フェディバースのアカウントを追加"
            />
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
    justifyContent: 'space-between',
    gap: '3',
    py: '2',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'border',
});

const label = css({ fontSize: '14px', color: 'text', overflowWrap: 'anywhere' });

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
