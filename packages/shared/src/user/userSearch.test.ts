import { describe, expect, it } from 'vitest';
import { parseUserSearchQuery, USER_SEARCH_MAX_LENGTH } from './userSearch';

const LOCAL = 'ubichill.com';
const parse = (q: string) => parseUserSearchQuery(q, LOCAL);

describe('parseUserSearchQuery', () => {
    it('空白だけ・@ だけは検索しない', () => {
        expect(parse('   ')).toEqual({ kind: 'empty' });
        expect(parse('@')).toEqual({ kind: 'empty' });
    });

    it('長すぎる検索語は弾く（コードポイントで数える）', () => {
        expect(parse('a'.repeat(USER_SEARCH_MAX_LENGTH)).kind).toBe('text');
        expect(parse('a'.repeat(USER_SEARCH_MAX_LENGTH + 1))).toEqual({ kind: 'tooLong' });
        // サロゲートペアは 1 文字。UTF-16 の長さで数えると短い語を誤って弾く
        expect(parse('😀'.repeat(USER_SEARCH_MAX_LENGTH)).kind).toBe('text');
    });

    it('このサーバーのアカウントは ID の完全一致（ドメインと大文字は区別しない）', () => {
        expect(parse('@youkan@ubichill.com')).toEqual({ kind: 'local', handle: 'youkan' });
        expect(parse('@Youkan@UbiChill.com')).toEqual({ kind: 'local', handle: 'youkan' });
        expect(parseUserSearchQuery('youkan@ubichill.com', 'UBICHILL.COM')).toEqual({
            kind: 'local',
            handle: 'youkan',
        });
    });

    it('ほかのサーバーのアカウントは連合で解決するため、正規化した形で分ける', () => {
        expect(parse('@Bob@Other.Example')).toEqual({ kind: 'remote', account: 'bob@other.example' });
        expect(parse('acct:bob@other.example')).toEqual({ kind: 'remote', account: 'bob@other.example' });
    });

    it('ポート違いは別のサーバー（開発環境の localhost:3001 と localhost を混ぜない）', () => {
        expect(parseUserSearchQuery('@bob@localhost:3001', 'localhost')).toEqual({
            kind: 'remote',
            account: 'bob@localhost:3001',
        });
    });

    it('アカウントとして成り立たない @ 入りは、表示名の検索にする（ID としては探さない）', () => {
        expect(parse('bob@')).toEqual({ kind: 'text', handlePrefix: null, nameKey: 'bob@' });
        expect(parse('a@b')).toEqual({ kind: 'text', handlePrefix: null, nameKey: 'a@b' });
    });

    it('ID として成り立つ語は ID の前方一致も行い、先頭の @ は外す', () => {
        expect(parse('@You')).toEqual({ kind: 'text', handlePrefix: 'you', nameKey: 'you' });
        expect(parse('yo')).toEqual({ kind: 'text', handlePrefix: 'yo', nameKey: 'yo' });
    });

    it('表示名は一意キーで探す（全角・連続空白でも同じ名前に当たる。全角で打った ID も ID として探す）', () => {
        expect(parse('ＹＯＵＫＡＮ')).toEqual({ kind: 'text', handlePrefix: 'youkan', nameKey: 'youkan' });
        expect(parse('よう   かん')).toEqual({ kind: 'text', handlePrefix: null, nameKey: 'よう かん' });
    });

    it('LIKE の記号は ID として扱わない（% や _ を含む語で全件に当たらない）', () => {
        const q = parse('100%');
        expect(q).toEqual({ kind: 'text', handlePrefix: null, nameKey: '100%' });
    });
});
