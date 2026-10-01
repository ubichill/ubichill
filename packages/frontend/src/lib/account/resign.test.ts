import type { WorldIdentity } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { resignAll, worldsNeedingResign } from './resign';

const REVOKED = 'R'.repeat(43);
const ACTIVE = 'A'.repeat(43);
const verified = (publicKey: string, author?: string): WorldIdentity => ({
    status: 'verified',
    worldId: `ed25519:${publicKey}/w`,
    publicKey,
    contentHash: 'sha256-x',
    ...(author ? { author } : {}),
});

describe('worldsNeedingResign', () => {
    const worlds = [
        { id: 'revoked', displayName: '取り消した鍵', identity: verified(REVOKED) },
        { id: 'ok', displayName: '公開中', identity: verified(ACTIVE, 'youkan@ubichill.com') },
        {
            id: 'unsigned',
            displayName: '下書き',
            identity: { status: 'unsigned', contentHash: 'sha256-x' } as WorldIdentity,
        },
        { id: 'other-key', displayName: '別の鍵（作者なし）', identity: verified(ACTIVE) },
        { id: 'unknown', displayName: '識別なし' },
    ];

    it('取り消した鍵で署名されたワールドだけを返す', () => {
        expect(worldsNeedingResign(worlds, new Set([REVOKED])).map((w) => w.id)).toEqual(['revoked']);
    });

    it('未署名（非公開のつもりかもしれない）や、取り消していない鍵のワールドは含めない', () => {
        expect(worldsNeedingResign(worlds, new Set())).toEqual([]);
    });
});

describe('resignAll', () => {
    it('順に署名し直し、失敗しても残りを続けて、失敗と理由をまとめて返す', async () => {
        const order: string[] = [];
        const result = await resignAll(['a', 'b', 'c'], async (id) => {
            order.push(id);
            if (id === 'b') throw new Error('lock が固定できません');
            return `identity-${id}`;
        });
        expect(order).toEqual(['a', 'b', 'c']);
        expect(result.done).toEqual([
            { id: 'a', identity: 'identity-a' },
            { id: 'c', identity: 'identity-c' },
        ]);
        expect(result.failed).toEqual([{ id: 'b', error: 'lock が固定できません' }]);
    });
});
