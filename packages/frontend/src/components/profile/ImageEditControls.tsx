import type { ProfileImageKind } from '@ubichill/shared';
import { PROFILE_IMAGE_ACCEPT } from '@/lib/profile/imageFile';
import type { ImageDraft } from '@/lib/profile/profileDraft';
import { css } from '@/styled-system/css';
import { CameraIcon, TrashIcon, UndoIcon } from './profileIcons';
import { roundIconButton } from './profileStyles';

const KIND_LABELS: Readonly<Record<ProfileImageKind, string>> = { avatar: 'アイコン', banner: 'バナー' };

const overlay = css({
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1.5',
    bg: 'hudBg',
    borderRadius: 'inherit',
});

/** 画像の上に重ねる編集の操作（選ぶ・外す・元に戻す）。選んだ画像はその場でプレビューする。 */
export function ImageEditControls({
    kind,
    image,
    hasCurrent,
    disabled,
    onChoose,
    onRemove,
    onRevert,
}: {
    kind: ProfileImageKind;
    image: ImageDraft;
    /** 今のプロフィールに画像がある（無ければ「外す」を出さない） */
    hasCurrent: boolean;
    disabled: boolean;
    onChoose: (file: File) => void;
    onRemove: () => void;
    onRevert: () => void;
}) {
    const label = KIND_LABELS[kind];
    // アイコンは小さいので、操作も小さくして重ならないようにする
    const button = roundIconButton({ tone: 'overlay', size: kind === 'avatar' ? 'sm' : 'md' });
    const iconSize = kind === 'avatar' ? 15 : 18;
    return (
        <div className={overlay}>
            <label className={button} title={`${label}を選ぶ`} aria-disabled={disabled}>
                <input
                    type="file"
                    accept={PROFILE_IMAGE_ACCEPT}
                    disabled={disabled}
                    aria-label={`${label}を選ぶ`}
                    className={css({ srOnly: true })}
                    onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        // 同じファイルをもう一度選んでも変更として届くように空にする
                        e.currentTarget.value = '';
                        if (file) onChoose(file);
                    }}
                />
                <CameraIcon size={iconSize} />
            </label>
            {image.action === 'keep' ? (
                hasCurrent && (
                    <button
                        type="button"
                        className={button}
                        aria-label={`${label}を外す`}
                        title={`${label}を外す`}
                        disabled={disabled}
                        onClick={onRemove}
                    >
                        <TrashIcon size={iconSize} />
                    </button>
                )
            ) : (
                <button
                    type="button"
                    className={button}
                    aria-label={`${label}の変更をやめる`}
                    title={`${label}の変更をやめる`}
                    disabled={disabled}
                    onClick={onRevert}
                >
                    <UndoIcon size={iconSize} />
                </button>
            )}
        </div>
    );
}
