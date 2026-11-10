import type { Friendship, UserWithFriendship } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { searchUsers } from '@/lib/social/socialApi';
import { css } from '@/styled-system/css';
import { UserRow } from './UserRow';

const SEARCH_DELAY_MS = 300;

/** ユーザー検索（ID の前方一致・表示名の部分一致・`@ID@サーバー` の指定）。 */
export function UserSearch({ onFriendshipChange }: { onFriendshipChange?: () => void }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<UserWithFriendship[] | null>(null);
    /** ほかのサーバーのアカウントを指定したが、見つからなかった（そのサーバーが答えない・ubichill でない） */
    const [remoteAccount, setRemoteAccount] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const q = query.trim();
        setError(null);
        if (!q) {
            setResults(null);
            setRemoteAccount(null);
            return;
        }
        // 検索語が変わったら前の検索の応答は捨てる（応答の順が入れ替わると、今の入力と違う結果が出るため）
        const controller = new AbortController();
        const timer = setTimeout(() => {
            searchUsers(q, controller.signal)
                .then((response) => {
                    if (controller.signal.aborted) return;
                    setResults(response.users);
                    setRemoteAccount(response.users.length === 0 ? (response.remoteAccount ?? null) : null);
                })
                .catch((e: unknown) => {
                    if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '検索できませんでした');
                });
        }, SEARCH_DELAY_MS);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    const update = (id: string, friendship: Friendship) => {
        setResults((prev) => prev?.map((u) => (u.id === id ? { ...u, friendship } : u)) ?? null);
        onFriendshipChange?.();
    };

    return (
        <div>
            <label className={searchField}>
                <HudIcon name="search" size={18} />
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="名前・ID で探す"
                    aria-label="ユーザーを探す"
                    className={searchInput}
                />
            </label>
            {error && <p className={css({ fontSize: '13px', color: 'errorText', mt: '2' })}>{error}</p>}
            {remoteAccount && (
                <p className={css({ fontSize: '13px', color: 'textMuted', mt: '2' })}>
                    @{remoteAccount} が見つかりませんでした。サーバーとつながらないか、ubichill
                    のアカウントではありません。
                </p>
            )}
            {!remoteAccount && results && results.length === 0 && (
                <p className={css({ fontSize: '13px', color: 'textMuted', mt: '2', px: '2' })}>見つかりませんでした</p>
            )}
            {results && results.length > 0 && (
                <ul className={css({ display: 'flex', flexDirection: 'column', gap: '1', mt: '2' })}>
                    {results.map((u) => (
                        <UserRow key={u.id} user={u} friendship={u.friendship} onChange={(f) => update(u.id, f)} />
                    ))}
                </ul>
            )}
        </div>
    );
}

const searchField = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    px: '3',
    h: '42px',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'transparent',
    borderRadius: '10px',
    color: 'textMuted',
    transition: 'border-color 0.16s ease',
    _focusWithin: { borderColor: 'primary' },
});

const searchInput = css({
    flex: 1,
    minW: 0,
    h: 'full',
    bg: 'transparent',
    border: 'none',
    outline: 'none',
    fontSize: '14px',
    color: 'text',
    _placeholder: { color: 'textSubtle' },
});
