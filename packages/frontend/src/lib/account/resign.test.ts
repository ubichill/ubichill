import type { WorldIdentity } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { type RevokedEnvironment, resignAll, worldsNeedingResign } from './resign';

const LOST = 'L'.repeat(43);
const LEAKED = 'X'.repeat(43);
const UNKNOWN_REASON = 'U'.repeat(43);
const ACTIVE = 'A'.repeat(43);
const verified = (publicKey: string, author?: string): WorldIdentity => ({
    status: 'verified',
    worldId: `ed25519:${publicKey}/w`,
    publicKey,
    contentHash: 'sha256-x',
    ...(author ? { author } : {}),
});
const revoked: RevokedEnvironment[] = [
    { publicKey: LOST, name: 'なくした PC', revokedAt: '2026-10-01T00:00:00Z', revokeReason: 'lost' },
    { publicKey: LEAKED, name: 'Chrome on Windows', revokedAt: '2026-10-01T00:00:00Z', revokeReason: 'compromised' },
    { publicKey: UNKNOWN_REASON, name: '以前の鍵', revokedAt: '2026-10-01T00:00:00Z', revokeReason: null },
];

describe('worldsNeedingResign', () => {
    const worlds = [
        { id: 'lost', displayName: '紛失した鍵', identity: verified(LOST), updatedAt: '2026-09-01T00:00:00Z' },
        { id: 'leaked', displayName: '漏えいした鍵', identity: verified(LEAKED), updatedAt: '2026-10-01T00:00:00Z' },
        { id: 'unknown', displayName: '理由不明', identity: verified(UNKNOWN_REASON) },
        { id: 'ok', displayName: '公開中', identity: verified(ACTIVE, 'hanako@ubichill.com') },
        {
            id: 'unsigned',
            displayName: '下書き',
            identity: { status: 'unsigned', contentHash: 'sha256-x' } as WorldIdentity,
        },
        { id: 'none', displayName: '識別なし' },
    ];

    it('紛失で取り消した鍵の署名だけを、まとめて署名し直す対象にする', () => {
        const { bulk } = worldsNeedingResign(worlds, revoked);
        expect(bulk.map((t) => t.world.id)).toEqual(['lost']);
        expect(bulk[0]?.signedBy.name).toBe('なくした PC');
    });

    it('漏えい・理由が無い取り消しの署名は、1 つずつ確かめる対象にする（攻撃者の内容に本人の鍵で署名しないように）', () => {
        const { review } = worldsNeedingResign(worlds, revoked);
        expect(review.map((t) => t.world.id)).toEqual(['leaked', 'unknown']);
        expect(review[0]?.signedBy.name).toBe('Chrome on Windows');
    });

    it('未署名・作者付き・取り消していない鍵のワールドは含めない', () => {
        expect(worldsNeedingResign(worlds, [])).toEqual({ bulk: [], review: [] });
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
