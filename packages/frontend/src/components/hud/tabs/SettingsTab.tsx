import { isPublishable } from '@ubichill/shared';
import { MyWorldsSection, ProfileEditSection, useMyAccount } from '@/components/profile';
import { FederationSection } from '@/components/profile/FederationSection';
import { PasswordSection } from '@/components/profile/PasswordSection';
import { PublishingSection } from '@/components/profile/PublishingSection';
import { css } from '@/styled-system/css';
import { ModPermissionsSettings } from './settings/ModPermissionsSettings';
import { cardStyle, type JoinInstanceHandler, sectionHeading, tabPanel } from './shared';

export type SettingsSection = 'profile' | 'worlds' | 'publishing' | 'account' | 'federation' | 'mods';

const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string; adminOnly?: boolean }> = [
    { id: 'profile', label: 'プロフィール' },
    { id: 'worlds', label: 'ワールド' },
    { id: 'publishing', label: '公開' },
    { id: 'account', label: 'アカウント' },
    { id: 'federation', label: '連合', adminOnly: true },
    { id: 'mods', label: 'mod の権限' },
];

/**
 * 設定タブ。プロフィールの編集・ワールドの管理・公開（公開環境）・アカウント（パスワード）・連合（管理者）・mod の権限を
 * タブで分ける。プロフィールの表示は自分のユーザー名から開くマイページ。
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
    const current = sections.some((s) => s.id === section) ? section : 'profile';
    const unsignedCount = account.worlds.filter((w) => !isPublishable(w.identity)).length;

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>設定</h2>
                <div
                    role="tablist"
                    className={css({
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '1',
                        borderBottom: '1px solid',
                        borderColor: 'border',
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
                {account.error && current !== 'mods' && (
                    <p className={css({ fontSize: '13px', color: 'errorText', mb: '3' })}>{account.error}</p>
                )}
                {current !== 'mods' && account.loading && (
                    <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>
                )}
                {current === 'profile' && <ProfileEditSection account={account} />}
                {current === 'worlds' && !account.loading && (
                    <MyWorldsSection account={account} onNavigate={onNavigate} onJoinInstance={onJoinInstance} />
                )}
                {current === 'publishing' && profile && (
                    <PublishingSection
                        account={{
                            ...profile,
                            signingKeys: profile.signingKeys ?? [],
                            displayNameConflict: !!profile.displayNameConflict,
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
                {current === 'federation' && profile?.isAdmin && <FederationSection />}
            </div>
            {current === 'mods' && <ModPermissionsSettings />}
        </div>
    );
}
