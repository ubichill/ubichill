import type { UserProfile } from '@ubichill/shared';
import type { ReactNode } from 'react';
import { pushToast } from '@/lib/toast';
import { userPagePath } from '@/lib/userPath';
import { css } from '@/styled-system/css';
import { ProfileAbout } from './ProfileAbout';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileBanner } from './ProfileBanner';
import { ProfileFieldsTable } from './ProfileFieldsTable';
import { ProfileLanguageChips } from './ProfileLanguageChips';
import { ProfileLinkButtons } from './ProfileLinkButtons';
import { PencilIcon, ShareIcon } from './profileIcons';
import { avatarRow, profileBody, profileButton, profileCard, roundIconButton } from './profileStyles';
import { StatusPill } from './StatusPill';

/** アカウント（`handle@domain`）を ID とドメインに分ける。ほかのサーバーの人は handle にもドメインが付いている。 */
const accountParts = (profile: Pick<UserProfile, 'handle' | 'author'>): { handle: string; domain: string } => {
    const at = profile.author.lastIndexOf('@');
    const domain = profile.author.slice(at);
    return {
        handle: profile.handle.endsWith(domain) ? profile.handle.slice(0, -domain.length) : profile.handle,
        domain,
    };
};

async function copyProfileUrl(profile: UserProfile): Promise<void> {
    const url = new URL(userPagePath(profile), window.location.origin).href;
    try {
        await navigator.clipboard.writeText(url);
        pushToast('プロフィールの URL をコピーしました');
    } catch {
        pushToast(`URL をコピーできませんでした: ${url}`, 'warn');
    }
}

function ShareButton({ profile }: { profile: UserProfile }) {
    return (
        <button
            type="button"
            className={roundIconButton()}
            aria-label="プロフィールの URL をコピー"
            title="プロフィールの URL をコピー"
            onClick={() => void copyProfileUrl(profile)}
        >
            <ShareIcon />
        </button>
    );
}

/** 名前と ID。ID のうちドメインの部分は薄くする（同じ名前の別サーバーの人と区別するための部分）。 */
export function ProfileIdentity({ profile }: { profile: Pick<UserProfile, 'name' | 'handle' | 'author'> }) {
    const account = accountParts(profile);
    return (
        <div className={css({ flex: 1, minW: 0 })}>
            <h1
                className={css({
                    fontSize: { base: '2xl', md: '3xl' },
                    fontWeight: '800',
                    color: 'text',
                    lineHeight: '1.25',
                    overflowWrap: 'anywhere',
                })}
            >
                {profile.name}
            </h1>
            <p className={css({ fontSize: '14px', color: 'textMuted', overflowWrap: 'anywhere' })}>
                @{account.handle}
                <span className={css({ color: 'textSubtle' })}>{account.domain}</span>
            </p>
        </div>
    );
}

/**
 * プロフィールの表示（バナー・アイコン・ひとこと・名前・自己紹介・リンク・言語）。本人には「編集」を出す。
 * ほかの人には、バナーの左上に相手との関係（relation）、右上にその操作（actions）を重ねる（Misskey と同じ置き方）。
 */
export function ProfileHeader({
    profile,
    isOwner,
    onEdit,
    editPending,
    relation,
    actions,
}: {
    profile: UserProfile;
    isOwner: boolean;
    onEdit: () => void;
    editPending: boolean;
    relation?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <article className={profileCard}>
            <ProfileBanner src={profile.bannerImage}>
                {(relation || actions) && (
                    <div className={bannerBar}>
                        <div className={css({ flex: '1 1 auto', minW: 0 })}>{relation}</div>
                        <div className={css({ flex: '0 1 auto', minW: 0 })}>{actions}</div>
                    </div>
                )}
            </ProfileBanner>
            <div className={profileBody}>
                <div className={avatarRow}>
                    <ProfileAvatar src={profile.image} name={profile.name} />
                    {profile.status && <StatusPill status={profile.status} />}
                </div>
                <div className={css({ display: 'flex', alignItems: 'flex-start', gap: '3' })}>
                    <ProfileIdentity profile={profile} />
                    {!isOwner && <ShareButton profile={profile} />}
                </div>
                {isOwner && (
                    <div className={css({ display: 'flex', gap: '2', alignItems: 'center' })}>
                        <button
                            type="button"
                            className={profileButton({ tone: 'primary', size: 'lg', grow: true })}
                            onClick={onEdit}
                            disabled={editPending}
                        >
                            <PencilIcon />
                            {editPending ? '読み込み中...' : '編集'}
                        </button>
                        <ShareButton profile={profile} />
                    </div>
                )}
                <ProfileAbout bio={profile.bio} />
                <ProfileLinkButtons links={profile.links} />
                <ProfileLanguageChips languages={profile.languages} />
                <ProfileFieldsTable fields={profile.fields} />
            </div>
        </article>
    );
}

// 狭い画面で札とボタンが重ならないよう、左右に分けた 1 行にする（入りきらなければ札の側が折り返す）
const bannerBar = css({
    position: 'absolute',
    top: '3',
    left: '3',
    right: '3',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '2',
});
