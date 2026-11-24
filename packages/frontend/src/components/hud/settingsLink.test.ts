import { publishingEnvironmentSettingsPath } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    clearSettingsLink,
    keepSettingsLink,
    readSettingsLink,
    type SettingsLinkStore,
    settingsLinkOf,
} from './settingsLink';

function memoryStore(): SettingsLinkStore & { items: Map<string, string> } {
    const items = new Map<string, string>();
    return {
        items,
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => void items.set(key, value),
        removeItem: (key) => void items.delete(key),
    };
}

describe('settingsLinkOf', () => {
    it('通知メールのリンク（shared が作る path）から「公開」と目立たせる公開環境を読む', () => {
        const url = new URL(publishingEnvironmentSettingsPath('env/1&x'), 'https://ubichill.example');
        expect(settingsLinkOf(url.pathname.split('/')[2], url.search)).toEqual({
            section: 'publishing',
            environment: 'env/1&x',
        });
    });

    it('知らない欄は開かない。公開環境の指定は「公開」でしか使わない', () => {
        expect(settingsLinkOf('control', '')).toBeNull();
        expect(settingsLinkOf(undefined, '')).toBeNull();
        expect(settingsLinkOf('constructor', '')).toBeNull();
        expect(settingsLinkOf('account', '?environment=e1')).toEqual({ section: 'account', environment: null });
        expect(settingsLinkOf('publishing', '?environment=')).toEqual({ section: 'publishing', environment: null });
        expect(settingsLinkOf('publishing', `?environment=${'x'.repeat(201)}`)?.environment).toBeNull();
    });
});

describe('持ち越し', () => {
    it('ホームの部屋に入るまで持ち越し、捨てたら次は開かない', () => {
        const store = memoryStore();
        keepSettingsLink(store, { section: 'publishing', environment: 'e1' });
        expect(readSettingsLink(store)).toEqual({ section: 'publishing', environment: 'e1' });
        clearSettingsLink(store);
        expect(readSettingsLink(store)).toBeNull();
    });

    it('壊れた・書き換えられた記録では開かない（知らない欄・公開以外の公開環境は捨てる）', () => {
        const store = memoryStore();
        for (const raw of ['{', 'null', '"publishing"', '{"section":"control"}', '{"section":["publishing"]}']) {
            store.items.set('ubichill:settings-link', raw);
            expect(readSettingsLink(store)).toBeNull();
        }
        store.items.set('ubichill:settings-link', '{"section":"privacy","environment":"e1"}');
        expect(readSettingsLink(store)).toEqual({ section: 'privacy', environment: null });
        store.items.set('ubichill:settings-link', '{"section":"publishing","environment":42}');
        expect(readSettingsLink(store)).toEqual({ section: 'publishing', environment: null });
    });
});
