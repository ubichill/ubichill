import { describe, expect, it } from 'vitest';
import {
    authorAccountKey,
    BLOCK_LIMITS,
    type BlockEdge,
    blockedAuthorKeys,
    blockRefusal,
    hasBlocked,
    hiddenIdsOf,
    interactionRefusal,
    isBlockedBetween,
    isModAuthorBlocked,
} from './blocks';

const edge = (blockerId: string, blockedId: string): BlockEdge => ({ blockerId, blockedId });

describe('interactionRefusal', () => {
    it('自分自身は、自分をブロックした行が紛れていても self', () => {
        expect(interactionRefusal('a', 'a', [edge('a', 'a')])).toBe('self');
        expect(interactionRefusal('a', 'a', [])).toBe('self');
    });

    it('向きで分ける: 自分がブロックしていれば blocking、相手にされていれば blocked', () => {
        expect(interactionRefusal('a', 'b', [edge('a', 'b')])).toBe('blocking');
        expect(interactionRefusal('b', 'a', [edge('a', 'b')])).toBe('blocked');
    });

    it('お互いにブロックしていれば、自分のブロックを先に返す（解除しても相手のブロックで止まる）', () => {
        expect(interactionRefusal('a', 'b', [edge('b', 'a'), edge('a', 'b')])).toBe('blocking');
    });

    it('ほかの 2 人の間のブロック・逆向きの別人の行では止めない', () => {
        expect(interactionRefusal('a', 'b', [edge('a', 'c'), edge('c', 'b'), edge('b', 'c')])).toBeNull();
    });

    it('ほかのサーバーの actor の URL も ID として同じに扱い、大文字小文字は区別する', () => {
        const actor = 'https://other.example/users/x';
        expect(interactionRefusal(actor, 'me', [edge('me', actor)])).toBe('blocked');
        expect(interactionRefusal('https://other.example/users/X', 'me', [edge('me', actor)])).toBeNull();
    });
});

describe('isBlockedBetween', () => {
    it('どちらの向きのブロックでも止める', () => {
        expect(isBlockedBetween([edge('a', 'b')], 'a', 'b')).toBe(true);
        expect(isBlockedBetween([edge('a', 'b')], 'b', 'a')).toBe(true);
    });

    it('ほかの 2 人の間のブロックは関係ない', () => {
        expect(isBlockedBetween([edge('a', 'c'), edge('c', 'b')], 'a', 'b')).toBe(false);
    });

    it('自分自身とはブロックにならない（自分をブロックした行が紛れても）', () => {
        expect(isBlockedBetween([edge('a', 'a')], 'a', 'a')).toBe(false);
    });

    it('ID は大文字小文字を区別する（ユーザー ID・actor の URL は別物として扱う）', () => {
        expect(isBlockedBetween([edge('a', 'B')], 'a', 'b')).toBe(false);
    });

    it('ほかのサーバーの actor の URL もそのまま比べる', () => {
        const actor = 'https://other.example/users/x';
        expect(isBlockedBetween([edge('me', actor)], actor, 'me')).toBe(true);
        expect(isBlockedBetween([edge('me', actor)], 'https://other.example/users/y', 'me')).toBe(false);
    });
});

describe('hasBlocked と hiddenIdsOf', () => {
    it('向きを見る（ブロックされた側からは相手を隠さない）', () => {
        const edges = [edge('a', 'b')];
        expect(hasBlocked(edges, 'a', 'b')).toBe(true);
        expect(hasBlocked(edges, 'b', 'a')).toBe(false);
        expect([...hiddenIdsOf(edges, 'a')]).toEqual(['b']);
        expect([...hiddenIdsOf(edges, 'b')]).toEqual([]);
    });
});

