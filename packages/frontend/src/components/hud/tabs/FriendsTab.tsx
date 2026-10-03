import { useNavigate } from 'react-router';
import { SocialPanel } from '@/components/social';
import { type JoinInstanceHandler, tabPanel } from './shared';

/** HUD のフレンドタブ: フレンドの現在地と、ソーシャルページ（検索・申請）への入口。 */
export function FriendsTab({
    currentInstanceId,
    onJoinInstance,
    onNavigate,
}: {
    currentInstanceId?: string;
    onJoinInstance: JoinInstanceHandler;
    onNavigate?: () => void;
}) {
    const navigate = useNavigate();
    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <SocialPanel
                compact
                currentInstanceId={currentInstanceId}
                onJoin={(instance) =>
                    onJoinInstance(instance.id, instance.world.id, {
                        thumbnail: instance.world.thumbnail,
                        displayName: instance.world.displayName,
                    })
                }
                onOpenSocial={() => {
                    onNavigate?.();
                    navigate('/social');
                }}
            />
        </div>
    );
}
