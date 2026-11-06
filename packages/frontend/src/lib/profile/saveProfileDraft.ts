import type { ProfileImageKind, ProfileUpdateInput, UserProfile } from '@ubichill/shared';
import type { DraftChanges } from './profileDraft';

/** 保存に使う API（画面の外の副作用。テストでは偽物を渡す）。 */
export interface ProfileSaveApi {
    setDisplayName(name: string): Promise<{ name: string }>;
    saveProfile(fields: ProfileUpdateInput): Promise<UserProfile>;
    uploadImage(kind: ProfileImageKind, file: Blob): Promise<UserProfile>;
    deleteImage(kind: ProfileImageKind): Promise<UserProfile>;
}

export type SaveProfileResult =
    | { ok: true; profile: UserProfile }
    /** 途中で失敗した。`profile` はそこまでに保存できた内容（下書きは残して、直してもう一度保存できるようにする） */
    | { ok: false; profile: UserProfile; error: string };

interface SaveStep {
    label: string;
    run: (current: UserProfile) => Promise<UserProfile>;
}

const IMAGE_LABELS: Readonly<Record<ProfileImageKind, string>> = { avatar: 'アイコン', banner: 'バナー' };

/** 送る順に並べる。表示名は一意で断られやすいので最初に送り、断られたら残りを送らない。 */
function stepsOf(changes: DraftChanges, api: ProfileSaveApi): SaveStep[] {
    const name = changes.name;
    const fields = changes.fields;
    return [
        ...(name !== null
            ? [
                  {
                      label: '表示名',
                      run: async (p: UserProfile) => ({ ...p, name: (await api.setDisplayName(name)).name }),
                  },
              ]
            : []),
        ...changes.images.map(({ kind, image }) => ({
            label: IMAGE_LABELS[kind],
            run: () => (image.action === 'replace' ? api.uploadImage(kind, image.file) : api.deleteImage(kind)),
        })),
        ...(fields ? [{ label: 'プロフィール', run: () => api.saveProfile(fields) }] : []),
    ];
}

/** 下書きの変更を順に保存する。1 つでも失敗したらそこで止め、それまでに保存できた内容と理由を返す。 */
export function saveProfileDraft(
    profile: UserProfile,
    changes: DraftChanges,
    api: ProfileSaveApi,
): Promise<SaveProfileResult> {
    return stepsOf(changes, api).reduce<Promise<SaveProfileResult>>(
        async (previous, step) => {
            const result = await previous;
            if (!result.ok) return result;
            try {
                return { ok: true, profile: await step.run(result.profile) };
            } catch (e) {
                const reason = e instanceof Error ? e.message : '保存できませんでした';
                return { ok: false, profile: result.profile, error: `${step.label}を保存できませんでした: ${reason}` };
            }
        },
        Promise.resolve({ ok: true, profile }),
    );
}
