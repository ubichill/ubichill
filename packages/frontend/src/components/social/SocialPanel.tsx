import type { FriendsResponse, Instance } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { fetchFriends } from '@/lib/socialApi';
import { css } from '@/styled-system/css';
import { FriendLists } from './FriendLists';
import { FriendLocations } from './FriendLocations';
import { UserSearch } from './UserSearch';
import { useFriendLocations } from './useFriendLocations';

const card = css({ bg: 'surfaceAccent', borderRadius: '20px', p: { base: '4', md: '6' }, boxShadow: 'card' });
const heading = css({ fontSize: 'xl', fontWeight: 'bold', color: 'text', mb: '3' });

/**
 * ソーシャル: フレンドの現在地（インスタンスごと）・ユーザー検索・フレンドと申請。
 * ソーシャルページと HUD のフレンドタブで使う（`compact` はフレンドの現在地と申請の件数だけ）。
 */
export function SocialPanel({
    currentInstanceId,
    onJoin,
    compact = false,
    onOpenSocial,
}: {
    currentInstanceId?: string;
    onJoin: (instance: Instance) => void;
    compact?: boolean;
    onOpenSocial?: () => void;
}) {
    const locations = useFriendLocations();
    const [friends, setFriends] = useState<FriendsResponse | null>(null);
    const reloadFriends = useCallback(() => {
        fetchFriends()
            .then(setFriends)
            .catch(() => undefined);
    }, []);
    useEffect(() => {
        reloadFriends();
    }, [reloadFriends]);
    const reloadAll = () => {
        reloadFriends();
        void locations.reload();
    };

    const here = locations.data ? locations.data.locations.reduce((n, l) => n + l.friends.length, 0) : 0;
    const incoming = friends?.incoming.length ?? 0;

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '5' })}>
            <section className={card}>
                <div
                    className={css({
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '3',
                    })}
                >
                    <h2 className={heading}>フレンドの現在地（{here}）</h2>
                    {compact && onOpenSocial && (
                        <button
                            type="button"
                            onClick={onOpenSocial}
                            className={css({
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '2',
                                px: '3',
                                py: '1.5',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: '10px',
                                bg: 'surface',
                                color: 'text',
                                fontSize: '13px',
                                fontWeight: '600',
                                cursor: 'pointer',
                            })}
                        >
                            ソーシャル
                            {incoming > 0 && (
                                <span
                                    className={css({
                                        px: '1.5',
                                        borderRadius: 'full',
                                        bg: 'primary',
                                        color: 'textOnPrimary',
                                        fontSize: '11px',
                                    })}
                                    title="あなたへのフレンド申請"
                                >
                                    {incoming}
                                </span>
                            )}
                        </button>
                    )}
                </div>
                {locations.error && <p className={css({ fontSize: '13px', color: 'errorText' })}>{locations.error}</p>}
                {locations.data ? (
                    <FriendLocations
                        data={locations.data}
                        currentInstanceId={currentInstanceId}
                        onJoin={onJoin}
                        showElsewhere={!compact}
                    />
                ) : (
                    !locations.error && <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>
                )}
            </section>
            {!compact && (
                <>
                    <section className={card}>
                        <h2 className={heading}>ユーザーを探す</h2>
                        <UserSearch onFriendshipChange={reloadAll} />
                    </section>
                    <section className={card}>
                        <h2 className={heading}>フレンド</h2>
                        {friends ? (
                            <FriendLists data={friends} onChange={reloadAll} />
                        ) : (
                            <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
