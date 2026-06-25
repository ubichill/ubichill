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
        // BE のコミット/環境を取得。cache:'no-store' はブラウザ向けの指示で、
        // Cloudflare 等の中間 CDN は URL 単位のキャッシュを別に持つため古い応答
        // ({"commitHash":"<旧>"}) を返し得る。クエリに毎回違う値を付けて URL を
        // ユニーク化し、確実に CDN キャッシュミス→オリジン取得にする。
        fetch(`${getApiBase()}/api/version?t=${Date.now()}`, { cache: 'no-store' })
            .then((r) => (r.ok ? (r.json() as Promise<VersionInfo>) : null))
            .then((data) => {
                if (data) setInfo(data);
            })
            .catch(() => {
                /* 取得できなくても build-time の判定でバッジは出せる */
            });
    }, []);

    // 環境名は API(runtime の真実) を最優先、無ければ build-time の値。
    // 「本番」と確定できたときだけ非表示。dev / local / 不明 は表示する
    //   （API が environment を返さない / 不達でも、FE_ENVIRONMENT 既定の development で出る）。
    const environment = info?.environment ?? FE_ENVIRONMENT;
    if (environment === 'production') return null;
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
