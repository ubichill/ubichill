import { describe, expect, it } from 'vitest';
import { authorBindingRepository } from './authorBindingRepository';

/** 他サーバーの作者の確認結果と、確認済みの内容の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);

describe.skipIf(!RUN)('authorBindingRepository (DB統合)', () => {
    it('鍵一覧と表示名を保存し、取り直した結果で置き換える', async () => {
        const account = `it_${stamp}@other.example`;
        await authorBindingRepository.save(account, [{ publicKey: 'A'.repeat(43) }], 'アリス');
        await authorBindingRepository.save(
            account,
            [{ publicKey: 'A'.repeat(43), revokedAt: '2026-10-01T00:00:00.000Z' }, { publicKey: 'B'.repeat(43) }],
            'アリス改',
        );
        const found = await authorBindingRepository.find(account);
        expect(found?.keys).toHaveLength(2);
        expect(found?.displayName).toBe('アリス改');
    });

    it('確認済みの内容はアカウントと内容の組で記録し、二重に記録しても失敗しない', async () => {
        const account = `it_c_${stamp}@other.example`;
        expect(await authorBindingRepository.hasConfirmedContent(account, 'sha256-a')).toBe(false);
        await authorBindingRepository.recordConfirmedContent(account, 'sha256-a');
        await authorBindingRepository.recordConfirmedContent(account, 'sha256-a');
        expect(await authorBindingRepository.hasConfirmedContent(account, 'sha256-a')).toBe(true);
        expect(await authorBindingRepository.hasConfirmedContent(account, 'sha256-b')).toBe(false);
        expect(await authorBindingRepository.hasConfirmedContent(`other_${stamp}@other.example`, 'sha256-a')).toBe(
            false,
        );
    });
});
