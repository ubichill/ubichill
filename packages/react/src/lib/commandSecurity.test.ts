import { describe, expect, it } from 'vitest';
import { isOwnComponentCommand } from './commandSecurity';

describe('isOwnComponentCommand', () => {
    it('Host が確認した送信元と payload と mount 先が一致するときだけ許可する', () => {
        expect(isOwnComponentCommand('self', 'self', 'self')).toBe(true);
    });

    it.each([
        ['self', 'victim', 'self'],
        ['attacker-worker', 'self', 'self'],
        [undefined, 'self', 'self'],
    ])('別 Component を対象にした confused-deputy 攻撃を拒否する', (sender, payload, mounted) => {
        expect(isOwnComponentCommand(sender, payload, mounted)).toBe(false);
    });
});
