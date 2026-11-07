import type { Instance } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { InstanceCard } from '@/components/worlds/InstanceCard';
import { InstanceDetailOverlay } from '@/components/worlds/InstanceDetailOverlay';
import { useInstances } from '@/components/worlds/useInstances';
import { css } from '@/styled-system/css';
import { cardStyle, type JoinInstanceHandler, sectionHeading, tabPanel } from './shared';

interface InstancesTabProps {
    onJoinInstance: JoinInstanceHandler;
    /** 現在参加中のインスタンスID（一覧で「参加中」表示にする） */
    currentInstanceId?: string;
}

/** 入れるアクティブなインスタンスの一覧（ランチパッドの「インスタンス」）。 */
export function InstancesTab({ onJoinInstance, currentInstanceId }: InstancesTabProps) {
    const { instances, loading, error, refreshInstances } = useInstances();
    const [detailInstance, setDetailInstance] = useState<Instance | null>(null);

    useEffect(() => {
        void refreshInstances();
    }, [refreshInstances]);

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>アクティブなインスタンス</h2>
                {loading && instances.length === 0 ? (
                    <div className={css({ textAlign: 'center', p: '4', color: 'textMuted' })}>読み込み中...</div>
                ) : error ? (
                    <div className={css({ p: '4', bg: 'errorBg', color: 'errorText', borderRadius: '8px' })}>
                        {error}
                    </div>
                ) : instances.length === 0 ? (
                    <div
                        className={css({
                            textAlign: 'center',
                            p: '6',
                            bg: 'background',
                            borderRadius: '6px',
                            color: 'textMuted',
                            lineHeight: '1.7',
                            wordBreak: 'auto-phrase',
                        })}
                    >
                        アクティブなインスタンスはありません
                    </div>
                ) : (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
                        {instances.map((instance) => (
                            <InstanceCard
                                key={instance.id}
                                instance={instance}
                                isCurrent={instance.id === currentInstanceId}
                                onOpenDetail={() => setDetailInstance(instance)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {detailInstance && (
                <InstanceDetailOverlay
                    instance={detailInstance}
                    currentInstanceId={currentInstanceId}
                    onClose={() => setDetailInstance(null)}
                    onJoin={(id) => {
                        onJoinInstance(id, detailInstance.world.id, {
                            thumbnail: detailInstance.world.thumbnail,
                            displayName: detailInstance.world.displayName,
                        });
                        setDetailInstance(null);
                    }}
                />
            )}
        </div>
    );
}
