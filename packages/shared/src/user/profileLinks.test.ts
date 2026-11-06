import { describe, expect, it } from 'vitest';
import {
    MAX_PROFILE_LINKS,
    PROFILE_LINK_MAX_LENGTH,
    ProfileLinksSchema,
    parseProfileLink,
    profileLinkKindOf,
    profileLinksView,
} from './profileLinks';

const ok = (input: string) => {
    const result = parseProfileLink(input);
    if (!result.ok) throw new Error(`通るはずが断られた: ${input} (${result.error})`);
    return result;
};
const rejected = (input: string) => parseProfileLink(input).ok === false;

describe('profileLinkKindOf（ホスト名で種類を決める）', () => {
    it.each([
        ['https://github.com/ieyoukan', 'github'],
        ['https://gist.github.com/ieyoukan', 'github'],
        ['https://x.com/ubichill', 'x'],
        ['https://twitter.com/ubichill', 'x'],
        ['https://mobile.twitter.com/ubichill', 'x'],
        ['https://www.youtube.com/@ubichill', 'youtube'],
        ['https://m.youtube.com/@ubichill', 'youtube'],
        ['https://youtu.be/abc', 'youtube'],
        ['https://bsky.app/profile/ubichill.com', 'bluesky'],
        ['https://www.twitch.tv/ubichill', 'twitch'],
        ['https://www.pixiv.net/users/1', 'pixiv'],
        ['https://ubichill.booth.pm/', 'booth'],
        ['https://booth.pm/ja/items/1', 'booth'],
        ['https://vrchat.com/home/user/usr_x', 'vrchat'],
        ['https://ubichill.com/', 'website'],
    ] as const)('%s → %s', (url, kind) => {
        expect(profileLinkKindOf(url)).toBe(kind);
    });

    it('名前が似ているだけの別ドメインはサービスとして扱わない', () => {
        for (const url of [
            'https://github.com.evil.example/',
            'https://evilgithub.com/',
            'https://fx.com/',
            'https://notbsky.app/',
            'https://youtube.com-watch.example/',
            'https://evil.example/github.com',
            'https://evil.example/?u=https://github.com',
            'https://evil.example/#github.com',
            'https://user.github.io/',
        ]) {
            expect(profileLinkKindOf(url)).toBe('website');
        }
    });

    it('読めない値は website（例外を投げない）', () => {
        expect(profileLinkKindOf('')).toBe('website');
        expect(profileLinkKindOf('not a url')).toBe('website');
    });
});

