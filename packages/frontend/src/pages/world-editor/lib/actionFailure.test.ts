import { describe, expect, it } from 'vitest';
import { inStage, toActionFailure } from './actionFailure';

describe('inStage / toActionFailure', () => {
    it('失敗に段階を付ける', async () => {
        const error = await inStage('build', () => Promise.reject(new Error('hash mismatch'))).catch((e) => e);
        expect(toActionFailure(error, 'publish')).toEqual({ stage: 'build', message: 'hash mismatch' });
    });

    it('内側で付いた段階を外側で上書きしない', async () => {
        const error = await inStage('publish', () => inStage('build', () => Promise.reject(new Error('x')))).catch(
            (e) => e,
        );
        expect(toActionFailure(error, 'save').stage).toBe('build');
    });

    it('段階の無い失敗は fallback の段階にする', () => {
        expect(toActionFailure(new Error('HTTP 500'), 'save')).toEqual({ stage: 'save', message: 'HTTP 500' });
    });

    it('Error でないものや空のメッセージは段階の決まり文句にする', async () => {
        expect(toActionFailure('oops', 'publish')).toEqual({ stage: 'publish', message: '公開に失敗しました' });
        const error = await inStage('build', () => Promise.reject(new Error(''))).catch((e) => e);
        expect(toActionFailure(error, 'save')).toEqual({ stage: 'build', message: 'ビルドに失敗しました' });
    });

    it('成功した値はそのまま返す', async () => {
        await expect(inStage('build', async () => 42)).resolves.toBe(42);
    });
});
