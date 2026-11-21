import { describe, expect, it } from 'vitest';
import { type ServerInfoInput, ServerInfoSchema } from './serverInfo';

const base: ServerInfoInput = {
    name: 'ようかんの Ubichill',
    description: null,
    maintainerName: null,
    maintainerEmail: null,
    tosUrl: null,
    privacyPolicyUrl: null,
    inquiryUrl: null,
    repositoryUrl: null,
    impressumUrl: null,
};

describe('ServerInfoSchema', () => {
    it('前後の空白を落とし、空の欄は null にする', () => {
        const parsed = ServerInfoSchema.parse({
            ...base,
            name: '  ようかん  ',
            description: '   ',
            maintainerName: ' ようかん ',
            tosUrl: '',
        });
        expect(parsed).toMatchObject({ name: 'ようかん', description: null, maintainerName: 'ようかん', tosUrl: null });
    });

    it('サーバー名は空にできない', () => {
        const result = ServerInfoSchema.safeParse({ ...base, name: '  ' });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toBe('サーバー名を入れてください');
    });

    it('URL は http(s) だけ受け付ける', () => {
        expect(ServerInfoSchema.safeParse({ ...base, tosUrl: 'https://example.com/tos' }).success).toBe(true);
        for (const bad of ['javascript:alert(1)', 'example.com/tos', 'ftp://example.com']) {
            const result = ServerInfoSchema.safeParse({ ...base, tosUrl: bad });
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.message).toBe('利用規約の URL には http(s) の URL を入れてください');
        }
    });

    it('管理者のメールアドレスは形を確かめる', () => {
        expect(ServerInfoSchema.safeParse({ ...base, maintainerEmail: 'admin@example.com' }).success).toBe(true);
        expect(ServerInfoSchema.safeParse({ ...base, maintainerEmail: 'admin' }).success).toBe(false);
    });

    it('長すぎる紹介は断る', () => {
        expect(ServerInfoSchema.safeParse({ ...base, description: 'あ'.repeat(2001) }).success).toBe(false);
    });
});
