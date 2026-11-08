import { UserProfileView } from '@/components/profile';
import { type JoinInstanceHandler, tabPanel } from './shared';

/** プロフィール（ほかの人に見えるとおり）。userId が無ければ自分のもの（「編集」でその場で編集できる）。 */
export function ProfileTab({
    userId,
    onNavigate,
    onJoinInstance,
}: {
    userId?: string;
    onNavigate?: () => void;
    onJoinInstance: JoinInstanceHandler;
}) {
    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <UserProfileView
                key={userId ?? 'me'}
                userId={userId}
                onNavigate={onNavigate}
                onJoinInstance={onJoinInstance}
            />
        </div>
    );
}
