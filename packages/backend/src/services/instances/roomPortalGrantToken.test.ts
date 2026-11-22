import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { roomPortalGrantKey, signRoomPortalGrant } from './roomPortalGrantToken';

/**
 * 形を固定する例。Go の services/instance/internal/runtime/portals_test.go（TestPortalGrantVectors）が同じ値を確かめる。
 * どちらかだけを変えると、backend の出した許可をインスタンスが断る。
 */
const ADMIN_TOKEN = 'ubichill-test-admin-token-0123456789abcdef';
const VECTORS = [
    {
        claims: { room: 'V1StGXR8_Z5jdHi6B-myT', userId: 'user-aya', exp: 1767225600 },
        grant: 'eyJyb29tIjoiVjFTdEdYUjhfWjVqZEhpNkItbXlUIiwidXNlcklkIjoidXNlci1heWEiLCJleHAiOjE3NjcyMjU2MDB9.vLWRgNDNpDDeOdjSBSwMLBAv5l1sWai3LJHh2kZB_LE',
    },
    {
        claims: { room: 'abc@Room.Example:8443', userId: 'user-bob', exp: 1767225660 },
        grant: 'eyJyb29tIjoiYWJjQFJvb20uRXhhbXBsZTo4NDQzIiwidXNlcklkIjoidXNlci1ib2IiLCJleHAiOjE3NjcyMjU2NjB9.RRPcv5-WHizWZK4vTXFc2DbHAVN_rz9wDcai_SO2RkY',
    },
];

describe('signRoomPortalGrant', () => {
    it('決まった管理トークンと中身から、決まった許可を作る（Go と同じ例）', () => {
        const key = roomPortalGrantKey(ADMIN_TOKEN);
        for (const { claims, grant } of VECTORS) expect(signRoomPortalGrant(key, claims)).toBe(grant);
    });

    it('前半は {room, userId, exp} の JSON をそのまま base64url（= で埋めない）にしたもの', () => {
        const [payload, mac] = signRoomPortalGrant(roomPortalGrantKey(ADMIN_TOKEN), VECTORS[0]?.claims as never).split(
            '.',
        );
        expect(JSON.parse(Buffer.from(payload as string, 'base64url').toString('utf8'))).toEqual(VECTORS[0]?.claims);
        expect(`${payload}${mac}`).not.toContain('=');
    });

    it('鍵は管理トークンから派生し、管理トークンそのもの・チケットの鍵とは別', () => {
        const key = roomPortalGrantKey(ADMIN_TOKEN);
        expect(key.equals(Buffer.from(ADMIN_TOKEN))).toBe(false);
        const ticketKey = createHmac('sha256', ADMIN_TOKEN).update('ubichill instance ticket v1').digest();
        expect(key.equals(ticketKey)).toBe(false);
        expect(roomPortalGrantKey(`${ADMIN_TOKEN}x`).equals(key)).toBe(false);
    });
});
