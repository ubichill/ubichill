import { isPublishable } from '@ubichill/shared';
import { ServerPoliciesSection, WorldPeersSection } from '@/components/federation';
import { HomeSettingsSection } from '@/components/home/HomeSettingsSection';
import { MyWorldsSection, useMyAccount } from '@/components/profile';
import { AnnouncementSection } from '@/components/profile/AnnouncementSection';
import { PasswordSection } from '@/components/profile/PasswordSection';
import { PublishingSection } from '@/components/profile/PublishingSection';
import { css } from '@/styled-system/css';
import { SplitTab, type SplitTabItem } from './SplitTab';
import { FediverseSection } from './settings/FediverseSection';
import { LogoutSection } from './settings/LogoutSection';
import { ModPermissionsSettings } from './settings/ModPermissionsSettings';
import { PrivacySection } from './settings/PrivacySection';
import type { JoinInstanceHandler } from './shared';

export type SettingsSection =
    | 'home'
    | 'privacy'
    | 'fediverse'
    | 'worlds'
    | 'publishing'
    | 'account'
    | 'federation'
    | 'announcements'
    | 'mods';

const SECTIONS: ReadonlyArray<SplitTabItem<SettingsSection> & { adminOnly?: boolean }> = [
    { id: 'home', label: 'ホーム', icon: 'home' },
    { id: 'privacy', label: 'プライバシー', icon: 'lock' },
    { id: 'fediverse', label: 'フェディバース', icon: 'fediverse' },
    { id: 'worlds', label: 'ワールド', icon: 'globe' },
    { id: 'publishing', label: '公開', icon: 'key' },
    { id: 'account', label: 'アカウント', icon: 'user' },
    { id: 'mods', label: 'mod の権限', icon: 'puzzle' },
    { id: 'federation', label: '連合', icon: 'server', adminOnly: true },
    { id: 'announcements', label: 'お知らせ', icon: 'megaphone', adminOnly: true },
];

/** 自分のアカウントを読み込んでから出す欄（ほかの欄はそれぞれ自分で読み込む）。 */
const NEEDS_ACCOUNT: ReadonlySet<SettingsSection> = new Set([
    'worlds',
    'publishing',
    'account',
    'federation',
    'announcements',
]);

/**
 * 設定タブ。ホーム・プライバシー（だれに何を見せるか）・フェディバース（フォローの受け方とフォロワー）・ワールドの管理・
 * 公開（公開環境）・アカウント（パスワード・ログアウト）・mod の権限・管理者だけの欄を、左で切り替える。
 * プロフィールはプロフィールの画面でその場で編集する。
 */
export function SettingsTab({
    section,
    onSectionChange,
    onNavigate,
    onJoinInstance,
}: {
    section: SettingsSection;
    onSectionChange: (next: SettingsSection) => void;
    onNavigate?: () => void;
    onJoinInstance: JoinInstanceHandler;
}) {
    const account = useMyAccount();
    const { profile } = account;
    const sections = SECTIONS.filter((s) => !s.adminOnly || profile?.isAdmin);
    const current = sections.some((s) => s.id === section) ? section : 'home';
    const unsignedCount = account.worlds.filter((w) => !isPublishable(w.identity)).length;
    const needsAccount = NEEDS_ACCOUNT.has(current);

    return (
        <SplitTab label="設定" items={sections} current={current} onSelect={onSectionChange}>
            <div className={css({ display: 'flex', flexDirection: 'column', gap: '6', maxW: '720px' })}>
                {needsAccount && account.error && (
                    <p className={css({ fontSize: '13px', color: 'errorText' })}>{account.error}</p>
                )}
                {needsAccount && account.loading && (
                    <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>
                )}
                {current === 'home' && <HomeSettingsSection />}
                {current === 'privacy' && <PrivacySection />}
                {current === 'fediverse' && <FediverseSection />}
                {current === 'worlds' && !account.loading && (
                    <MyWorldsSection account={account} onNavigate={onNavigate} onJoinInstance={onJoinInstance} />
                )}
                {current === 'publishing' && profile && (
                    <PublishingSection
                        account={{
                            ...profile,
                            signingKeys: profile.signingKeys ?? [],
                            displayNameConflict: !!profile.displayNameConflict,
                            displayNameChangeAvailableAt: profile.displayNameChangeAvailableAt ?? null,
                            passwordChangeRequired: !!profile.passwordChangeRequired,
                            passwordManagedBySecret: !!profile.passwordManagedBySecret,
                            isAdmin: !!profile.isAdmin,
                        }}
                        onAccountChange={account.setProfile}
                        unsignedCount={unsignedCount}
                        worlds={account.worlds}
                        onResign={account.signWorlds}
                        onRevoked={account.reloadMyWorlds}
                        refreshKey={account.environmentsVersion}
                    />
                )}
                {current === 'account' && profile && (
                    <PasswordSection
                        required={!!profile.passwordChangeRequired}
                        managedBySecret={!!profile.passwordManagedBySecret}
                        onChanged={() => account.setProfile({ ...profile, passwordChangeRequired: false })}
                    />
                )}
                {current === 'account' && <LogoutSection />}
                {current === 'federation' && profile?.isAdmin && (
                    <>
                        <ServerPoliciesSection />
                        <WorldPeersSection />
                    </>
                )}
                {current === 'announcements' && profile?.isAdmin && <AnnouncementSection />}
                {current === 'mods' && <ModPermissionsSettings />}
            </div>
        </SplitTab>
    );
}
