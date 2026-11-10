import { describe, expect, it } from 'vitest';
import { isResignable } from './worldProblems';

describe('isResignable', () => {
    it('署名の形式が古い（読めない）だけなら、そのまま署名し直せる', () => {
        expect(isResignable({ problemCode: 'malformed' })).toBe(true);
    });

    it('内容が署名と合わない・別の名前の署名などは、編集から公開し直させる（何が変わったかを作者が確かめる）', () => {
        for (const problemCode of [
            'content-mismatch',
            'bad-signature',
            'name-mismatch',
            'lock-incomplete',
            undefined,
        ]) {
            expect(isResignable({ problemCode })).toBe(false);
        }
    });
});
