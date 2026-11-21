import {
    AdminUsersSection,
    AnnouncementSection,
    BotProtectionSection,
    FediverseServersSection,
    RolesSection,
    ServerInfoSection,
    ServerPoliciesSection,
    WorldPeersSection,
} from '@/components/admin';
import { css } from '@/styled-system/css';
import { SplitTab, type SplitTabItem } from './SplitTab';

export type ControlPanelSection = 'general' | 'users' | 'roles' | 'auth' | 'federation' | 'announcements';

const SECTIONS: ReadonlyArray<SplitTabItem<ControlPanelSection>> = [
    { id: 'general', label: '全般', icon: 'gear' },
    { id: 'users', label: 'ユーザー', icon: 'users' },
    { id: 'roles', label: 'ロール', icon: 'tag' },
    { id: 'auth', label: '認証', icon: 'key' },
    { id: 'federation', label: '連合', icon: 'server' },
    { id: 'announcements', label: 'お知らせ', icon: 'megaphone' },
];

/** コントロールパネル（管理者だけ）。全般（サーバーの情報）・ユーザーとロール・認証・連合・お知らせを左で切り替える。 */
export function ControlPanelTab({
    section,
    onSectionChange,
}: {
    section: ControlPanelSection;
    onSectionChange: (next: ControlPanelSection) => void;
}) {
    return (
        <SplitTab label="コントロールパネル" items={SECTIONS} current={section} onSelect={onSectionChange}>
            <div className={css({ display: 'flex', flexDirection: 'column', gap: '6', maxW: '720px' })}>
                {section === 'general' && <ServerInfoSection />}
                {section === 'users' && <AdminUsersSection />}
                {section === 'roles' && <RolesSection />}
                {section === 'auth' && (
                    <>
                        <FediverseServersSection />
                        <BotProtectionSection />
                    </>
                )}
                {section === 'federation' && (
                    <>
                        <ServerPoliciesSection />
                        <WorldPeersSection />
                    </>
                )}
                {section === 'announcements' && <AnnouncementSection />}
            </div>
        </SplitTab>
    );
}
