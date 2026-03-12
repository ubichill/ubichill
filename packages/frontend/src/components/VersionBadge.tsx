'use client';

import { useEffect, useState } from 'react';
import { getApiBase } from '@/lib/api';
import { css } from '@/styled-system/css';

interface VersionInfo {
    commitHash: string;
    environment: string;
}

// ビルド時に埋め込まれたフロントエンドのコミットハッシュ
const FE_COMMIT = process.env.NEXT_PUBLIC_COMMIT_HASH ?? 'unknown';

const REPO = 'https://github.com/ubichill/ubichill';

function CommitLink({ hash, short }: { hash: string; short: string }) {
    if (hash === 'unknown') {
        return <span style={{ color: 'rgba(255,255,255,0.5)' }}>{short}</span>;
    }
    return (
        <a
            href={`${REPO}/commit/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'rgba(255,255,255,0.8)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
        >
            {short}
        </a>
    );
}

export function VersionBadge() {
    const [info, setInfo] = useState<VersionInfo | null>(null);

    useEffect(() => {
        fetch(`${getApiBase()}/api/version`)
            .then((r) => r.json())
            .then((data: VersionInfo) => setInfo(data))
            .catch(() => {
                /* 取得できない場合は非表示 */
            });
    }, []);

    // development 環境でのみ表示
    if (!info || info.environment !== 'development') return null;

    const beShort = info.commitHash === 'unknown' ? 'local' : info.commitHash.slice(0, 7);
    const feShort = FE_COMMIT === 'unknown' ? 'local' : FE_COMMIT.slice(0, 7);

    return (
        <div
            className={css({
                position: 'fixed',
                bottom: '12px',
                right: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '6px 10px',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(4px)',
                borderRadius: '8px',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: 'rgba(255,255,255,0.8)',
                zIndex: 9999,
                lineHeight: '1.6',
            })}
        >
            <div className={css({ display: 'flex', alignItems: 'center', gap: '5px' })}>
                <span
                    className={css({
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: '#40c057',
                        flexShrink: 0,
                    })}
                />
                <span>{info.environment}</span>
            </div>
            <div>
                <span className={css({ color: 'rgba(255,255,255,0.5)' })}>FE </span>
                <CommitLink hash={FE_COMMIT} short={feShort} />
            </div>
            <div>
                <span className={css({ color: 'rgba(255,255,255,0.5)' })}>BE </span>
                <CommitLink hash={info.commitHash} short={beShort} />
            </div>
        </div>
    );
}
