import { DEFAULT_SERVER_INFO } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { serverInfoChanged, serverInfoDraft } from './serverInfoForm';

describe('serverInfoForm', () => {
    it('空の欄は空の文字にする', () => {
        expect(serverInfoDraft({ ...DEFAULT_SERVER_INFO, tosUrl: 'https://example.com/tos' })).toMatchObject({
            name: 'Ubichill',
            description: '',
            tosUrl: 'https://example.com/tos',
        });
    });

    it('前後の空白だけの違いは、変えていない扱い', () => {
        const draft = serverInfoDraft(DEFAULT_SERVER_INFO);
        expect(serverInfoChanged(DEFAULT_SERVER_INFO, draft)).toBe(false);
        expect(serverInfoChanged(DEFAULT_SERVER_INFO, { ...draft, name: ' Ubichill ', description: '  ' })).toBe(false);
        expect(serverInfoChanged(DEFAULT_SERVER_INFO, { ...draft, description: '紹介' })).toBe(true);
    });
});
