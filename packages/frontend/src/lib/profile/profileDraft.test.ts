import {
    MAX_PROFILE_LANGUAGES,
    MAX_PROFILE_LINKS,
    PROFILE_LANGUAGES,
    PROFILE_STATUS_MAX_LENGTH,
    type UserProfile,
} from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    changedImageKinds,
    draftChanges,
    draftCounters,
    draftOf,
    draftProblems,
    hasChanges,
    hasProblems,
    imageShownFor,
    type ProfileDraft,
    type ProfileDraftAction,
    previewUrlsToRevoke,
    profileDraftReducer,
} from './profileDraft';

const profile: UserProfile = {
    id: 'u1',
    name: 'ようかん',
    handle: 'youkan',
    author: 'youkan@ubichill.example',
    image: 'https://ubichill.example/a.webp',
    bio: 'よろしく',
    status: '制作中',
    bannerImage: null,
    links: [{ url: 'https://github.com/youkan', kind: 'github' }],
    languages: ['ja'],
    roles: [],
};

const apply = (actions: ProfileDraftAction[], from: ProfileDraft = draftOf(profile)) =>
    actions.reduce(profileDraftReducer, from);
const file = new Blob(['x'], { type: 'image/png' });

describe('profileDraftReducer', () => {
    it('今のプロフィールから始め、reset で捨てられる', () => {
        const draft = draftOf(profile);
        expect(draft).toMatchObject({
            name: 'ようかん',
            status: '制作中',
            bio: 'よろしく',
            links: ['https://github.com/youkan'],
        });
        expect(
            apply([
                { type: 'setStatus', value: 'x' },
                { type: 'reset', profile },
            ]),
        ).toEqual(draft);
    });

    it('書いていない項目は空の入力から始める', () => {
        expect(draftOf({ ...profile, status: null, bio: null, links: [], languages: [] })).toMatchObject({
            status: '',
            bio: '',
            links: [],
            languages: [],
        });
    });

    it(`リンクの欄は ${MAX_PROFILE_LINKS} 個より増やさない`, () => {
        const many = apply(Array.from({ length: MAX_PROFILE_LINKS + 3 }, () => ({ type: 'addLink' as const })));
        expect(many.links).toHaveLength(MAX_PROFILE_LINKS);
    });

    it('範囲外・整数でない位置のリンクの変更・削除は何もしない', () => {
        const draft = draftOf(profile);
        for (const index of [-1, 1, 99, 0.5, Number.NaN]) {
            expect(profileDraftReducer(draft, { type: 'setLink', index, value: 'x' })).toBe(draft);
            expect(profileDraftReducer(draft, { type: 'removeLink', index })).toBe(draft);
        }
    });

    it('リンクを書き換え・消せる（ほかの欄は動かない）', () => {
        const draft = apply([
            { type: 'addLink' },
            { type: 'setLink', index: 1, value: 'x.com/a' },
            { type: 'addLink' },
            { type: 'setLink', index: 2, value: 'bsky.app/b' },
            { type: 'removeLink', index: 0 },
        ]);
        expect(draft.links).toEqual(['x.com/a', 'bsky.app/b']);
    });

    it(`言語は選んだ順に ${MAX_PROFILE_LANGUAGES} 件まで。もう一度押すと外れる`, () => {
        const codes = PROFILE_LANGUAGES.map((l) => l.code).filter((c) => c !== 'ja');
        const draft = apply(codes.map((code) => ({ type: 'toggleLanguage' as const, code })));
        expect(draft.languages).toEqual(['ja', ...codes.slice(0, MAX_PROFILE_LANGUAGES - 1)]);
        expect(apply([{ type: 'toggleLanguage', code: 'ja' }], draft).languages).not.toContain('ja');
        // 上限で止まっていても、外すことはできる
        expect(apply([{ type: 'toggleLanguage', code: codes[0] }], draft).languages).toHaveLength(
            MAX_PROFILE_LANGUAGES - 1,
        );
    });

    it('画像は置き換え・外す・やめる（そのまま）を切り替えられ、種類ごとに独立している', () => {
        const replaced = apply([{ type: 'replaceImage', kind: 'banner', file, previewUrl: 'blob:b1' }]);
        expect(replaced.images).toEqual({
            avatar: { action: 'keep' },
            banner: { action: 'replace', file, previewUrl: 'blob:b1' },
        });
        expect(apply([{ type: 'removeImage', kind: 'avatar' }], replaced).images.banner.action).toBe('replace');
        expect(apply([{ type: 'keepImage', kind: 'banner' }], replaced).images.banner).toEqual({ action: 'keep' });
    });
});

describe('previewUrlsToRevoke（使わなくなったプレビューを捨てる）', () => {
    it('置き換え直す・外す・やめる・編集をやめると、前のプレビューを捨てる', () => {
        const first = apply([{ type: 'replaceImage', kind: 'avatar', file, previewUrl: 'blob:a1' }]);
        const second = apply([{ type: 'replaceImage', kind: 'avatar', file, previewUrl: 'blob:a2' }], first);
        expect(previewUrlsToRevoke(first, second)).toEqual(['blob:a1']);
        expect(previewUrlsToRevoke(second, apply([{ type: 'removeImage', kind: 'avatar' }], second))).toEqual([
            'blob:a2',
        ]);
        expect(previewUrlsToRevoke(second, null)).toEqual(['blob:a2']);
    });

    it('ほかの項目を変えただけなら捨てない', () => {
        const draft = apply([{ type: 'replaceImage', kind: 'banner', file, previewUrl: 'blob:b1' }]);
        expect(previewUrlsToRevoke(draft, apply([{ type: 'setBio', value: 'x' }], draft))).toEqual([]);
    });
});

