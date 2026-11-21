import { describe, expect, it, vi } from 'vitest';
import { worldAssetFileProblem } from './worldAssetsApi';

vi.mock('../api', () => ({ API_BASE: '' }));

describe('worldAssetFileProblem', () => {
    it('画像で 10 MB までなら送る', () => {
        expect(worldAssetFileProblem({ type: 'image/png', size: 1024 })).toBeNull();
        expect(worldAssetFileProblem({ type: 'application/pdf', size: 1024 })).toBe('画像のファイルを選んでください');
        expect(worldAssetFileProblem({ type: 'image/jpeg', size: 11 * 1024 * 1024 })).toBe('画像は 10 MB までです');
    });
});
