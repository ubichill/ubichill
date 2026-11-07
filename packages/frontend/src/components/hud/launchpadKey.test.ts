import { describe, expect, it } from 'vitest';
import { isLaunchpadToggle, type KeyLike } from './launchpadKey';

const esc = (patch: Partial<KeyLike> = {}): KeyLike => ({
    key: 'Escape',
    isComposing: false,
    keyCode: 27,
    repeat: false,
    ...patch,
});
const free = { open: false, typing: false, otherDialogOpen: false, riding: false };

describe('isLaunchpadToggle', () => {
    it('Esc で開け閉めする', () => {
        expect(isLaunchpadToggle(esc(), free)).toBe(true);
    });

    it('ほかのキーでは動かない', () => {
        expect(isLaunchpadToggle(esc({ key: 'Enter', keyCode: 13 }), free)).toBe(false);
    });

    it('日本語の変換中の Esc（変換の取り消し）では動かない。isComposing を立てないブラウザの 229 も', () => {
        expect(isLaunchpadToggle(esc({ isComposing: true }), free)).toBe(false);
        expect(isLaunchpadToggle(esc({ keyCode: 229 }), free)).toBe(false);
    });

    it('押しっぱなしの繰り返しでは開け閉めを繰り返さない', () => {
        expect(isLaunchpadToggle(esc({ repeat: true }), free)).toBe(false);
    });

    it('入力欄で打っている間・確認のダイアログが出ている間は、そちらに任せる', () => {
        expect(isLaunchpadToggle(esc(), { ...free, typing: true })).toBe(false);
        expect(isLaunchpadToggle(esc(), { ...free, otherDialogOpen: true })).toBe(false);
        expect(isLaunchpadToggle(esc(), { ...free, open: true, otherDialogOpen: true })).toBe(false);
    });

    it('乗り物に乗っている間の Esc は降りる操作に譲って開かない。開いているランチパッドは閉じられる', () => {
        expect(isLaunchpadToggle(esc(), { ...free, riding: true })).toBe(false);
        expect(isLaunchpadToggle(esc(), { ...free, riding: true, open: true })).toBe(true);
    });
});
