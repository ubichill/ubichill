import { UserProfileView } from '@/components/profile';
import { cardStyle, tabPanel } from './shared';

export function ProfileTab({ onNavigate }: { onNavigate?: () => void }) {
    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <UserProfileView onNavigate={onNavigate} />
            </div>
        </div>
    );
}
