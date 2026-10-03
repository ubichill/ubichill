import { FriendLocations, useFriendLocations } from '@/components/social';
import { css } from '@/styled-system/css';
import { cardStyle, type JoinInstanceHandler, sectionHeading, tabPanel } from './shared';

/** ソーシャルタブ: フレンドがいま入っているインスタンス（自分に見えるものだけ）。 */
export function SocialTab({
    currentInstanceId,
    onJoinInstance,
}: {
    currentInstanceId?: string;
    onJoinInstance: JoinInstanceHandler;
}) {
    const { data, error } = useFriendLocations();
    const here = data ? data.locations.reduce((n, l) => n + l.friends.length, 0) : 0;
    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>フレンドの現在地（{here}）</h2>
                {error && <p className={css({ fontSize: '13px', color: 'errorText' })}>{error}</p>}
                {data ? (
                    <FriendLocations
                        data={data}
                        currentInstanceId={currentInstanceId}
                        onJoin={(instance) =>
                            onJoinInstance(instance.id, instance.world.id, {
                                thumbnail: instance.world.thumbnail,
                                displayName: instance.world.displayName,
                            })
                        }
                    />
                ) : (
                    !error && <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>
                )}
            </div>
        </div>
    );
}
