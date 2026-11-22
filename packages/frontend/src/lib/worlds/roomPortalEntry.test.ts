import { describe, expect, it, vi } from 'vitest';
import { InstanceNotFoundError } from '@/world';
import { type RoomStatus, roomPortalRefusal, roomRefusal } from './roomPortalEntry';

const room = (currentUsers: number, overrides: Partial<RoomStatus> = {}): RoomStatus => ({
    canJoin: true,
    leaderId: 'leader',
    stats: { currentUsers, maxUsers: 4 },
    ...overrides,
});

describe('roomRefusal', () => {
    it('空きがあれば入れる。満員なら full', () => {
        expect(roomRefusal(room(3), 'me')).toBeNull();
        expect(roomRefusal(room(4), 'me')).toBe('full');
        expect(roomRefusal(room(5), 'me')).toBe('full');
    });

    it('部屋を作った人は満員でも入れる。ログインしていない人は作った人として扱わない', () => {
        expect(roomRefusal(room(4), 'leader')).toBeNull();
        expect(roomRefusal(room(4, { leaderId: '' }), null)).toBe('full');
    });

    it('公開範囲・招待で入れなければ、空きがあっても closed（満員より先に見る）', () => {
        expect(roomRefusal(room(0, { canJoin: false }), 'me')).toBe('closed');
        expect(roomRefusal(room(4, { canJoin: false }), 'leader')).toBe('closed');
    });

    it('canJoin の無い部屋（古いサーバー）は人数だけで決める', () => {
        expect(roomRefusal({ leaderId: 'leader', stats: { currentUsers: 1, maxUsers: 4 } }, 'me')).toBeNull();
    });
});

describe('roomPortalRefusal', () => {
    it('出る直前に部屋を引き直す: ポータルを出したあとに満員になった部屋には入らない', async () => {
        const fetchRoom = vi.fn(async () => room(4));
        expect(await roomPortalRefusal(fetchRoom, 'abc@room.example', 'me')).toBe('full');
        expect(fetchRoom).toHaveBeenCalledWith('abc@room.example');
    });

    it('満員だった部屋に空きができていれば入る', async () => {
        expect(await roomPortalRefusal(async () => room(3), 'abc', 'me')).toBeNull();
    });

    it('満員の部屋でも、作った人は入る', async () => {
        expect(await roomPortalRefusal(async () => room(4), 'abc', 'leader')).toBeNull();
    });

    it('部屋が無くなった・見えなくなった（404）なら gone', async () => {
        const gone = async (): Promise<RoomStatus> => {
            throw new InstanceNotFoundError('インスタンスが見つかりません');
        };
        expect(await roomPortalRefusal(gone, 'abc', 'me')).toBe('gone');
    });

    it('確かめられなければ（通信・サーバーの失敗）入らずに unknown', async () => {
        const failing = async (): Promise<RoomStatus> => {
            throw new TypeError('Failed to fetch');
        };
        expect(await roomPortalRefusal(failing, 'abc', 'me')).toBe('unknown');
    });

    it('招待が要るようになった部屋には入らない', async () => {
        expect(await roomPortalRefusal(async () => room(1, { canJoin: false }), 'abc', 'me')).toBe('closed');
    });
});