describe('parseProfileLink', () => {
    it('https の URL を正規形にする（ホストは小文字・末尾の / を補う）', () => {
        expect(ok('https://GitHub.com').url).toBe('https://github.com/');
        expect(ok('  https://x.com/ubichill  ').url).toBe('https://x.com/ubichill');
    });

    it('スキームを省いた入力は https として扱う', () => {
        expect(ok('github.com/ieyoukan')).toMatchObject({ url: 'https://github.com/ieyoukan', kind: 'github' });
        expect(ok('//bsky.app/profile/a').url).toBe('https://bsky.app/profile/a');
    });

    it('https 以外のスキームは断る（大文字・空白混じりでも）', () => {
        for (const input of [
            'javascript:alert(1)',
            'JavaScript:alert(1)',
            ' javascript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'vbscript:msgbox(1)',
            'http://github.com/ieyoukan',
            'ftp://example.com/',
            'file:///etc/passwd',
            'mailto:a@example.com',
        ]) {
            expect(rejected(input), input).toBe(true);
        }
    });

    it('URL の解析が黙って捨てる改行・タブ・見えない文字は、解析の前に断る', () => {
        for (const input of [
            'java\nscript:alert(1)',
            'https://git\thub.com/',
            'https://github.com/a b',
            'https://github.com/\u200bx',
            'https://github.com/\u202eevil',
            'https://example.com/\u0000',
            'https://example.com/a\u3000b',
        ]) {
            expect(rejected(input), JSON.stringify(input)).toBe(true);
        }
    });

    it('資格情報入りの URL は断る（`github.com@evil` で GitHub に見せかけられる）', () => {
        expect(rejected('https://github.com@evil.example/')).toBe(true);
        expect(rejected('https://user:pass@example.com/')).toBe(true);
        expect(rejected('https://:pass@example.com/')).toBe(true);
    });

    it('IP アドレス・単一ラベル・末尾のドット・ポート指定は断る', () => {
        for (const input of [
            'https://127.0.0.1/',
            'https://192.168.0.1/admin',
            'https://[::1]/',
            'https://0x7f.1/',
            'https://localhost/',
            'https://github.com./',
            'https://example.com:8443/',
            'https://-bad.example/',
        ]) {
            expect(rejected(input), input).toBe(true);
        }
    });

    it('国際化ドメインは punycode にして、見た目の似た別ドメインを本物と区別する', () => {
        // キリル文字の і を混ぜた github
        const homograph = ok('https://g\u0456thub.com/ieyoukan');
        expect(homograph.url).toMatch(/^https:\/\/xn--/);
        expect(homograph.kind).toBe('website');
        // 全角英字は URL の規則で同じドメインになる（本物の GitHub）
        expect(ok('https://ｇｉｔｈｕｂ.com/a')).toMatchObject({ url: 'https://github.com/a', kind: 'github' });
        expect(ok('https://日本語.jp/').url).toBe('https://xn--wgv71a119e.jp/');
    });

    it('長すぎる URL は断る（正規化で長くなったものも保存する形で数える）', () => {
        const base = 'https://example.com/';
        expect(ok(base + 'a'.repeat(PROFILE_LINK_MAX_LENGTH - base.length)).url).toHaveLength(PROFILE_LINK_MAX_LENGTH);
        expect(rejected(base + 'a'.repeat(PROFILE_LINK_MAX_LENGTH - base.length + 1))).toBe(true);
        // 入力は上限に収まるが、パスの日本語がパーセントエンコードされて上限を超える
        expect(rejected(`${base}${'あ'.repeat(60)}`)).toBe(true);
    });

    it('空・空白だけは断る', () => {
        expect(rejected('')).toBe(true);
        expect(rejected('   ')).toBe(true);
    });
});

describe('ProfileLinksSchema', () => {
    it('正規形の URL の配列にする', () => {
        expect(ProfileLinksSchema.parse(['github.com/a', 'https://X.com/b'])).toEqual([
            'https://github.com/a',
            'https://x.com/b',
        ]);
        expect(ProfileLinksSchema.parse([])).toEqual([]);
    });

    it(`${MAX_PROFILE_LINKS} 件を超えると断る`, () => {
        const links = Array.from({ length: MAX_PROFILE_LINKS + 1 }, (_, i) => `https://example.com/${i}`);
        expect(ProfileLinksSchema.safeParse(links.slice(0, MAX_PROFILE_LINKS)).success).toBe(true);
        expect(ProfileLinksSchema.safeParse(links).success).toBe(false);
    });

    it('正規化すると同じになるリンクの重複を断る', () => {
        const result = ProfileLinksSchema.safeParse(['https://github.com/a', 'GITHUB.com/a']);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual([1]);
    });

    it('1 件でも通らないリンクがあれば全体を断り、どれが悪いかを返す', () => {
        const result = ProfileLinksSchema.safeParse(['https://github.com/a', 'javascript:alert(1)']);
        expect(result.success).toBe(false);
        expect(result.error?.issues.map((i) => i.path)).toEqual([[1]]);
    });

    it('文字列以外は断る', () => {
        expect(ProfileLinksSchema.safeParse([{ url: 'https://github.com' }]).success).toBe(false);
        expect(ProfileLinksSchema.safeParse('https://github.com').success).toBe(false);
    });
});

describe('profileLinksView（保存してあるリンクの表示）', () => {
    it('種類を付け、今の規則で通らないもの・文字列以外は出さない', () => {
        expect(
            profileLinksView(['https://github.com/a', 'http://old.example/', 42, null, 'https://ubichill.com/']),
        ).toEqual([
            { url: 'https://github.com/a', kind: 'github' },
            { url: 'https://ubichill.com/', kind: 'website' },
        ]);
    });

    it('配列でなければ空', () => {
        expect(profileLinksView(null)).toEqual([]);
        expect(profileLinksView({ 0: 'https://github.com' })).toEqual([]);
    });
});
