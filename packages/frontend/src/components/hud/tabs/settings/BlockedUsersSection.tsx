import type { BlockedUser } from '@ubichill/shared';
import { useState } from 'react';
import { socialButton } from '@/components/social/buttons';
import { UserIdentity } from '@/components/social/UserIdentity';
import { useOpenUser } from '@/components/social/useOpenUser';
import { unblockAndReload, useBlocks } from '@/lib/blocks';
import { useSession } from '@/lib/session';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { settingsGroup, settingsHeading, settingsNote } from './settingsStyles';

/** 設定の「プライバシー」の、ブロックした人の一覧（押すとその人のプロフィール、右で解除）。 */
export function BlockedUsersSection() {
    const { data: session } = useSession();
    const owner = session?.user.id;
    const { blocks, error } = useBlocks(owner);
    const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

    const unblock = async (user: BlockedUser) => {
        if (!owner) return;
        setBusyIds((prev) => new Set(prev).add(user.id));
        try {
            await unblockAndReload(owner, user.id);
        } catch (e) {
            pushToast(e instanceof Error ? e.message : '解除できませんでした', 'error');
        } finally {
            setBusyIds((prev) => {
                const next = new Set(prev);
                next.delete(user.id);
                return next;
            });
        }
    };

    return (
        <section className={settingsGroup}>
            <h3 className={settingsHeading}>ブロックした人</h3>
            {error && <p className={css({ fontSize: '13px', color: 'errorText' })}>{error}</p>}
            {blocks &&
                (blocks.length === 0 ? (
                    <p className={settingsNote}>いません。</p>
                ) : (
                    <ul>
                        {blocks.map((user) => (
                            <BlockedRow
                                key={user.id}
                                user={user}
                                busy={busyIds.has(user.id)}
                                onUnblock={() => void unblock(user)}
                            />
                        ))}
                    </ul>
                ))}
        </section>
    );
}

function BlockedRow({ user, busy, onUnblock }: { user: BlockedUser; busy: boolean; onUnblock: () => void }) {
    const openUser = useOpenUser();
    return (
        <li className={css({ display: 'flex', alignItems: 'center', gap: '3', py: '2', opacity: busy ? 0.6 : 1 })}>
            <button type="button" className={who} onClick={() => openUser(user)}>
                <UserIdentity user={user} size="sm" sub={user.account ? `@${user.account}` : user.id} />
            </button>
            <button type="button" className={socialButton({ tone: 'secondary' })} disabled={busy} onClick={onUnblock}>
                解除
            </button>
        </li>
    );
}

const who = css({
    display: 'flex',
    alignItems: 'center',
    gap: '3',
    minW: 0,
    flex: 1,
    p: 0,
    bg: 'transparent',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
    _hover: { opacity: 0.8 },
});
