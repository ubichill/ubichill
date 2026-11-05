import { describe, expect, it } from 'vitest';
import { describeModRejection, groupRejections } from './modRejection';

describe('describeModRejection', () => {
    it('再試行できるのは「いまは確認できない」だけ（確定した拒否に再試行を出さない）', () => {
        const reasons = [
            'lock-missing',
            'integrity-mismatch',
            'manifest-mismatch',
            'signature-missing',
            'signature-malformed',
            'signature-mod-mismatch',
            'signature-content-mismatch',
            'signature-invalid',
            'author-unconfirmed',
            'author-pending',
        ];
        expect(reasons.filter((r) => describeModRejection(r).retryable)).toEqual(['author-pending']);
        expect(new Set(reasons.map((r) => describeModRejection(r).message)).size).toBe(reasons.length);
    });

    it('知らない理由・Object のプロパティ名でも落ちず、理由をそのまま見せる', () => {
        for (const reason of ['future-reason', 'constructor', '__proto__', '']) {
            const text = describeModRejection(reason);
            expect(text.retryable).toBe(false);
            expect(typeof text.message).toBe('string');
        }
        expect(describeModRejection('future-reason').message).toContain('future-reason');
    });
});

describe('groupRejections', () => {
    it('同じ mod の Component は 1 件にまとめる', () => {
        const grouped = groupRejections(
            new Map([
                ['video-player:screen', 'signature-missing'],
                ['video-player:controls', 'signature-missing'],
                ['pen:pen', 'author-pending'],
            ]),
        );
        expect(grouped).toEqual([
            { modId: 'pen', message: expect.any(String), retryable: true, entityTypes: ['pen:pen'] },
            {
                modId: 'video-player',
                message: describeModRejection('signature-missing').message,
                retryable: false,
                entityTypes: ['video-player:controls', 'video-player:screen'],
            },
        ]);
    });

    it('mod の中で理由が分かれたら、再試行しても直らない理由を見せ、回復できる部品の再試行を残す', () => {
        const [mod] = groupRejections(
            new Map([
                ['m:a', 'author-pending'],
                ['m:b', 'integrity-mismatch'],
            ]),
        );
        expect(mod).toMatchObject({
            message: describeModRejection('integrity-mismatch').message,
            retryable: true,
        });
    });

    it('拒否が無ければ空', () => {
        expect(groupRejections(new Map())).toEqual([]);
    });
});
