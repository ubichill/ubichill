import { isPublishable, LIMITS } from '@ubichill/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { WorldDetailModal } from '@/components/lobby/WorldDetailModal';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { css } from '@/styled-system/css';
import { OwnedWorldCard } from './OwnedWorldCard';
import type { MyAccountState } from './useMyAccount';

const grid = css({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '4' });

/**
 * 設定の「ワールド」: 作成したワールドの新規作成・編集・署名して公開・削除と、リポジトリで管理しているワールド。
 */
export function MyWorldsSection({
    account,
    onNavigate,
    onJoinInstance,
}: {
    account: MyAccountState;
    onNavigate?: () => void;
    onJoinInstance: (
        instanceId: string,
        worldId: string,
        worldData?: { thumbnail?: string; displayName?: string },
    ) => void;
}) {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);
    const { worlds, profile } = account;

    const go = async (path: string) => {
        if (!(await confirm('このページに移動しますか？'))) return;
        onNavigate?.();
        navigate(path);
    };

    // 作成数の上限は本体に作ったワールドだけで数える（リポジトリ管理のワールドは含めない）
    const hostedWorlds = worlds.filter((w) => w.managedBy !== 'repository');
    const repositoryWorlds = worlds.filter((w) => w.managedBy === 'repository');
    const remaining = Math.max(0, LIMITS.MAX_WORLDS_PER_USER - hostedWorlds.length);
    const selectedWorld = worlds.find((w) => w.id === selectedWorldId);

    return (
        <div>
            <div
                className={css({
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    mb: '3',
                    flexWrap: 'wrap',
                    gap: '2',
                })}
            >
                <h3 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text' })}>
                    作成したワールド
                    <span className={css({ ml: '2', fontSize: '13px', fontWeight: '500', color: 'textMuted' })}>
                        {hostedWorlds.length} / {LIMITS.MAX_WORLDS_PER_USER}
                    </span>
                </h3>
                <button
                    type="button"
                    onClick={() => void go('/worlds/new')}
                    disabled={remaining === 0}
                    title={remaining > 0 ? undefined : `上限 ${LIMITS.MAX_WORLDS_PER_USER} 個に達しています`}
                    className={css({
                        padding: '8px 16px',
                        bg: 'primary',
                        color: 'textOnPrimary',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                        _hover: { opacity: 0.9 },
                    })}
                >
                    + 新規作成
                </button>
            </div>

            <div className={grid}>
                {hostedWorlds.map((w) => (
                    <OwnedWorldCard
                        key={w.id}
                        world={w}
                        editable
                        onEdit={() => void go(`/world/${w.id}/edit`)}
                        onSign={
                            // 署名済みで作者を確認できないワールド（取り消した鍵など）は「公開」から署名し直す。
                            // 漏えいした環境の署名は中身を確かめさせるため、ここでは 1 クリックで署名し直させない
                            !isPublishable(w.identity) && w.identity?.status !== 'verified' && !w.problem
                                ? async () => void (await account.signWorlds([w.id]))
                                : undefined
                        }
                        onOpen={() => setSelectedWorldId(w.id)}
                        onDelete={async () => {
                            if (!(await confirm(`「${w.displayName}」を削除しますか?`))) return;
                            await account.deleteWorld(w.id);
                        }}
                    />
                ))}
                {Array.from({ length: remaining }).map((_, i) => (
                    <button
                        type="button"
                        key={`empty-${i}`}
                        onClick={() => void go('/worlds/new')}
                        className={css({
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minH: '180px',
                            bg: 'transparent',
                            border: '2px dashed',
                            borderColor: 'border',
                            borderRadius: '14px',
                            color: 'textSubtle',
                            cursor: 'pointer',
                            gap: '8px',
                            _hover: { borderColor: 'primary', color: 'primary' },
                        })}
                    >
                        <svg
                            width="28"
                            height="28"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                        >
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                        <span className={css({ fontSize: '13px' })}>空きスロット</span>
                    </button>
                ))}
            </div>

            {repositoryWorlds.length > 0 && (
                <section className={css({ mt: '8' })}>
                    <h3 className={css({ fontSize: 'lg', fontWeight: '700', color: 'text', mb: '1' })}>
                        リポジトリで管理しているワールド
                    </h3>
                    <p className={css({ fontSize: '13px', color: 'textMuted', mb: '3' })}>
                        worlds/ のファイルで管理しています。画面からは編集・削除できず、変更は PR で行います。
                    </p>
                    <div className={grid}>
                        {repositoryWorlds.map((w) => (
                            <OwnedWorldCard
                                key={w.id}
                                world={w}
                                editable={false}
                                onEdit={() => undefined}
                                onOpen={() => setSelectedWorldId(w.id)}
                            />
                        ))}
                    </div>
                </section>
            )}

            {selectedWorld && (
                <WorldDetailModal
                    worldId={selectedWorld.id}
                    initialWorld={{
                        ...selectedWorld,
                        description: selectedWorld.description ?? undefined,
                        thumbnail: selectedWorld.thumbnail ?? undefined,
                        authorId: profile?.id,
                    }}
                    onClose={() => setSelectedWorldId(null)}
                    onJoinInstance={onJoinInstance}
                />
            )}
        </div>
    );
}
