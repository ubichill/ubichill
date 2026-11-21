import { describe, expect, it } from 'vitest';
import { readAuthEntry, rootView, signInPath, signingInProgress, withAuthDialog } from './authEntry';

describe('readAuthEntry', () => {
    it('何も無ければダイアログも戻り先も無い', () => {
        expect(readAuthEntry('')).toEqual({ dialog: null, adding: false, next: null });
    });

    it('ログイン・新規登録・二段階目・フェディバースでの登録を読む', () => {
        expect(readAuthEntry('?mode=login').dialog).toBe('login');
        expect(readAuthEntry('?mode=register').dialog).toBe('register');
        expect(readAuthEntry('?two_factor=1').dialog).toBe('two-factor');
        expect(readAuthEntry('?fediverse=sign-up').dialog).toBe('fediverse-sign-up');
    });

    it('知らない値はダイアログにしない', () => {
        expect(readAuthEntry('?mode=verify').dialog).toBeNull();
        expect(readAuthEntry('?two_factor=true').dialog).toBeNull();
        expect(readAuthEntry('?fediverse=linked').dialog).toBeNull();
    });

    it('途中の段階（二段階目・フェディバースでの登録）を、ログイン・新規登録より先に読む', () => {
        expect(readAuthEntry('?mode=register&two_factor=1').dialog).toBe('two-factor');
        expect(readAuthEntry('?mode=login&fediverse=sign-up').dialog).toBe('fediverse-sign-up');
    });

    it('戻り先は Ubichill の中の相対 URL だけ。外への URL や / は無いのと同じ', () => {
        expect(readAuthEntry('?next=%2Fcli%2Fauthorize%3Fx%3D1').next).toBe('/cli/authorize?x=1');
        for (const raw of ['https://evil.example', '//evil.example', '/\\evil.example', '/', '']) {
            expect(readAuthEntry(`?next=${encodeURIComponent(raw)}`).next).toBeNull();
        }
    });

    it('add=1 だけをアカウントの追加にする', () => {
        expect(readAuthEntry('?add=1').adding).toBe(true);
        expect(readAuthEntry('?add=true').adding).toBe(false);
    });
});

describe('withAuthDialog', () => {
    it('開くと mode を付け、戻り先やアカウントの追加は残す', () => {
        expect(withAuthDialog('?next=%2Fx&add=1', 'login')).toBe('?next=%2Fx&add=1&mode=login');
        expect(withAuthDialog('?mode=login', 'register')).toBe('?mode=register');
    });

    it('閉じるとダイアログのクエリだけを外す', () => {
        expect(withAuthDialog('?mode=register&next=%2Fx', null)).toBe('?next=%2Fx');
        expect(withAuthDialog('?two_factor=1&fediverse=sign-up&mode=login', null)).toBe('');
    });

    it('二段階目に移るとログインの mode は外す（読み込み直しても二段階目のまま）', () => {
        expect(withAuthDialog('?mode=login&next=%2Fx', 'two-factor')).toBe('?next=%2Fx&two_factor=1');
    });

    it('フェディバースから戻った知らせ（linked など）は、ダイアログのクエリとして消さない', () => {
        expect(withAuthDialog('?fediverse=linked', null)).toBe('?fediverse=linked');
        expect(withAuthDialog('?fediverse=sign-up', 'login')).toBe('?mode=login');
    });

    it('開いて閉じると元に戻る', () => {
        const search = '?next=%2Fworld%2Fabc';
        expect(withAuthDialog(withAuthDialog(search, 'register'), null)).toBe(search);
    });
});

describe('signInPath', () => {
    it('戻り先が無い・/ なら、そのまま /', () => {
        expect(signInPath()).toBe('/');
        expect(signInPath('/')).toBe('/');
    });

    it('戻り先をクエリに入れる（クエリとハッシュも含めて 1 つの値にする）', () => {
        expect(signInPath('/@alice/room?x=1#h')).toBe('/?next=%2F%40alice%2Froom%3Fx%3D1%23h');
        expect(readAuthEntry(signInPath('/@alice/room?x=1#h').slice(1)).next).toBe('/@alice/room?x=1#h');
    });

    it('外への URL は戻り先にしない', () => {
        expect(signInPath('https://evil.example')).toBe('/');
        expect(signInPath('//evil.example')).toBe('/');
    });
});

describe('rootView', () => {
    const entry = (search: string) => readAuthEntry(search);

    it('確かめている間は読み込み中', () => {
        expect(rootView('pending', entry('?mode=login'))).toEqual({ kind: 'loading' });
    });

    it('ログインしていない人には、何があっても紹介のページ', () => {
        for (const search of ['', '?mode=login', '?next=%2Fx', '?two_factor=1', '?add=1']) {
            expect(rootView('signed-out', entry(search))).toEqual({ kind: 'visitor' });
        }
    });

    it('ログインしている人はホームへ。戻り先があればそこへ', () => {
        expect(rootView('signed-in', entry(''))).toEqual({ kind: 'home' });
        expect(rootView('signed-in', entry('?next=%2Fcli%2Fauthorize'))).toEqual({
            kind: 'redirect',
            to: '/cli/authorize',
        });
    });

    it('ログインしている人がログイン・新規登録を開いたら、ダイアログを外してホームへ', () => {
        expect(rootView('signed-in', entry('?mode=register'))).toEqual({ kind: 'redirect', to: '/' });
        expect(rootView('signed-in', entry('?mode=login&next=%2Fx'))).toEqual({ kind: 'redirect', to: '/x' });
    });

    it('アカウントの追加・二段階目・フェディバースでの登録は、ログインしていても続ける', () => {
        for (const search of ['?add=1', '?add=1&next=%2Fx', '?two_factor=1', '?fediverse=sign-up']) {
            expect(rootView('signed-in', entry(search))).toEqual({ kind: 'visitor' });
        }
    });

    it('確かめられないとき、ログインしに来た人には紹介のページを、そうでなければ読み込み中を出す', () => {
        expect(rootView('unknown', entry(''))).toEqual({ kind: 'loading' });
        for (const search of ['?mode=login', '?next=%2Fcli%2Fauthorize', '?add=1', '?two_factor=1']) {
            expect(rootView('unknown', entry(search))).toEqual({ kind: 'visitor' });
        }
    });

    it('戻り先が / を指していても、行き来を繰り返さない', () => {
        expect(rootView('signed-in', entry('?next=%2F'))).toEqual({ kind: 'home' });
    });
});

describe('signingInProgress', () => {
    it('ダイアログを開いている・アカウントを足しているときだけ', () => {
        expect(signingInProgress('')).toBe(false);
        expect(signingInProgress('?next=%2Fx')).toBe(false);
        expect(signingInProgress('?fediverse_error=expired')).toBe(false);
        expect(signingInProgress('?mode=register')).toBe(true);
        expect(signingInProgress('?add=1')).toBe(true);
    });
});
