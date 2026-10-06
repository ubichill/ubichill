import type { Friendship, UserWithFriendship } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { searchUsers } from '@/lib/socialApi';
import { css } from '@/styled-system/css';
import { UserRow } from './UserRow';

const SEARCH_DELAY_MS = 300;

/** ユーザー検索（ID の前方一致・表示名の部分一致）。 */
export function UserSearch({ onFriendshipChange }: { onFriendshipChange?: () => void }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<UserWithFriendship[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const q = query.trim();
        setError(null);
        if (!q) {
            setResults(null);
            return;
        }
        // 検索語が変わったら前の検索の応答は捨てる（応答の順が入れ替わると、今の入力と違う結果が出るため）
        const controller = new AbortController();
        const timer = setTimeout(() => {
            searchUsers(q, controller.signal)
                .then((users) => {
                    if (!controller.signal.aborted) setResults(users);
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
            <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ID か表示名で探す"
                aria-label="ユーザーを検索"
                className={css({
                    width: 'full',
                    px: '3',
                    py: '2',
                    border: '1px solid',
                    borderColor: 'border',
                    borderRadius: '10px',
                    fontSize: '14px',
                    bg: 'background',
                    color: 'text',
                    mb: '3',
                })}
            />
            {error && <p className={css({ fontSize: '13px', color: 'errorText', mb: '2' })}>{error}</p>}
            {results && results.length === 0 && (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>見つかりませんでした。</p>
            )}
            {results && results.length > 0 && (
                <ul className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                    {results.map((u) => (
                        <UserRow key={u.id} user={u} friendship={u.friendship} onChange={(f) => update(u.id, f)} />
                    ))}
                </ul>
            )}
        </div>
    );
}
