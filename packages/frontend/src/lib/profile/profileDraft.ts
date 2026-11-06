/**
 * プロフィールの編集中の値（下書き）と、その判定。画面の状態の移り変わりはここの reducer だけで行う。
 * 判定は API と同じ shared のスキーマを使う（画面で通ったものが API で断られないように）。
 */
import {
    BIO_MAX_LENGTH,
    BioSchema,
    bioLength,
    MAX_PROFILE_LANGUAGES,
    MAX_PROFILE_LINKS,
    PROFILE_IMAGE_KINDS,
    PROFILE_STATUS_MAX_LENGTH,
    type ProfileImageKind,
    type ProfileLanguageCode,
    ProfileLinksSchema,
    ProfileStatusSchema,
    type ProfileUpdateInput,
    profileStatusLength,
    type UserProfile,
} from '@ubichill/shared';

/** 画像の編集: そのまま・選んだファイルに置き換える・外す。 */
export type ImageDraft =
    | { action: 'keep' }
    | { action: 'replace'; file: Blob; previewUrl: string }
    | { action: 'remove' };

export interface ProfileDraft {
    name: string;
    status: string;
    bio: string;
    /** 入力欄の並び（空の欄も含む。保存するときに空の欄は捨てる） */
    links: string[];
    languages: ProfileLanguageCode[];
    images: Record<ProfileImageKind, ImageDraft>;
}

export type ProfileDraftAction =
    | { type: 'setName'; value: string }
    | { type: 'setStatus'; value: string }
    | { type: 'setBio'; value: string }
    | { type: 'addLink' }
    | { type: 'setLink'; index: number; value: string }
    | { type: 'removeLink'; index: number }
    | { type: 'toggleLanguage'; code: ProfileLanguageCode }
    | { type: 'replaceImage'; kind: ProfileImageKind; file: Blob; previewUrl: string }
    | { type: 'removeImage'; kind: ProfileImageKind }
    | { type: 'keepImage'; kind: ProfileImageKind }
    | { type: 'reset'; profile: UserProfile };

const KEEP: ImageDraft = { action: 'keep' };

export function draftOf(profile: UserProfile): ProfileDraft {
    return {
        name: profile.name,
        status: profile.status ?? '',
        bio: profile.bio ?? '',
        links: profile.links.map((l) => l.url),
        languages: [...profile.languages],
        images: { avatar: KEEP, banner: KEEP },
    };
}

const inRange = (list: readonly unknown[], index: number): boolean =>
    Number.isInteger(index) && index >= 0 && index < list.length;

export function profileDraftReducer(state: ProfileDraft, action: ProfileDraftAction): ProfileDraft {
    switch (action.type) {
        case 'setName':
            return { ...state, name: action.value };
        case 'setStatus':
            return { ...state, status: action.value };
        case 'setBio':
            return { ...state, bio: action.value };
        case 'addLink':
            return state.links.length >= MAX_PROFILE_LINKS ? state : { ...state, links: [...state.links, ''] };
        case 'setLink':
            return inRange(state.links, action.index)
                ? { ...state, links: state.links.map((l, i) => (i === action.index ? action.value : l)) }
                : state;
        case 'removeLink':
            return inRange(state.links, action.index)
                ? { ...state, links: state.links.filter((_, i) => i !== action.index) }
                : state;
        case 'toggleLanguage': {
            if (state.languages.includes(action.code)) {
                return { ...state, languages: state.languages.filter((c) => c !== action.code) };
            }
            return state.languages.length >= MAX_PROFILE_LANGUAGES
                ? state
                : { ...state, languages: [...state.languages, action.code] };
        }
        case 'replaceImage':
            return {
                ...state,
                images: {
                    ...state.images,
                    [action.kind]: { action: 'replace', file: action.file, previewUrl: action.previewUrl },
                },
            };
        case 'removeImage':
            return { ...state, images: { ...state.images, [action.kind]: { action: 'remove' } } };
        case 'keepImage':
            return { ...state, images: { ...state.images, [action.kind]: KEEP } };
        case 'reset':
            return draftOf(action.profile);
    }
}

/** 下書きの中で、選んだ画像のプレビュー用の URL。 */
const previewUrlsOf = (draft: ProfileDraft): string[] =>
    PROFILE_IMAGE_KINDS.flatMap((kind) => {
        const image = draft.images[kind];
        return image.action === 'replace' ? [image.previewUrl] : [];
    });

