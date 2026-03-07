'use client';

import { useEffect, useState } from 'react';
import { css } from '@/styled-system/css';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface VersionInfo {
    commitHash: string;
    environment: string;
}

export function VersionBadge() {
    const [info, setInfo] = useState<VersionInfo | null>(null);

    useEffect(() => {
        fetch(`${API_BASE}/api/version`)
            .then((r) => r.json())
            .then((data: VersionInfo) => setInfo(data))
            .catch(() => {
                /* 取得できない場合は非表示 */
            });
    }, []);

    if (!info) return null;

    const shortHash = info.commitHash === 'unknown' ? 'unknown' : info.commitHash.slice(0, 7);
    const isUnknown = info.commitHash === 'unknown';

    return (
        <div
            className={css({
                position: 'fixed',
                bottom: '12px',
                right: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                backgroundColor: 'rgba(0, 0, 0, 0.55)',
                backdropFilter: 'blur(4px)',
                borderRadius: '999px',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: 'rgba(255,255,255,0.8)',
                zIndex: 9999,
                userSelect: 'none',
                pointerEvents: 'none',
            })}
            title={`Commit: ${info.commitHash}`}
        >
            <span
                className={css({
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: isUnknown ? '#fcc419' : '#40c057',
                    flexShrink: 0,
                })}
            />
            {info.environment} · {shortHash}
        </div>
    );
}
