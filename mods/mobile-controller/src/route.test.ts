import { describe, expect, it } from 'vitest';
import { controllerRoute } from './route';

describe('controllerRoute', () => {
    it('target を設定していれば参照で送る', () => {
        expect(controllerRoute('ship', true)).toEqual({ ref: 'target' });
    });

    it('target が未設定・空・壊れた値なら v1 と同じく自分の Entity（と子）へ送る', () => {
        for (const target of [undefined, null, '', 42, ['ship']]) {
            expect(controllerRoute(target, true)).toEqual({ scope: 'subtree' });
        }
    });

    it('参照での配送に対応していない古い Host では、target があっても自分の Entity へ送る', () => {
        expect(controllerRoute('ship', false)).toEqual({ scope: 'subtree' });
    });
});
