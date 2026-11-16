import { blockedAuthorKeys } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import {
    blockedAuthorRejection,
    describeModRejection,
    modIdOfType,
    modRejectionLog,
    retryTargets,
} from './modRejection';

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

describe('modRejectionLog', () => {
    it('確定した拒否はエラーで、再試行を付けない', () => {
        const log = modRejectionLog('video-player', 'signature-missing', () => {});
        expect(log).toMatchObject({ level: 'error', source: 'video-player' });
        expect(log.message).toContain(describeModRejection('signature-missing').message);
        expect(log.detail).toContain('理由: signature-missing');
        expect(log.action).toBeUndefined();
    });

    it('時間をおけば通るものは警告で、再試行を付ける', () => {
        const retry = vi.fn();
        const log = modRejectionLog('pen', 'author-pending', retry);
        expect(log.level).toBe('warning');
        log.action?.run();
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('知らない理由もそのまま出す（エラーとして扱う）', () => {
        const log = modRejectionLog('m', 'constructor', () => {});
        expect(log).toMatchObject({ level: 'error', message: expect.stringContaining('constructor') });
    });
});

describe('retryTargets', () => {
    const rejections = new Map([
        ['video-player:screen', 'author-pending'],
        ['video-player:controls', 'integrity-mismatch'],
        ['video:other', 'author-pending'],
        ['pen:pen', 'load-unavailable'],
    ]);

    it('その mod のうち、再試行で通る可能性のある Component だけを選ぶ（ID の前方一致で別の mod を拾わない）', () => {
        expect(retryTargets(rejections, 'video-player')).toEqual({ targets: ['video-player:screen'], rejected: 2 });
        expect(retryTargets(rejections, 'video')).toEqual({ targets: ['video:other'], rejected: 1 });
    });

    it('止まっていない mod は空', () => {
        expect(retryTargets(rejections, 'danmaku')).toEqual({ targets: [], rejected: 0 });
    });
});

describe('modIdOfType', () => {
    it('最初の : より前', () => {
        expect(modIdOfType('pen:pen')).toBe('pen');
        expect(modIdOfType('a:b:c')).toBe('a');
        expect(modIdOfType('plain')).toBe('plain');
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

    it('ブロックの理由で記録し、再試行は付けない', () => {
        const log = modRejectionLog('evil', 'author-blocked', () => {});
        expect(log).toMatchObject({ level: 'error', message: '読み込めませんでした: ブロックした人が作った mod です' });
        expect(log.action).toBeUndefined();
        expect(retryTargets(new Map([['evil:a', 'author-blocked']]), 'evil').targets).toEqual([]);
    });
});
