import {
    INVITE_LIMITS,
    INVITE_REFUSAL_MESSAGES,
    type Instance,
    type InviteCandidate,
    type InviteRefusal,
} from '@ubichill/shared';
import { useEffect, useMemo, useState } from 'react';
import { UserAvatar } from '@/components/social';
import { fetchInviteCandidates, sendInvites } from '@/lib/social/inviteApi';
import { pushToast } from '@/lib/toast';
import { css, cva } from '@/styled-system/css';
import { HudIcon } from '../HudIcon';
import { orderCandidates, toggleInvitee } from '../inviteCandidates';
import { tabPanel } from './shared';

const REFUSAL_LABELS: Record<InviteRefusal, string> = {
    ...INVITE_REFUSAL_MESSAGES,
    'already-inside': 'この部屋にいます',
    'needs-leader': '作った人のフレンドではありません',
};

/**
 * 招待: 今いる部屋にフレンドを招待する（一言を添えられる）。招待のみの部屋でなければ、リンクのコピーも置く。
 */
export function InviteTab({
    instance,
    currentInstanceId,
    onCopyLink,
    onFindFriends,
}: {
    instance: Instance | null;
    currentInstanceId: string;
    onCopyLink: () => void;
    onFindFriends: () => void;
}) {
    const [candidates, setCandidates] = useState<InviteCandidate[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        const ctrl = { cancelled: false };
        fetchInviteCandidates(currentInstanceId)
            .then((res) => !ctrl.cancelled && setCandidates(res.candidates))
            .catch(
                (e: unknown) => !ctrl.cancelled && setError(e instanceof Error ? e.message : '読み込めませんでした'),
            );
        return () => {
            ctrl.cancelled = true;
        };
    }, [currentInstanceId]);

    const ordered = useMemo(() => (candidates ? orderCandidates(candidates) : []), [candidates]);
    const toggle = (userId: string) => setSelected((prev) => toggleInvitee(prev, userId, INVITE_LIMITS.MAX_INVITEES));
    const full = selected.size >= INVITE_LIMITS.MAX_INVITEES;

    const send = async () => {
        if (selected.size === 0) return;
        setSending(true);
        try {
            const { results } = await sendInvites(currentInstanceId, {
                userIds: [...selected],
                message: message.trim() || undefined,
            });
            const ok = results.filter((r) => r.ok).map((r) => r.userId);
            const failed = results.flatMap((r) => (r.ok ? [] : [r]));
            setSent((prev) => new Set([...prev, ...ok]));
            setSelected(new Set());
            if (ok.length > 0) pushToast(`${ok.length} 人に招待を送りました`);
            const first = failed[0];
            if (first) pushToast(INVITE_REFUSAL_MESSAGES[first.reason], 'error');
        } catch (e: unknown) {
            pushToast(e instanceof Error ? e.message : '招待を送れませんでした', 'error');
        } finally {
            setSending(false);
        }
    };

    const linkWorks = instance !== null && instance.access.type !== 'invite_only';

    return (
        <div className={layout} onClick={(e) => e.stopPropagation()}>
            <div className={tabPanel}>
                <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={INVITE_LIMITS.MESSAGE_MAX}
                    placeholder="ひとこと（任意）"
                    aria-label="招待に添えるひとこと"
                    className={messageInput}
                />
                {error && <p className={css({ fontSize: '13px', color: 'errorText' })}>{error}</p>}
                {!candidates && !error && <p className={muted}>読み込み中...</p>}
                {candidates && candidates.length === 0 && (
                    <div
                        className={css({
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            gap: '3',
                        })}
                    >
                        <p className={muted}>フレンドがいません</p>
                        <button type="button" className={ghostButton} onClick={onFindFriends}>
                            <HudIcon name="search" size={16} />
                            ユーザーを探す
                        </button>
                    </div>
                )}
                <ul className={css({ display: 'flex', flexDirection: 'column', gap: '0.5' })}>
                    {ordered.map(({ user, refusal, online }) => {
                        const done = sent.has(user.id);
                        const blocked = refusal !== null || done;
                        const on = selected.has(user.id);
                        return (
                            <li key={user.id}>
                                <button
                                    type="button"
                                    className={row({ blocked })}
                                    aria-pressed={on}
                                    disabled={blocked || (full && !on)}
                                    onClick={() => toggle(user.id)}
                                >
                                    <span
                                        className={css({ position: 'relative', display: 'inline-flex', flexShrink: 0 })}
                                    >
                                        <UserAvatar user={user} />
                                        {online && <span className={onlineDot} aria-hidden="true" />}
                                    </span>
                                    <span
                                        className={css({ flex: 1, minW: 0, display: 'flex', flexDirection: 'column' })}
                                    >
                                        <span className={nameText}>{user.name}</span>
                                        {(refusal || done) && (
                                            <span className={reasonText}>
                                                {done ? '送信済み' : refusal && REFUSAL_LABELS[refusal]}
                                            </span>
                                        )}
                                    </span>
                                    {!blocked && (
                                        <span className={checkCircle({ on })} aria-hidden="true">
                                            {on && <HudIcon name="check" size={14} />}
                                        </span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
            <div className={footer}>
                {linkWorks ? (
                    <button type="button" className={ghostButton} onClick={onCopyLink}>
                        <HudIcon name="link" size={16} />
                        リンクをコピー
                    </button>
                ) : (
                    <span />
                )}
                {full && <span className={muted}>一度に {INVITE_LIMITS.MAX_INVITEES} 人まで</span>}
                <button
                    type="button"
                    className={sendButton}
                    disabled={selected.size === 0 || sending}
                    onClick={() => void send()}
                >
                    <HudIcon name="userPlus" size={16} />
                    {sending ? '送信中...' : selected.size > 0 ? `${selected.size} 人に送る` : '送る'}
                </button>
            </div>
        </div>
    );
}

const layout = css({ display: 'flex', flexDirection: 'column', h: 'full', minH: 0 });

const muted = css({ fontSize: '13px', color: 'textMuted' });

const messageInput = css({
    flexShrink: 0,
    w: 'full',
    h: '42px',
    px: '3',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'transparent',
    borderRadius: '10px',
    fontSize: '14px',
    color: 'text',
    outline: 'none',
    transition: 'border-color 0.16s ease',
    _focus: { borderColor: 'primary' },
    _placeholder: { color: 'textSubtle' },
});

const row = cva({
    base: {
        w: 'full',
        display: 'flex',
        alignItems: 'center',
        gap: '3',
        px: '2',
        py: '2',
        bg: 'transparent',
        border: 'none',
        borderRadius: '10px',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background-color 0.16s ease',
        _hover: { bg: 'surfaceHover' },
        _disabled: { cursor: 'default', _hover: { bg: 'transparent' } },
        '&[aria-pressed="true"]': { bg: 'surface' },
    },
    variants: { blocked: { true: { opacity: 0.55 }, false: {} } },
});

const onlineDot = css({
    position: 'absolute',
    right: '-1px',
    bottom: '-1px',
    w: '12px',
    h: '12px',
    borderRadius: 'full',
    bg: 'hudStatusOn',
    border: '2px solid',
    borderColor: 'background',
});

const nameText = css({
    fontSize: '14px',
    fontWeight: '700',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const reasonText = css({ fontSize: '12px', color: 'textMuted' });

const checkCircle = cva({
    base: {
        flexShrink: 0,
        w: '22px',
        h: '22px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'full',
        border: '1.5px solid',
        transition: 'background-color 0.16s ease, border-color 0.16s ease',
    },
    variants: {
        on: {
            true: { bg: 'primary', borderColor: 'primary', color: 'textOnPrimary' },
            false: { bg: 'transparent', borderColor: 'borderStrong' },
        },
    },
});

const footer = css({
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '3',
    pt: '3',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'border',
});

const ghostButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1.5',
    px: '3',
    py: '2',
    bg: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: 'textMuted',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease, color 0.16s ease',
    _hover: { bg: 'surfaceHover', color: 'text' },
});

const sendButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2',
    px: '4',
    py: '2.5',
    border: 'none',
    borderRadius: '8px',
    bg: 'primary',
    color: 'textOnPrimary',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'primaryHover' },
    _disabled: { opacity: 0.45, cursor: 'default', _hover: { bg: 'primary' } },
});