describe('imageShownFor', () => {
    it('選んだらプレビュー・外すなら無し・そのままなら今の画像', () => {
        expect(imageShownFor('https://a', { action: 'keep' })).toBe('https://a');
        expect(imageShownFor('https://a', { action: 'remove' })).toBeNull();
        expect(imageShownFor(null, { action: 'replace', file, previewUrl: 'blob:x' })).toBe('blob:x');
    });
});

describe('draftProblems', () => {
    it('問題がなければ保存できる', () => {
        expect(hasProblems(draftProblems(draftOf(profile)))).toBe(false);
    });

    it('ひとことの改行・文字数超え、自己紹介の文字数超えを API と同じ規則で見つける', () => {
        const problems = draftProblems(
            apply([
                { type: 'setStatus', value: 'a'.repeat(PROFILE_STATUS_MAX_LENGTH + 1) },
                { type: 'setBio', value: 'x'.repeat(301) },
            ]),
        );
        expect(problems.status).toBeTruthy();
        expect(problems.bio).toBeTruthy();
        expect(draftProblems(apply([{ type: 'setStatus', value: 'a\nb' }])).status).toBeTruthy();
    });

    it('空の欄は問題にせず、悪いリンクの欄を正しく指す（空の欄を挟んでもずれない）', () => {
        const problems = draftProblems(
            apply([
                { type: 'addLink' },
                { type: 'addLink' },
                { type: 'setLink', index: 2, value: 'javascript:alert(1)' },
            ]),
        );
        expect(problems.links).toEqual([null, null, expect.any(String)]);
    });

    it('正規化すると同じになるリンクは、後の欄を重複として指す', () => {
        const problems = draftProblems(
            apply([{ type: 'addLink' }, { type: 'setLink', index: 1, value: 'GITHUB.com/youkan' }]),
        );
        expect(problems.links[0]).toBeNull();
        expect(problems.links[1]).toMatch(/2 回/);
    });
});

describe('draftChanges（保存で送るもの）', () => {
    it('何も変えなければ何も送らない（前後の空白・空の欄だけの違いも変更にしない）', () => {
        const draft = apply([
            { type: 'setStatus', value: '  制作中 ' },
            { type: 'setName', value: ' ようかん ' },
            { type: 'addLink' },
            { type: 'setLink', index: 0, value: 'github.com/youkan' },
        ]);
        expect(hasChanges(draftChanges(profile, draft))).toBe(false);
    });

    it('変えた項目だけを送る。プロフィールの項目はまとめて置き換える', () => {
        const changes = draftChanges(
            profile,
            apply([
                { type: 'setName', value: 'ようかん2' },
                { type: 'toggleLanguage', code: 'en' },
            ]),
        );
        expect(changes.name).toBe('ようかん2');
        expect(changes.fields).toEqual({
            status: '制作中',
            bio: 'よろしく',
            links: ['https://github.com/youkan'],
            languages: ['ja', 'en'],
        });
        expect(changes.images).toEqual([]);
    });

    it('並べ替えた言語は変更として送る', () => {
        const swapped = apply([
            { type: 'toggleLanguage', code: 'en' },
            { type: 'toggleLanguage', code: 'ja' },
            { type: 'toggleLanguage', code: 'ja' },
        ]);
        expect(swapped.languages).toEqual(['en', 'ja']);
        expect(draftChanges(profile, swapped).fields?.languages).toEqual(['en', 'ja']);
    });

    it('空にした自己紹介は変更として送る（書いていない状態に戻す）', () => {
        expect(draftChanges(profile, apply([{ type: 'setBio', value: '   ' }])).fields?.bio).toBe('   ');
    });

    it('画像の置き換え・外すを送る。もともと無い画像を外すのは送らない', () => {
        const changes = draftChanges(
            profile,
            apply([
                { type: 'replaceImage', kind: 'avatar', file, previewUrl: 'blob:a' },
                { type: 'removeImage', kind: 'banner' },
            ]),
        );
        expect(changes.images).toEqual([{ kind: 'avatar', image: { action: 'replace', file, previewUrl: 'blob:a' } }]);
        expect(
            draftChanges(profile, apply([{ type: 'removeImage', kind: 'avatar' }])).images.map((i) => i.kind),
        ).toEqual(['avatar']);
    });
});

describe('draftCounters', () => {
    it('API と同じ数え方（サロゲートペアは 1 文字・前後の空白は数えない）', () => {
        expect(
            draftCounters(
                apply([
                    { type: 'setStatus', value: ' 𠮷𠮷 ' },
                    { type: 'setBio', value: '\r\n𠮷\r\n' },
                ]),
            ),
        ).toEqual({
            status: { length: 2, max: PROFILE_STATUS_MAX_LENGTH },
            bio: { length: 1, max: 300 },
        });
    });
});

describe('changedImageKinds（途中で失敗したときに保存できていた画像）', () => {
    it('URL が変わった種類だけ（置き換え・外す）', () => {
        expect(changedImageKinds(profile, profile)).toEqual([]);
        expect(changedImageKinds(profile, { ...profile, image: null })).toEqual(['avatar']);
        expect(changedImageKinds(profile, { ...profile, bannerImage: 'https://ubichill.example/b.webp' })).toEqual([
            'banner',
        ]);
    });
});
