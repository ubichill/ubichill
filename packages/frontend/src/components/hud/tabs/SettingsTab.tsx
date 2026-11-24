import { isPublishable } from '@ubichill/shared';
import { HomeSettingsSection } from '@/components/home/HomeSettingsSection';
import { useMyAccount } from '@/components/profile';
import { PublishingSection } from '@/components/publishing/PublishingSection';
import { useLoginMethods } from '@/lib/account/fediverseSignIn';
import { css } from '@/styled-system/css';
import type { SettingsSection } from '../settingsLink';
import { SplitTab, type SplitTabItem } from './SplitTab';
import { DeleteAccountSection } from './settings/DeleteAccountSection';
import { FediverseSection } from './settings/FediverseSection';
import { LoginMethodsSection } from './settings/LoginMethodsSection';
import { ModPermissionsSettings } from './settings/ModPermissionsSettings';
import { PasswordSection } from './settings/PasswordSection';
import { PrivacySection } from './settings/PrivacySection';
import { SessionsSection } from './settings/SessionsSection';
import { StorageSection } from './settings/StorageSection';
import { TwoFactorSection } from './settings/TwoFactorSection';

const SECTIONS: ReadonlyArray<SplitTabItem<SettingsSection>> = [
    { id: 'home', label: 'ホーム', icon: 'home' },
    { id: 'privacy', label: 'プライバシー', icon: 'lock' },
    { id: 'fediverse', label: 'フェディバース', icon: 'fediverse' },
    { id: 'publishing', label: '公開', icon: 'key' },
    { id: 'storage', label: 'ストレージ', icon: 'hardDrive' },
    { id: 'account', label: 'アカウント', icon: 'user' },
    { id: 'mods', label: 'mod の権限', icon: 'puzzle' },
];

/** 自分のアカウントを読み込んでから出す欄（ほかの欄はそれぞれ自分で読み込む）。 */
const NEEDS_ACCOUNT: ReadonlySet<SettingsSection> = new Set(['publishing', 'account']);

/**
 * 設定タブ。ホーム・プライバシー（だれに何を見せるか）・フェディバース（フォローの受け方とフォロワー）・
 * 公開（公開環境）・ストレージ（上げた画像）・アカウント（パスワード・ログイン方法・ログイン中の端末・削除）・mod の権限を、左で切り替える。
 * プロフィールはプロフィールの画面でその場で編集する。管理者の設定（連合・お知らせ）はコントロールパネル。
 */
export function SettingsTab({
    section,
    onSectionChange,
    linkedEnvironment,
}: {
    section: SettingsSection;
    onSectionChange: (next: SettingsSection) => void;
    /** 「公開」で目立たせる公開環境（追加の通知メールのリンクから来た） */
    linkedEnvironment: string | null;
}) {
    const account = useMyAccount();
    const { profile } = account;
    const current = SECTIONS.some((s) => s.id === section) ? section : 'home';
    const unsignedCount = account.worlds.filter((w) => !isPublishable(w.identity)).length;
    const needsAccount = NEEDS_ACCOUNT.has(current);
    const loginMethods = useLoginMethods(current === 'account');

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
                        linkedEnvironmentId={linkedEnvironment}
                    />
                )}
                {current === 'storage' && <StorageSection />}
                {current === 'account' && (
                    <p className={css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6' })}>
                        パスワード・二段階認証・ログイン方法・ログイン中の端末など、アカウントの安全に関わる設定です。
                    </p>
                )}
                {current === 'account' && profile && loginMethods.methods?.password !== false && (
                    <PasswordSection
                        required={!!profile.passwordChangeRequired}
                        managedBySecret={!!profile.passwordManagedBySecret}
                        onChanged={() => account.setProfile({ ...profile, passwordChangeRequired: false })}
                    />
                )}
                {current === 'account' && (
                    <TwoFactorSection methods={loginMethods.methods} onReauthenticated={loginMethods.reload} />
                )}
                {current === 'account' && (
                    <LoginMethodsSection
                        methods={loginMethods.methods}
                        adminRequiresPassword={!!profile?.adminRequiresPassword}
                        onChanged={() => {
                            loginMethods.reload();
                            void account.reloadProfile();
                        }}
                    />
                )}
                {current === 'account' && <SessionsSection />}
                {current === 'account' && profile && (
                    <DeleteAccountSection
                        handle={profile.handle}
                        official={!!profile.passwordManagedBySecret}
                        methods={loginMethods.methods}
                        onReauthenticated={loginMethods.reload}
                    />
                )}
                {current === 'mods' && <ModPermissionsSettings />}
            </div>
        </SplitTab>
    );
}
