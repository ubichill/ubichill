import type { WorldDefinition } from '@ubichill/shared';
import { css } from '@/styled-system/css';

type Dependency = NonNullable<WorldDefinition['spec']['dependencies']>[number];

interface UsedModsListProps {
    dependencies: Dependency[];
}

/**
 * 「ワールド公開」タブで使う、使用中mod の読み取り専用一覧。
 *
 * ここでは追加/削除やレジストリ管理はできない（mod管理タブの責務）。
 * definition.spec.dependencies だけから描画するため、レジストリへの fetch は発生しない
 * — 「エディタ本体はmod管理をしない」という分離を保つため。
 */
export function UsedModsList({ dependencies }: UsedModsListProps) {
    if (dependencies.length === 0) {
        return <div className={css({ fontSize: '13px', color: 'textMuted', p: '12px' })}>使用中のmodはありません</div>;
    }

    return (
        <div
            className={css({
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '8px',
            })}
        >
            {dependencies.map((d) => (
                <div
                    key={d.name}
                    className={css({
                        p: '10px 12px',
                        bg: 'background',
                        border: '1.5px solid',
                        borderColor: 'border',
                        borderRadius: '10px',
                    })}
                >
                    <div className={css({ fontSize: '14px', fontWeight: '600', color: 'text' })}>{d.name}</div>
                    <div
                        className={css({
                            fontSize: '11px',
                            color: 'textSubtle',
                            mt: '2px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        })}
                    >
                        {d.source.type === 'local' ? 'ローカル' : d.source.url}
                        {d.source.version !== 'latest' ? ` · v${d.source.version}` : ''}
                    </div>
                </div>
            ))}
        </div>
    );
}
