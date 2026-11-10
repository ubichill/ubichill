import { describe, expect, it } from 'vitest';
import {
    PROFILE_STATUS_MAX_LENGTH,
    ProfileStatusSchema,
    ProfileUpdateSchema,
    profileImageHashOf,
    profileImagePath,
    profileStatusLength,
    userProfileOf,
} from './profile';
import {
    MAX_PROFILE_LANGUAGES,
    PROFILE_LANGUAGES,
    ProfileLanguagesSchema,
    profileLanguageLabel,
    profileLanguagesView,
} from './profileLanguages';

describe('ProfileStatusSchema（ひとこと）', () => {
    it('前後の空白を除き、空なら null', () => {
        expect(ProfileStatusSchema.parse('  作業中  ')).toBe('作業中');
        expect(ProfileStatusSchema.parse('   ')).toBeNull();
        expect(ProfileStatusSchema.parse('')).toBeNull();
    });

    it('上限はコードポイントで数える（サロゲートペアも 1 文字）', () => {
        expect(ProfileStatusSchema.safeParse('𠮷'.repeat(PROFILE_STATUS_MAX_LENGTH)).success).toBe(true);
        expect(ProfileStatusSchema.safeParse('𠮷'.repeat(PROFILE_STATUS_MAX_LENGTH + 1)).success).toBe(false);
        expect(profileStatusLength(` ${'𠮷'.repeat(3)} `)).toBe(3);
    });

    it('画面の文字数と API の判定がずれない', () => {
        for (const v of [` ${'a'.repeat(PROFILE_STATUS_MAX_LENGTH)} `, 'a'.repeat(PROFILE_STATUS_MAX_LENGTH + 1)]) {
            expect(ProfileStatusSchema.safeParse(v).success).toBe(profileStatusLength(v) <= PROFILE_STATUS_MAX_LENGTH);
        }
    });

    it('1 行だけ（途中の改行・タブ・行区切り・制御文字は断る）', () => {
        for (const v of ['一行目\n二行目', 'a\r\nb', 'a\tb', 'a\u2028b', 'a\u0000b', 'a\u0085b']) {
            expect(ProfileStatusSchema.safeParse(v).success, JSON.stringify(v)).toBe(false);
        }
    });

    it('文字列以外は断る', () => {
        expect(ProfileStatusSchema.safeParse(null).success).toBe(false);
        expect(ProfileStatusSchema.safeParse(1).success).toBe(false);
    });
});

describe('ProfileLanguagesSchema（話せる言語）', () => {
    it('一覧にあるコードだけを、選んだ順のまま受け付ける', () => {
        expect(ProfileLanguagesSchema.parse(['en', 'ja'])).toEqual(['en', 'ja']);
        expect(ProfileLanguagesSchema.parse([])).toEqual([]);
    });

    it('一覧に無いコード・大文字小文字の違い・重複・上限超えは断る', () => {
        for (const v of [
            ['xx'],
            ['JA'],
            ['zh'],
            ['ja', 'ja'],
            ['__proto__'],
            PROFILE_LANGUAGES.slice(0, MAX_PROFILE_LANGUAGES + 1).map((l) => l.code),
        ]) {
            expect(ProfileLanguagesSchema.safeParse(v).success, JSON.stringify(v)).toBe(false);
        }
    });

    it('一覧のコードは重複せず、名前は空でない', () => {
        const codes = PROFILE_LANGUAGES.map((l) => l.code);
        expect(new Set(codes).size).toBe(codes.length);
        expect(PROFILE_LANGUAGES.every((l) => l.label.trim().length > 0)).toBe(true);
    });

    it('名前はその言語自身での呼び名。一覧に無いコードはそのまま', () => {
        expect(profileLanguageLabel('ja')).toBe('日本語');
        expect(profileLanguageLabel('ko')).toBe('한국어');
        expect(profileLanguageLabel('xx')).toBe('xx');
    });

    it('保存してある値は一覧にあるものだけ・重複なし・上限までにして出す', () => {
        expect(profileLanguagesView(['ja', 'xx', 'ja', 1, 'en'])).toEqual(['ja', 'en']);
        expect(profileLanguagesView('ja')).toEqual([]);
        expect(profileLanguagesView(PROFILE_LANGUAGES.map((l) => l.code))).toHaveLength(MAX_PROFILE_LANGUAGES);
    });
});

describe('ProfileUpdateSchema', () => {
    const valid = { status: ' 制作中 ', bio: '', links: ['github.com/a'], languages: ['ja'] };

    it('保存する形にそろえる（空の自己紹介・ひとことは null、リンクは正規形）', () => {
        expect(ProfileUpdateSchema.parse(valid)).toEqual({
            status: '制作中',
            bio: null,
            links: ['https://github.com/a'],
            languages: ['ja'],
        });
    });

    it('項目が欠けていれば断る（置き換えなので、送らなかった項目を消さないように）', () => {
        for (const key of Object.keys(valid)) {
            const { [key]: _omitted, ...rest } = valid as Record<string, unknown>;
            expect(ProfileUpdateSchema.safeParse(rest).success, key).toBe(false);
        }
    });

    it('知らない項目（表示名・画像の URL）は保存の対象に入れない', () => {
        const parsed = ProfileUpdateSchema.parse({ ...valid, name: 'x', image: 'https://evil.example/a.png' });
        expect(parsed).not.toHaveProperty('name');
        expect(parsed).not.toHaveProperty('image');
    });
});

describe('プロフィール画像の URL', () => {
    const hash = 'A'.repeat(43);

    it('パスに利用者 ID を符号化して入れる', () => {
        expect(profileImagePath('u/1', 'avatar', hash)).toBe(`/api/v1/users/u%2F1/images/avatar/${hash}.webp`);
    });

    it('ファイル名からハッシュを取り出す（形が違うものは null）', () => {
        expect(profileImageHashOf(`${hash}.webp`)).toBe(hash);
        for (const name of [
            hash,
            `${hash}.png`,
            `${'A'.repeat(42)}.webp`,
            `../${hash}.webp`,
            `${hash}.webp.webp`,
            '',
        ]) {
            expect(profileImageHashOf(name), name).toBeNull();
        }
    });
});

describe('userProfileOf', () => {
    it('保存してある値を公開プロフィールの形にする（jsonb は形を確かめる）', () => {
        expect(
            userProfileOf(
                {
                    id: 'u1',
                    name: 'ようかん',
                    handle: 'youkan',
                    image: null,
                    bio: null,
                    status: '作業中',
                    bannerImage: 'https://ubichill.example/b.webp',
                    links: ['https://github.com/a', 'javascript:alert(1)'],
                    languages: 'ja',
                },
                'youkan@ubichill.example',
                [{ id: 'r1', name: 'スタッフ', color: '#ff0000' }],
            ),
        ).toEqual({
            id: 'u1',
            name: 'ようかん',
            handle: 'youkan',
            author: 'youkan@ubichill.example',
            image: null,
            bio: null,
            status: '作業中',
            bannerImage: 'https://ubichill.example/b.webp',
            links: [{ url: 'https://github.com/a', kind: 'github' }],
            languages: [],
            roles: [{ id: 'r1', name: 'スタッフ', color: '#ff0000' }],
        });
    });
});
