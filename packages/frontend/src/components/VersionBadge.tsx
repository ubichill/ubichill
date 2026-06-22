import { useEffect, useState } from 'react';
import { getApiBase } from '@/lib/api';
import { css } from '@/styled-system/css';

interface VersionInfo {
    commitHash: string;
    environment: string;
}

// ビルド時に埋め込まれたフロントエンドのコミットハッシュ
const FE_COMMIT = import.meta.env.VITE_COMMIT_HASH ?? 'unknown';

// ビルド時に埋め込まれる環境名。表示/非表示の判定はこれ「だけ」で決める。
// バックエンド (/api/version) 不達でも dev では確実にバッジを出すため、
// API レスポンスには依存しない。未設定 (ローカル pnpm dev) は development 扱い。
const FE_ENVIRONMENT = (import.meta.env.VITE_ENVIRONMENT as string | undefined) ?? 'development';

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
        // BE のコミット/環境を「補強情報」として取得するだけ（表示判定には使わない）。
        fetch(`${getApiBase()}/api/version`)
            .then((r) => (r.ok ? (r.json() as Promise<VersionInfo>) : null))
            .then((data) => {
                if (data) setInfo(data);
            })
            .catch(() => {
                /* 取得できなくてもバッジは出す（FE_ENVIRONMENT で判定済み） */
            });
    }, []);

    // 本番ビルドのみ非表示。dev / local は API 不達でも確実に表示する。
    if (FE_ENVIRONMENT === 'production') return null;

    // 表示する環境名は BE の値があれば優先、無ければビルド時の FE 環境名。
    const environment = info?.environment ?? FE_ENVIRONMENT;
    const beCommit = info?.commitHash ?? 'unknown';
    const beShort = beCommit === 'unknown' ? 'local' : beCommit.slice(0, 7);
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
                <span>{environment}</span>
            </div>
            <div>
                <span className={css({ color: 'rgba(255,255,255,0.5)' })}>FE </span>
                <CommitLink hash={FE_COMMIT} short={feShort} />
            </div>
            <div>
                <span className={css({ color: 'rgba(255,255,255,0.5)' })}>BE </span>
                <CommitLink hash={beCommit} short={beShort} />
            </div>
        </div>
    );
}
