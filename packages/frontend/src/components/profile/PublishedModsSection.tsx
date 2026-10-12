/**
 * プロフィールの「公開している mod」。公開先で本人の署名付きと確かめられた mod だけが届く。
 * URL はワールドの依存（`spec.dependencies[].source.url`）にそのまま書ける値。
 */
import type { PublishedMod } from '@ubichill/shared';
import { css } from '@/styled-system/css';

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
                    </div>
                ))}
            </div>
        </section>
    );
}
