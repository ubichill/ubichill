import { describe, expect, it } from 'vitest';
import { checkProtocolCompatibility, MIN_COMPATIBLE_PROTOCOL_VERSION, PROTOCOL_VERSION } from './protocol';

describe('checkProtocolCompatibility', () => {
    it('同一バージョンは ok', () => {
        expect(checkProtocolCompatibility(5, 5).level).toBe('ok');
    });

    it('Host が新しく mod が古い（加算的進化）は ok — 旧 mod × 新 Host は常に動く', () => {
        const r = checkProtocolCompatibility(9, 5);
        expect(r.level).toBe('ok');
    });

    it('mod が Host より新しいと degraded（Host が未対応機能を欠く恐れ）', () => {
        const r = checkProtocolCompatibility(3, 5);
        expect(r.level).toBe('degraded');
        expect(r.hostVersion).toBe(3);
        expect(r.guestVersion).toBe(5);
        expect(r.message).toBeDefined();
    });

    it('guest が最低互換未満だと incompatible（破壊的変更をまたぐ）', () => {
        // MIN が将来 2 以上に上がったケースを想定し、下限-1 を渡して分岐を検証する
        const r = checkProtocolCompatibility(MIN_COMPATIBLE_PROTOCOL_VERSION + 5, MIN_COMPATIBLE_PROTOCOL_VERSION - 1);
        expect(r.level).toBe('incompatible');
        expect(r.message).toBeDefined();
    });

    it('未バージョン管理の旧 mod（guest=0）は現行 Host と互換（誤検出しない）', () => {
        // 破壊的変更前は MIN=0 なので legacy mod も ok。将来 MIN を上げたときだけ弾かれる。
        expect(checkProtocolCompatibility(PROTOCOL_VERSION, 0).level).toBe('ok');
    });

    it('MIN_COMPATIBLE は PROTOCOL_VERSION 以下（破壊的変更時のみ引き上げる不変条件）', () => {
        expect(MIN_COMPATIBLE_PROTOCOL_VERSION).toBeLessThanOrEqual(PROTOCOL_VERSION);
    });
});
