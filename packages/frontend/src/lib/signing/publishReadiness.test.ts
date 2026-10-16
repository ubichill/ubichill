import { describe, expect, it } from 'vitest';
import type { MyAccount } from '@/lib/account/me';
import { publishReadiness } from './publishReadiness';

const account: MyAccount = {
    id: 'u1',
    name: 'ようかん',
    displayNameConflict: false,
    displayNameChangeAvailableAt: null,
    passwordChangeRequired: false,
    passwordManagedBySecret: false,
    isAdmin: false,
    handle: 'youkan',
    author: 'youkan@ubichill.com',
    signingKeys: [],
    profileImageUrl: null,
};

describe('publishReadiness（ログインできる = 公開できる）', () => {
    it('ID があれば、鍵が無くても未登録でも公開できる（鍵は公開時に自動で用意する）', () => {
        expect(publishReadiness(account, [])).toEqual({ kind: 'ready', account });
    });

    it('ID が未設定なら ID だけを求める', () => {
        const noHandle = { ...account, handle: null, author: null };
        expect(publishReadiness(noHandle, [])).toEqual({ kind: 'needs-handle', account: noHandle });
    });

    it('固定できない mod があれば何より先に伝える', () => {
        expect(publishReadiness(account, ['danmaku'])).toEqual({ kind: 'unpinned', mods: ['danmaku'] });
    });

    it('アカウント情報が取れなければ公開できない', () => {
        expect(publishReadiness(null, [])).toEqual({ kind: 'no-account' });
    });
});
