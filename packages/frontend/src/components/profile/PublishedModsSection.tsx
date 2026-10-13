/**
 * プロフィールの「公開している mod」。公開先で本人の署名付きと確かめられた mod だけが届く。
 * URL はワールドの依存（`spec.dependencies[].source.url`）にそのまま書ける値。
 */
import type { PublishedMod } from '@ubichill/shared';
import { useState } from 'react';
import { css } from '@/styled-system/css';

function CopyUrlButton({ url }: { url: string }) {
    const [copied, setCopied] = useState(false);
    const copy = () =>
        navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    return (
        <button
            type="button"
            onClick={() => void copy()}
            className={css({
                mt: '2',
                px: '2.5',
                py: '1',
                borderRadius: '8px',
                border: '1px solid',
                borderColor: 'border',
                bg: 'background',
                color: 'text',
                fontSize: '11px',
                cursor: 'pointer',
                _hover: { borderColor: 'borderStrong' },
            })}
        >
            {copied ? 'コピーしました' : 'URL をコピー'}
        </button>
    );
}

export function PublishedModsSection({ mods }: { mods: PublishedMod[] }) {
    return (
        <section className={css({ mt: '6' })}>
            <h2 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '3' })}>公開している mod</h2>
            <div
                className={css({
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: '3',
                })}
            >
                {mods.map((mod) => (
                    <div
                        key={`${mod.url} ${mod.id}`}
                        className={css({
                            p: '3',
                            bg: 'surface',
                            border: '1px solid',
                            borderColor: 'border',
                            borderRadius: '12px',
                        })}
                    >
                        <div className={css({ fontSize: '14px', fontWeight: '700', color: 'text' })}>{mod.name}</div>
                        <div className={css({ fontSize: '12px', color: 'textMuted', mt: '0.5' })}>v{mod.version}</div>
                        <div
                            className={css({
                                fontSize: '11px',
                                color: 'textSubtle',
                                mt: '2',
                                wordBreak: 'break-all',
                                userSelect: 'all',
                            })}
                        >
                            {mod.url}
                        </div>
                        <CopyUrlButton url={mod.url} />
                    </div>
                ))}
            </div>
        </section>
    );
}
