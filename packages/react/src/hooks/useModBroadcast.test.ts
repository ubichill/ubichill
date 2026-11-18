import { describe, expect, it } from 'vitest';
import { toNetworkBroadcast } from './useModBroadcast';

describe('toNetworkBroadcast', () => {
    const received = (data: unknown, senderId?: string) => ({
        entityId: 'e1',
        data,
        ...(senderId ? { senderId } : {}),
    });

    it('送信者はサーバーが付けた senderId を使い、data の中の userId（送り手が書ける）では偽れない', () => {
        expect(
            toNetworkBroadcast(received({ type: 'chat', userId: 'bob', data: 'hi' }, 'alice'), 'e1', 'carol'),
        ).toEqual({
            type: 'EVT_NETWORK_BROADCAST',
            payload: { type: 'chat', userId: 'alice', data: 'hi' },
        });
    });

    it('自分が送った broadcast は、data の userId を他人にしても届かない', () => {
        expect(toNetworkBroadcast(received({ type: 'chat', userId: 'bob' }, 'carol'), 'e1', 'carol')).toBeNull();
    });

    it('他人が data の userId を自分にしても、捨てずに本当の送信者で届ける', () => {
        expect(toNetworkBroadcast(received({ type: 'chat', userId: 'carol' }, 'alice'), 'e1', 'carol')).toMatchObject({
            payload: { userId: 'alice' },
        });
    });

    it('senderId を付けない古いサーバーからは、今までどおり data の userId を使う', () => {
        expect(toNetworkBroadcast(received({ type: 'chat', userId: 'bob', data: 1 }), 'e1', 'carol')).toEqual({
            type: 'EVT_NETWORK_BROADCAST',
            payload: { type: 'chat', userId: 'bob', data: 1 },
        });
        expect(toNetworkBroadcast(received({ type: 'chat', userId: 'carol' }), 'e1', 'carol')).toBeNull();
    });

    it('別のエンティティ宛て・type の無いもの・オブジェクトでない data は捨てる', () => {
        expect(
            toNetworkBroadcast({ ...received({ type: 'chat' }, 'alice'), entityId: 'e2' }, 'e1', 'carol'),
        ).toBeNull();
        for (const bad of [null, undefined, 'raw', 1, {}, { type: '' }]) {
            expect(toNetworkBroadcast(received(bad, 'alice'), 'e1', 'carol')).toBeNull();
        }
    });
});
