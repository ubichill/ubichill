import { UserProfileView } from '@/components/profile';
import { cardStyle, type JoinInstanceHandler, tabPanel } from './shared';

/** マイページ: 自分のプロフィール（ほかの人に見えるとおり）。編集は設定のプロフィール。 */
export function ProfileTab({
    onNavigate,
    onJoinInstance,
    onEditProfile,
}: {
    onNavigate?: () => void;
    onJoinInstance: JoinInstanceHandler;
    onEditProfile: () => void;
}) {
    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <UserProfileView
                    onNavigate={onNavigate}
                    onJoinInstance={onJoinInstance}
                    onEditProfile={onEditProfile}
                />
            </div>
        </div>
    );
}
