import type { FriendsResponse, UserSummary } from '@ubichill/shared';
import { css } from '@/styled-system/css';
import { UserRow } from './UserRow';

const heading = css({ fontSize: '14px', fontWeight: '700', color: 'text', mb: '2', mt: '4', _first: { mt: 0 } });
const list = css({ display: 'flex', flexDirection: 'column', gap: '2' });

function Group({
    title,
    users,
    friendship,
    onChange,
}: {
    title: string;
    users: UserSummary[];
    friendship: 'friends' | 'incoming' | 'outgoing';
    onChange: () => void;
}) {
    if (users.length === 0) return null;
    return (
        <>
            <h3 className={heading}>
                {title}（{users.length}）
            </h3>
            <ul className={list}>
                {users.map((u) => (
                    <UserRow key={u.id} user={u} friendship={friendship} onChange={onChange} />
                ))}
            </ul>
        </>
    );
}

/** 自分への申請・自分の申請・フレンド。操作したら読み直す。 */
export function FriendLists({ data, onChange }: { data: FriendsResponse; onChange: () => void }) {
    const nothing = data.friends.length + data.incoming.length + data.outgoing.length === 0;
    return (
        <div>
            {nothing && (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                    まだフレンドはいません。上の検索から申請できます。
                </p>
            )}
            <Group title="あなたへの申請" users={data.incoming} friendship="incoming" onChange={onChange} />
            <Group title="フレンド" users={data.friends} friendship="friends" onChange={onChange} />
            <Group title="申請中" users={data.outgoing} friendship="outgoing" onChange={onChange} />
        </div>
    );
}
