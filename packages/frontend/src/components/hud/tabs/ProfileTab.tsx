import { UserProfileView } from '@/components/profile';
import { cardStyle, type JoinInstanceHandler, tabPanel } from './shared';

/** マイページ: 自分のプロフィール（ほかの人に見えるとおり）。「編集」でその場で編集できる。 */
export function ProfileTab({
    onNavigate,
    onJoinInstance,
}: {
    onNavigate?: () => void;
    onJoinInstance: JoinInstanceHandler;
}) {
    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <UserProfileView onNavigate={onNavigate} onJoinInstance={onJoinInstance} />
            </div>
        </div>
    );
}
