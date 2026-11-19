import type { FediverseServerInfo, FediverseSoftware } from '@ubichill/shared';
import { useState } from 'react';
import { css, cva } from '@/styled-system/css';
import { SoftwareLogo } from './FediverseBrandIcons';

/**
 * サーバーのアイコン・名前・ドメインと種類のロゴ。アイコンは相手のサーバーの画像で、読めなければ種類のロゴにする。
 * `server` が null の間（確かめ中）はドメインだけ出す。
 */
export function FediverseServerCard({
    host,
    server,
    size = 'md',
}: {
    host: string;
    server: FediverseServerInfo | null;
    size?: 'sm' | 'md';
}) {
    const [iconFailed, setIconFailed] = useState(false);
    const iconSize = size === 'sm' ? 28 : 40;
    const software: FediverseSoftware | null = server?.software ?? null;
    return (
        <span className={row}>
            {server?.iconUrl && !iconFailed ? (
                <img
                    src={server.iconUrl}
                    alt=""
                    width={iconSize}
                    height={iconSize}
                    className={icon}
                    referrerPolicy="no-referrer"
                    onError={() => setIconFailed(true)}
                />
            ) : (
                <span className={iconFallback({ size })} aria-hidden="true">
                    {software ? <SoftwareLogo software={software} size={iconSize * 0.6} /> : null}
                </span>
            )}
            <span className={css({ display: 'flex', flexDirection: 'column', minW: 0, textAlign: 'left' })}>
                <span className={name}>{server?.name ?? host}</span>
                {/* 名前がドメインと同じなら 2 度出さない */}
                {server?.name && server.name.toLowerCase() !== host && <span className={domain}>{host}</span>}
            </span>
            {software && (
                <span className={css({ ml: 'auto', display: 'inline-flex', flexShrink: 0 })}>
                    <SoftwareLogo software={software} size={16} />
                </span>
            )}
        </span>
    );
}

const row = css({ display: 'flex', alignItems: 'center', gap: '3', w: 'full', minW: 0 });
const icon = css({ rounded: 'md', objectFit: 'cover', flexShrink: 0, bg: 'surfaceAccent' });
const iconFallback = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        rounded: 'md',
        flexShrink: 0,
        bg: 'surfaceAccent',
    },
    variants: { size: { sm: { w: '28px', h: '28px' }, md: { w: '40px', h: '40px' } } },
});
const name = css({
    fontSize: 'sm',
    fontWeight: 'bold',
    color: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});
const domain = css({ fontSize: 'xs', color: 'textMuted', overflowWrap: 'anywhere' });
