import { isPublishable } from '@ubichill/shared';
import { HomeSettingsSection } from '@/components/home/HomeSettingsSection';
import { useMyAccount } from '@/components/profile';
import { PublishingSection } from '@/components/publishing/PublishingSection';
import { css } from '@/styled-system/css';
import { SplitTab, type SplitTabItem } from './SplitTab';
import { FediverseSection } from './settings/FediverseSection';
import { LogoutSection } from './settings/LogoutSection';
import { ModPermissionsSettings } from './settings/ModPermissionsSettings';
import { PasswordSection } from './settings/PasswordSection';
import { PrivacySection } from './settings/PrivacySection';

export type SettingsSection = 'home' | 'privacy' | 'fediverse' | 'publishing' | 'account' | 'mods';

const SECTIONS: ReadonlyArray<SplitTabItem<SettingsSection>> = [
    { id: 'home', label: 'ホーム', icon: 'home' },
    { id: 'privacy', label: 'プライバシー', icon: 'lock' },
    { id: 'fediverse', label: 'フェディバース', icon: 'fediverse' },
    { id: 'publishing', label: '公開', icon: 'key' },
    { id: 'account', label: 'アカウント', icon: 'user' },
    { id: 'mods', label: 'mod の権限', icon: 'puzzle' },
];

/** 自分のアカウントを読み込んでから出す欄（ほかの欄はそれぞれ自分で読み込む）。 */
const NEEDS_ACCOUNT: ReadonlySet<SettingsSection> = new Set(['publishing', 'account']);

/**
 * 設定タブ。ホーム・プライバシー（だれに何を見せるか）・フェディバース（フォローの受け方とフォロワー）・
 * 公開（公開環境）・アカウント（パスワード・ログアウト）・mod の権限を、左で切り替える。
 * プロフィールはプロフィールの画面でその場で編集する。管理者の設定（連合・お知らせ）はコントロールパネル。
 */
export function SettingsTab({
    section,
    onSectionChange,
}: {
    section: SettingsSection;
    onSectionChange: (next: SettingsSection) => void;
}) {
    const account = useMyAccount();
    const { profile } = account;
    const current = SECTIONS.some((s) => s.id === section) ? section : 'home';
    const unsignedCount = account.worlds.filter((w) => !isPublishable(w.identity)).length;
    const needsAccount = NEEDS_ACCOUNT.has(current);

    return (
        <SplitTab label="設定" items={SECTIONS} current={current} onSelect={onSectionChange}>
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
                {current === 'mods' && <ModPermissionsSettings />}
            </div>
        </SplitTab>
    );
}
