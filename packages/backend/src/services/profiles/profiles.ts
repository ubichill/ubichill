import {
    type ProfileImageKind,
    type ProfileUpdate,
    ProfileUpdateSchema,
    type PublicRole,
    profileImagePath,
    type StoredProfileFields,
    type UserProfile,
    userProfileOf,
} from '@ubichill/shared';
import { JobGateFullError } from '../../utils/jobGate';
import type { ImageStore, StoredImage } from './images/imageStore';
import type { ImageRejectionCode, ProcessImageResult } from './images/processImage';

/** プロフィールの読み書きに使う users の操作（@ubichill/db の userRepository）。 */
export interface ProfileUserStore {
    findById(id: string): Promise<StoredProfileFields | undefined>;
    setProfile(id: string, profile: ProfileUpdate): Promise<StoredProfileFields | undefined>;
    setProfileImageUrl(
        id: string,
        kind: ProfileImageKind,
        url: string | null,
    ): Promise<StoredProfileFields | undefined>;
}

export interface ProfileServiceDeps {
    users: ProfileUserStore;
    images: ImageStore;
    /** 送られた画像を作り直す（同時に走らせる数の制限込み。混んでいれば JobGateFullError）。 */
    processImage: (input: Uint8Array, kind: ProfileImageKind) => Promise<ProcessImageResult>;
    /** 配信する URL の基点（PUBLIC_BASE_URL） */
    publicBaseUrl: string;
    /** 作者アカウント `handle@domain` */
    authorOf: (handle: string) => string;
    /** プロフィールに出すロール */
    publicRolesOf: (userId: string) => Promise<PublicRole[]>;
}

export type ProfileErrorCode = 'invalid' | 'not-found' | 'busy' | ImageRejectionCode;

export type ProfileOutcome =
    | { ok: true; profile: UserProfile }
    | { ok: false; status: number; code: ProfileErrorCode; error: string };

const IMAGE_REJECTION_STATUS: Readonly<Record<ImageRejectionCode, number>> = {
    empty: 400,
    'too-large': 413,
    unsupported: 415,
    'too-many-pixels': 422,
    undecodable: 422,
};

const notFound: ProfileOutcome = { ok: false, status: 404, code: 'not-found', error: 'User not found' };

/** プロフィールの更新とアップロードした画像の置き換え。HTTP の形には依存しない（routes/profiles.ts が対応付ける）。 */
export function createProfileService(deps: ProfileServiceDeps) {
    const baseUrl = deps.publicBaseUrl.replace(/\/+$/, '');
    const imageUrl = (userId: string, kind: ProfileImageKind, hash: string): string =>
        `${baseUrl}${profileImagePath(userId, kind, hash)}`;
    const outcomeOf = async (user: StoredProfileFields | undefined): Promise<ProfileOutcome> =>
        user
            ? { ok: true, profile: userProfileOf(user, deps.authorOf(user.handle), await deps.publicRolesOf(user.id)) }
            : notFound;

    return {
        imageUrl,

        async update(userId: string, body: unknown): Promise<ProfileOutcome> {
            const parsed = ProfileUpdateSchema.safeParse(body);
            if (!parsed.success) {
                const issue = parsed.error.issues[0];
                return {
                    ok: false,
                    status: 400,
                    code: 'invalid',
                    error: issue ? `${issue.path.join('.')}: ${issue.message}`.replace(/^: /, '') : '入力が不正です',
                };
            }
            return outcomeOf(await deps.users.setProfile(userId, parsed.data));
        },

        /** 画像を作り直して置き換える。送られたバイト列はそのまま保存しない。 */
        async replaceImage(userId: string, kind: ProfileImageKind, input: Uint8Array): Promise<ProfileOutcome> {
            if (!(await deps.users.findById(userId))) return notFound;
            const processed = await deps.processImage(input, kind).catch((err: unknown) => {
                if (err instanceof JobGateFullError) return null;
                throw err;
            });
            if (!processed) {
                return {
                    ok: false,
                    status: 503,
                    code: 'busy',
                    error: '画像の処理が混み合っています。少し待ってから試してください',
                };
            }
            if (!processed.ok) {
                return {
                    ok: false,
                    status: IMAGE_REJECTION_STATUS[processed.code],
                    code: processed.code,
                    error: processed.message,
                };
            }
            // 中身を先に置く（URL を先に変えると、置き終わるまで新しい URL が 404 になる）
            await deps.images.put(userId, kind, processed.image);
            return outcomeOf(
                await deps.users.setProfileImageUrl(userId, kind, imageUrl(userId, kind, processed.image.hash)),
            );
        },

        /** 画像を外す。アイコンは OAuth で入った外部の URL でも外す（既定の表示に戻る）。 */
        async removeImage(userId: string, kind: ProfileImageKind): Promise<ProfileOutcome> {
            const user = await deps.users.setProfileImageUrl(userId, kind, null);
            if (!user) return notFound;
            await deps.images.remove(userId, kind);
            return outcomeOf(user);
        },

        image(userId: string, kind: ProfileImageKind, hash: string): Promise<StoredImage | undefined> {
            return deps.images.get(userId, kind, hash);
        },
    };
}

export type ProfileService = ReturnType<typeof createProfileService>;
