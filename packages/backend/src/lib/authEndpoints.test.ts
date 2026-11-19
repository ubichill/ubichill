import { describe, expect, it } from 'vitest';
import { isPublicAuthPath } from './authEndpoints';

describe('isPublicAuthPath', () => {
    it('画面が使うログイン・ログアウト・セッション取得は通す', () => {
        for (const path of ['/sign-in/email', '/sign-out', '/get-session', '/get-session/']) {
            expect(isPublicAuthPath(path), path).toBe(true);
        }
    });

    it('メール確認を通らない登録・プロフィールの直接更新などは通さない', () => {
        for (const path of [
            '/sign-up/email',
            '/update-user',
            '/change-email',
            '/delete-user',
            '/link-social',
            '/request-password-reset',
            '/sign-in/social',
            '/',
            '',
        ]) {
            expect(isPublicAuthPath(path), path).toBe(false);
        }
    });

    it('フェディバースのログインの口は通し、ホストの形でない最後の段は通さない', () => {
        for (const path of [
            '/fediverse/start',
            '/fediverse/sign-up',
            '/fediverse/options',
            '/fediverse/callback/mi.example',
            '/fediverse/client/mastodon.example:8443',
        ]) {
            expect(isPublicAuthPath(path), path).toBe(true);
        }
        for (const path of [
            '/fediverse/callback/',
            '/fediverse/callback/mi.example/extra',
            '/fediverse/callback/MI.example',
            '/fediverse/callback/a%2Fb',
            '/fediverse/client/..',
            '/fediverse/unknown',
        ]) {
            expect(isPublicAuthPath(path), path).toBe(false);
        }
    });

    it('大文字・二重スラッシュ・エンコードなどの書き換えでは通さない', () => {
        for (const path of [
            '/SIGN-UP/email',
            '/Sign-In/Email',
            '//sign-in/email',
            '/sign-in/%65mail',
            '/sign-in/email/..',
        ]) {
            expect(isPublicAuthPath(path), path).toBe(false);
        }
    });
});