describe('blockRefusal', () => {
    it('自分はブロックできない', () => {
        expect(blockRefusal({ blockerId: 'a', targetId: 'a', currentCount: 0, alreadyBlocked: false })).toBe('self');
    });

    it('上限ちょうどで新しい相手は断る。上限の 1 つ手前は通す', () => {
        const max = BLOCK_LIMITS.MAX_BLOCKS;
        expect(blockRefusal({ blockerId: 'a', targetId: 'b', currentCount: max, alreadyBlocked: false })).toBe('limit');
        expect(blockRefusal({ blockerId: 'a', targetId: 'b', currentCount: max - 1, alreadyBlocked: false })).toBe(
            null,
        );
    });

    it('上限に達していても、ブロック済みの相手へのブロックし直しは断らない', () => {
        const max = BLOCK_LIMITS.MAX_BLOCKS;
        expect(blockRefusal({ blockerId: 'a', targetId: 'b', currentCount: max, alreadyBlocked: true })).toBe(null);
    });
});

describe('authorAccountKey', () => {
    it('表記の揺れ（@・acct:・空白・大文字）を揃える', () => {
        expect(authorAccountKey('youkan@ubichill.com')).toBe('youkan@ubichill.com');
        expect(authorAccountKey('@youkan@Ubichill.COM')).toBe('youkan@ubichill.com');
        expect(authorAccountKey('  acct:youkan@ubichill.com ')).toBe('youkan@ubichill.com');
        expect(authorAccountKey('ACCT:YouKan@ubichill.com')).toBe('youkan@ubichill.com');
    });

    it('ポート付きのドメインはポートまで含めて区別する', () => {
        expect(authorAccountKey('dev@localhost:3000')).toBe('dev@localhost:3000');
        expect(authorAccountKey('dev@localhost:3001')).not.toBe(authorAccountKey('dev@localhost:3000'));
    });

    it('作者アカウントの形でなければ null', () => {
        expect(authorAccountKey('youkan')).toBeNull();
        expect(authorAccountKey('@youkan')).toBeNull();
        expect(authorAccountKey('')).toBeNull();
        expect(authorAccountKey('you kan@ubichill.com')).toBeNull();
        expect(authorAccountKey('https://ubichill.com/users/youkan')).toBeNull();
    });
});

describe('isModAuthorBlocked', () => {
    const blocked = blockedAuthorKeys(['YouKan@Ubichill.com', null, 'not-an-account', 'evil@other.example']);

    it('作者アカウントが一致すれば読み込まない（大文字小文字・@ の有無は問わない）', () => {
        expect(isModAuthorBlocked('youkan@ubichill.com', blocked)).toBe(true);
        expect(isModAuthorBlocked('@youkan@ubichill.com', blocked)).toBe(true);
        expect(isModAuthorBlocked('YOUKAN@UBICHILL.COM', blocked)).toBe(true);
    });

    it('ほかのドメインの同じ handle は別人', () => {
        expect(isModAuthorBlocked('youkan@other.example', blocked)).toBe(false);
        expect(isModAuthorBlocked('evil@ubichill.com', blocked)).toBe(false);
    });

    it('サブドメイン・前方一致・後方一致では一致しない', () => {
        expect(isModAuthorBlocked('youkan@ubichill.com.evil.example', blocked)).toBe(false);
        expect(isModAuthorBlocked('youkan@sub.ubichill.com', blocked)).toBe(false);
        expect(isModAuthorBlocked('xyoukan@ubichill.com', blocked)).toBe(false);
    });

    it('作者の無い mod・読めない作者は読み込みを止めない', () => {
        expect(isModAuthorBlocked(undefined, blocked)).toBe(false);
        expect(isModAuthorBlocked(null, blocked)).toBe(false);
        expect(isModAuthorBlocked('', blocked)).toBe(false);
        expect(isModAuthorBlocked('not-an-account', blocked)).toBe(false);
    });

    it('読めない作者アカウントは一覧に入らない', () => {
        expect([...blocked].sort()).toEqual(['evil@other.example', 'youkan@ubichill.com']);
    });

    it('一覧が空なら何も止めない', () => {
        expect(isModAuthorBlocked('youkan@ubichill.com', new Set())).toBe(false);
    });
});
