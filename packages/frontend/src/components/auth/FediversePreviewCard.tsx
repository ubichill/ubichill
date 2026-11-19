import type { FediversePreview } from '@ubichill/shared';
import { useState } from 'react';
import { css } from '@/styled-system/css';
import { SoftwareLogo } from './FediverseBrandIcons';

/** 入力したユーザー ID のサーバーとアカウントを見た目で確かめる（画像はそのサーバーのもの）。 */
export function FediversePreviewCard({ preview }: { preview: FediversePreview }) {
    const { server, account } = preview;
    // 相手のサーバーの画像は読めないことがある（壊れた画像を出さず、ロゴか頭文字にする）
    const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
    const usable = (url: string | null): url is string => !!url && !failed.has(url);
    const markFailed = (url: string) => setFailed((prev) => new Set(prev).add(url));
    return (
        <div className={card}>
            <div className={serverRow}>
                {usable(server.iconUrl) ? (
                    <img
                        src={server.iconUrl}
                        alt=""
                        width={20}
                        height={20}
                        className={serverIcon}
                        referrerPolicy="no-referrer"
                        onError={() => server.iconUrl && markFailed(server.iconUrl)}
                    />
                ) : (
                    <SoftwareLogo software={server.software} size={20} />
                )}
                <span className={serverName}>{server.name ?? server.host}</span>
                <span className={css({ ml: 'auto', display: 'inline-flex' })} title={server.software}>
                    <SoftwareLogo software={server.software} size={16} />
                </span>
            </div>
            {account && (
                <div className={accountRow}>
                    {usable(account.avatarUrl) ? (
                        <img
                            src={account.avatarUrl}
                            alt=""
                            width={44}
                            height={44}
                            className={avatar}
                            referrerPolicy="no-referrer"
                            onError={() => account.avatarUrl && markFailed(account.avatarUrl)}
                        />
                    ) : (
                        <span className={avatarFallback} aria-hidden="true">
                            {Array.from(account.displayName ?? account.username)[0]?.toUpperCase()}
                        </span>
                    )}
                    <div className={css({ minW: 0 })}>
                        <p className={displayName}>{account.displayName ?? account.username}</p>
                        <p className={handle}>
                            @{account.username}@{server.host}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

const card = css({
    display: 'flex',
    flexDirection: 'column',
    gap: '3',
    w: 'full',
    p: '3',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    rounded: 'lg',
});

const serverRow = css({ display: 'flex', alignItems: 'center', gap: '2', minW: 0 });
const serverIcon = css({ w: '20px', h: '20px', rounded: 'sm', objectFit: 'cover', flexShrink: 0 });
const serverName = css({
    fontSize: 'xs',
    fontWeight: 'medium',
    color: 'textMuted',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const accountRow = css({ display: 'flex', alignItems: 'center', gap: '3' });
const avatar = css({ w: '44px', h: '44px', rounded: 'full', objectFit: 'cover', flexShrink: 0, bg: 'surfaceAccent' });
const avatarFallback = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '44px',
    h: '44px',
    rounded: 'full',
    flexShrink: 0,
    bg: 'surfaceAccent',
    color: 'text',
    fontWeight: 'bold',
});
const displayName = css({
    fontSize: 'md',
    fontWeight: 'bold',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});
const handle = css({ fontSize: 'xs', color: 'textMuted', overflowWrap: 'anywhere' });