/** 下書きが変わって使わなくなったプレビューの URL（`URL.revokeObjectURL` で捨てる）。 */
export function previewUrlsToRevoke(previous: ProfileDraft, next: ProfileDraft | null): string[] {
    const kept = new Set(next ? previewUrlsOf(next) : []);
    return previewUrlsOf(previous).filter((url) => !kept.has(url));
}

/** 画面に出す画像（選んだファイルのプレビュー・外すなら無し・そのままなら今の画像）。 */
export function imageShownFor(current: string | null, image: ImageDraft): string | null {
    if (image.action === 'replace') return image.previewUrl;
    if (image.action === 'remove') return null;
    return current;
}

export interface DraftProblems {
    status: string | null;
    bio: string | null;
    /** 入力欄ごと（空の欄は問題にしない） */
    links: Array<string | null>;
}

const firstIssue = (result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string | null =>
    result.success ? null : (result.error?.issues[0]?.message ?? '入力が不正です');

const filledLinkIndexes = (links: readonly string[]): number[] => links.flatMap((l, i) => (l.trim() ? [i] : []));

/** 下書きの問題（保存できない理由）。表示名は空きの確認が要るので別に判定する。 */
export function draftProblems(draft: ProfileDraft): DraftProblems {
    const filled = filledLinkIndexes(draft.links);
    const links = ProfileLinksSchema.safeParse(filled.map((i) => draft.links[i]));
    const linkIssues = new Map(
        (links.success ? [] : links.error.issues).map((issue) => [filled[Number(issue.path[0])], issue.message]),
    );
    return {
        status: firstIssue(ProfileStatusSchema.safeParse(draft.status)),
        bio: firstIssue(BioSchema.safeParse(draft.bio)),
        links: draft.links.map((_, i) => linkIssues.get(i) ?? null),
    };
}

export const hasProblems = (problems: DraftProblems): boolean =>
    !!problems.status || !!problems.bio || problems.links.some(Boolean);

/** 文字数のカウンタ（API と同じ数え方）。 */
export function draftCounters(draft: ProfileDraft) {
    return {
        status: { length: profileStatusLength(draft.status), max: PROFILE_STATUS_MAX_LENGTH },
        bio: { length: bioLength(draft.bio), max: BIO_MAX_LENGTH },
    };
}

export interface DraftChanges {
    /** 変える表示名（変えなければ null） */
    name: string | null;
    /** `PUT /me/profile` に送る本文（ひとこと・自己紹介・リンク・言語のどれも変わらなければ null） */
    fields: ProfileUpdateInput | null;
    images: Array<{ kind: ProfileImageKind; image: Exclude<ImageDraft, { action: 'keep' }> }>;
}

const imageUrlOf = (profile: UserProfile, kind: ProfileImageKind): string | null =>
    kind === 'avatar' ? profile.image : profile.bannerImage;

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((v, i) => v === b[i]);

/** 今のプロフィールと下書きの差（保存で送るもの）。保存される形どうしで比べる（前後の空白だけの違いは変更にしない）。 */
export function draftChanges(profile: UserProfile, draft: ProfileDraft): DraftChanges {
    const links = filledLinkIndexes(draft.links).map((i) => draft.links[i].trim());
    const status = ProfileStatusSchema.safeParse(draft.status);
    const bio = BioSchema.safeParse(draft.bio);
    const parsedLinks = ProfileLinksSchema.safeParse(links);
    const fieldsChanged =
        !status.success ||
        status.data !== profile.status ||
        !bio.success ||
        bio.data !== profile.bio ||
        !parsedLinks.success ||
        !sameList(
            parsedLinks.data,
            profile.links.map((l) => l.url),
        ) ||
        !sameList(draft.languages, profile.languages);
    const name = draft.name.trim();
    return {
        name: name !== profile.name ? name : null,
        fields: fieldsChanged ? { status: draft.status, bio: draft.bio, links, languages: draft.languages } : null,
        images: PROFILE_IMAGE_KINDS.flatMap((kind) => {
            const image = draft.images[kind];
            if (image.action === 'keep') return [];
            // 画像が無いのに「外す」は何もしない
            if (image.action === 'remove' && !imageUrlOf(profile, kind)) return [];
            return [{ kind, image }];
        }),
    };
}

export const hasChanges = (changes: DraftChanges): boolean =>
    changes.name !== null || changes.fields !== null || changes.images.length > 0;

/** 保存の途中で失敗したとき、すでに保存できた画像（URL が変わったもの）。下書きを「そのまま」に戻して送り直さない。 */
export function changedImageKinds(before: UserProfile, after: UserProfile): ProfileImageKind[] {
    return PROFILE_IMAGE_KINDS.filter((kind) => imageUrlOf(before, kind) !== imageUrlOf(after, kind));
}
