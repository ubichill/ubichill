import type { ProfileImageKind, UserProfile } from '@ubichill/shared';
import type { MyAccount } from '@/lib/account/me';
import { useDisplayNameAvailability } from '@/lib/account/useHandleAvailability';
import { canSaveDisplayName, checkDisplayName } from '@/lib/profile/displayNameCheck';
import { imageShownFor } from '@/lib/profile/profileDraft';
import { css } from '@/styled-system/css';
import { CountedTextField } from './CountedTextField';
import { DisplayNameField } from './DisplayNameField';
import { ImageEditControls } from './ImageEditControls';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileBanner } from './ProfileBanner';
import { ProfileLanguagePicker } from './ProfileLanguagePicker';
import { ProfileLinksEditor } from './ProfileLinksEditor';
import { avatarRow, fieldHint, profileBody, profileButton, profileCard } from './profileStyles';
import { StatusPill } from './StatusPill';
import { useProfileEditor } from './useProfileEditor';

const errorBox = css({ px: '3', py: '2', bg: 'errorBg', color: 'errorText', borderRadius: '10px', fontSize: '13px' });

/**
 * プロフィールの編集（表示と同じ場所・同じ骨組みで、各項目を入力に置き換える）。
 * 保存・キャンセルするまでサーバーには送らない。画像は選んだ時点ではプレビューだけ。
 */
export function ProfileEditor({
    account,
    onSaved,
    onCancel,
}: {
    account: MyAccount;
    onSaved: (profile: UserProfile) => void;
    /** やめる。途中まで保存できていれば、その内容を渡す（表示を合わせる） */
    onCancel: (latest: UserProfile) => void;
}) {
    const editor = useProfileEditor(account);
    const { draft, baseline, dispatch, saving } = editor;
    const nameChanged = draft.name.trim() !== baseline.name;
    const availability = useDisplayNameAvailability(draft.name, nameChanged);
    const nameCheck = checkDisplayName({
        current: baseline.name,
        conflict: account.displayNameConflict,
        availableAt: account.displayNameChangeAvailableAt,
        value: draft.name,
        availability,
        now: new Date(),
    });
    const canSave = editor.changed && !editor.invalid && canSaveDisplayName(nameCheck) && !saving;
    const imageControls = (kind: ProfileImageKind) => (
        <ImageEditControls
            kind={kind}
            image={draft.images[kind]}
            hasCurrent={!!(kind === 'avatar' ? baseline.image : baseline.bannerImage)}
            disabled={saving}
            onChoose={(file) => editor.chooseImage(kind, file)}
            onRemove={() => dispatch({ type: 'removeImage', kind })}
            onRevert={() => dispatch({ type: 'keepImage', kind })}
        />
    );
    const save = async () => {
        const saved = await editor.save();
        if (saved) onSaved(saved);
    };

    return (
        <article className={profileCard} aria-label="プロフィールを編集">
            <ProfileBanner src={imageShownFor(baseline.bannerImage, draft.images.banner)}>
                {imageControls('banner')}
            </ProfileBanner>
            <div className={profileBody}>
                <div className={avatarRow}>
                    <ProfileAvatar
                        src={imageShownFor(baseline.image, draft.images.avatar)}
                        name={draft.name.trim() || baseline.name}
                    >
                        {imageControls('avatar')}
                    </ProfileAvatar>
                    {draft.status.trim() && <StatusPill status={draft.status.trim()} />}
                </div>
                {editor.imageError && (
                    <p className={errorBox}>
                        {editor.imageError.kind === 'avatar' ? 'アイコン' : 'バナー'}: {editor.imageError.message}
                    </p>
                )}
                <p className={fieldHint()}>
                    アイコンは正方形、バナーは横 3 : 縦 1
                    に中央で切り抜かれます。位置情報などの画像の情報は保存しません。
                </p>
                <DisplayNameField
                    value={draft.name}
                    current={baseline.name}
                    conflict={account.displayNameConflict}
                    check={nameCheck}
                    disabled={saving}
                    onChange={(value) => dispatch({ type: 'setName', value })}
                />
                <p className={fieldHint()}>ID（@{baseline.handle}）は変更できません。</p>
                <CountedTextField
                    label="ひとこと"
                    value={draft.status}
                    length={editor.counters.status.length}
                    max={editor.counters.status.max}
                    problem={editor.problems.status}
                    placeholder="いまの状態をひとことで（例: ワールド制作中）"
                    disabled={saving}
                    onChange={(value) => dispatch({ type: 'setStatus', value })}
                />
                <CountedTextField
                    label="自己紹介"
                    value={draft.bio}
                    length={editor.counters.bio.length}
                    max={editor.counters.bio.max}
                    problem={editor.problems.bio}
                    placeholder="どんなワールドを作っているか、好きなことなど"
                    multiline
                    disabled={saving}
                    onChange={(value) => dispatch({ type: 'setBio', value })}
                />
                <ProfileLinksEditor
                    links={draft.links}
                    problems={editor.problems.links}
                    disabled={saving}
                    dispatch={dispatch}
                />
                <ProfileLanguagePicker
                    selected={draft.languages}
                    disabled={saving}
                    onToggle={(code) => dispatch({ type: 'toggleLanguage', code })}
                />
                {editor.error && (
                    <p className={errorBox} role="alert">
                        {editor.error}
                    </p>
                )}
                <div className={css({ display: 'flex', gap: '2', justifyContent: 'flex-end', flexWrap: 'wrap' })}>
                    <button
                        type="button"
                        className={profileButton({ size: 'lg' })}
                        disabled={saving}
                        onClick={() => onCancel(baseline)}
                    >
                        キャンセル
                    </button>
                    <button
                        type="button"
                        className={profileButton({ tone: 'primary', size: 'lg' })}
                        disabled={!canSave}
                        onClick={() => void save()}
                    >
                        {saving ? '保存しています...' : '保存'}
                    </button>
                </div>
            </div>
        </article>
    );
}
