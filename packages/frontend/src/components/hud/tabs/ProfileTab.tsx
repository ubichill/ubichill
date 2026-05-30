import { UserProfileView } from '@/components/profile';
import { cardStyle, type JoinInstanceHandler, tabPanel } from './shared';

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
