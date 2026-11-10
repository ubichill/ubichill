import {
    AdminUsersSection,
    AnnouncementSection,
    RolesSection,
    ServerPoliciesSection,
    WorldPeersSection,
} from '@/components/admin';
import { css } from '@/styled-system/css';
import { SplitTab, type SplitTabItem } from './SplitTab';

export type ControlPanelSection = 'users' | 'roles' | 'federation' | 'announcements';

const SECTIONS: ReadonlyArray<SplitTabItem<ControlPanelSection>> = [
    { id: 'users', label: 'ユーザー', icon: 'users' },
    { id: 'roles', label: 'ロール', icon: 'tag' },
    { id: 'federation', label: '連合', icon: 'server' },
    { id: 'announcements', label: 'お知らせ', icon: 'megaphone' },
];

/** コントロールパネル（管理者だけ）。ユーザーとロール・連合・お知らせを左で切り替える。 */
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
                {section === 'users' && <AdminUsersSection />}
                {section === 'roles' && <RolesSection />}
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
