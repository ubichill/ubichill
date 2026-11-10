import { blockedAuthorKeys } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { blockedAuthorRejection, describeModRejection, groupRejections } from './modRejection';

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
            'author-blocked',
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

describe('blockedAuthorRejection', () => {
    const blocked = blockedAuthorKeys(['youkan@ubichill.com']);

    it('ブロックした人の作者アカウントの mod は実行しない（再試行も出さない）', () => {
        expect(blockedAuthorRejection('youkan@ubichill.com', blocked)).toEqual({ rejected: 'author-blocked' });
        expect(describeModRejection('author-blocked').retryable).toBe(false);
    });

    it('ほかのサーバーの同じ handle・作者の無い mod は止めない', () => {
        expect(blockedAuthorRejection('youkan@other.example', blocked)).toBeNull();
        expect(blockedAuthorRejection(undefined, blocked)).toBeNull();
    });

    it('同じ mod の部品は 1 つにまとめて、ブロックの理由で出す', () => {
        const rejections = new Map([
            ['evil:a', 'author-blocked'],
            ['evil:b', 'author-blocked'],
        ]);
        expect(groupRejections(rejections)).toEqual([
            {
                modId: 'evil',
                message: 'ブロックした人が作った mod です',
                retryable: false,
                entityTypes: ['evil:a', 'evil:b'],
            },
        ]);
    });
});
