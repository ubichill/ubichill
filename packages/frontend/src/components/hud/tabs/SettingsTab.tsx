import { isPublishable } from '@ubichill/shared';
import { ServerPoliciesSection, WorldPeersSection } from '@/components/federation';
import { HomeSettingsSection } from '@/components/home/HomeSettingsSection';
import { MyWorldsSection, useMyAccount } from '@/components/profile';
import { AnnouncementSection } from '@/components/profile/AnnouncementSection';
import { PasswordSection } from '@/components/profile/PasswordSection';
import { PublishingSection } from '@/components/profile/PublishingSection';
import { css } from '@/styled-system/css';
import { LogoutSection } from './settings/LogoutSection';
import { ModPermissionsSettings } from './settings/ModPermissionsSettings';
import { PrivacySection } from './settings/PrivacySection';
import { type JoinInstanceHandler, tabPanel, tabSection } from './shared';

export type SettingsSection =
    | 'home'
    | 'privacy'
    | 'worlds'
    | 'publishing'
    | 'account'
    | 'federation'
    | 'announcements'
    | 'mods';

const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string; adminOnly?: boolean }> = [
    { id: 'home', label: 'ホーム' },
    { id: 'privacy', label: 'プライバシー' },
    { id: 'worlds', label: 'ワールド' },
    { id: 'publishing', label: '公開' },
    { id: 'account', label: 'アカウント' },
    { id: 'federation', label: '連合', adminOnly: true },
    { id: 'announcements', label: 'お知らせ', adminOnly: true },
    { id: 'mods', label: 'mod の権限' },
];

/**
 * 設定タブ。ホーム・プライバシー（だれに何を見せるか）・ワールドの管理・公開（公開環境）・アカウント（パスワード・ログアウト）・
 * 連合（管理者）・mod の権限をタブで分ける。プロフィールはプロフィールの画面でその場で編集する。
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

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={tabSection}>
                <div
                    role="tablist"
                    className={css({
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '1',
                        borderBottomWidth: '1px',
                        borderBottomStyle: 'solid',
                        borderBottomColor: 'border',
                        mb: '4',
                    })}
                >
                    {sections.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            role="tab"
                            aria-selected={s.id === current}
                            onClick={() => onSectionChange(s.id)}
                            className={css({
                                px: '3',
                                py: '2',
                                bg: 'transparent',
                                borderWidth: '0 0 3px 0',
                                borderStyle: 'solid',
                                borderColor: s.id === current ? 'primary' : 'transparent',
                                color: s.id === current ? 'text' : 'textMuted',
                                fontSize: '13px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                            })}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
                {account.error && current !== 'mods' && current !== 'home' && current !== 'privacy' && (
                    <p className={css({ fontSize: '13px', color: 'errorText', mb: '3' })}>{account.error}</p>
                )}
                {current !== 'mods' && current !== 'home' && current !== 'privacy' && account.loading && (
                    <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>
                )}
                {current === 'home' && <HomeSettingsSection />}
                {current === 'privacy' && <PrivacySection />}
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
            </div>
            {current === 'mods' && <ModPermissionsSettings />}
        </div>
    );
}
