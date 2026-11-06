import type { ProfileImageKind, UserProfile } from '@ubichill/shared';
import { useEffect, useReducer, useRef, useState } from 'react';
import { imageFileProblem } from '@/lib/profile/imageFile';
import { profileSaveApi } from '@/lib/profile/profileApi';
import {
    changedImageKinds,
    draftChanges,
    draftCounters,
    draftOf,
    draftProblems,
    hasChanges,
    hasProblems,
    previewUrlsToRevoke,
    profileDraftReducer,
} from '@/lib/profile/profileDraft';
import { saveProfileDraft } from '@/lib/profile/saveProfileDraft';

/**
 * プロフィールの編集（下書き・保存）。状態の移り変わりは lib/profile/profileDraft の reducer、
 * 保存の手順は saveProfileDraft にあり、ここは React の状態とプレビューの URL の後始末だけを持つ。
 */
export function useProfileEditor(initial: UserProfile) {
    const [baseline, setBaseline] = useState(initial);
    const [draft, dispatch] = useReducer(profileDraftReducer, initial, draftOf);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [imageError, setImageError] = useState<{ kind: ProfileImageKind; message: string } | null>(null);
    const shown = useRef(draft);

    useEffect(() => {
        for (const url of previewUrlsToRevoke(shown.current, draft)) URL.revokeObjectURL(url);
        shown.current = draft;
    }, [draft]);
    useEffect(
        () => () => {
            for (const url of previewUrlsToRevoke(shown.current, null)) URL.revokeObjectURL(url);
        },
        [],
    );

    const chooseImage = (kind: ProfileImageKind, file: File) => {
        const problem = imageFileProblem(file);
        setImageError(problem ? { kind, message: problem } : null);
        if (!problem) dispatch({ type: 'replaceImage', kind, file, previewUrl: URL.createObjectURL(file) });
    };

    const changes = draftChanges(baseline, draft);
    const problems = draftProblems(draft);

    /** 保存できたら保存後のプロフィールを返す。失敗したら下書きを残し、保存できた分だけ元の値を進める。 */
    const save = async (): Promise<UserProfile | null> => {
        setSaving(true);
        setError('');
        const result = await saveProfileDraft(baseline, changes, profileSaveApi);
        setSaving(false);
        if (result.ok) return result.profile;
        for (const kind of changedImageKinds(baseline, result.profile)) dispatch({ type: 'keepImage', kind });
        setBaseline(result.profile);
        setError(result.error);
        return null;
    };

    return {
        baseline,
        draft,
        dispatch,
        chooseImage,
        imageError,
        problems,
        counters: draftCounters(draft),
        changed: hasChanges(changes),
        invalid: hasProblems(problems),
        saving,
        error,
        save,
    };
}

export type ProfileEditorState = ReturnType<typeof useProfileEditor>;
