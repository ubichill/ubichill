import { expect, it } from 'vitest';
import { createModLock, type ModLockEntry } from '../schemas/modLock.schema';
import { addedModCapabilities, assertCapabilityUpdate, canAdvanceModVersion } from './updatePolicy';

const entry = (capabilities: string[]): ModLockEntry => ({
    id: 'demo',
    version: '1.0.0',
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    components: { 'demo:main': { workerUrl: 'main.js', integrity: `sha256-${'A'.repeat(43)}=`, capabilities } },
});
it('同じmod内の別のComponentが持つ権限でも、新たな天井への追加として確認する', () => {
    const before = createModLock({ demo: entry(['network:fetch']) });
    const next = createModLock({
        demo: {
            ...entry(['network:fetch']),
            components: {
                ...entry(['network:fetch']).components,
                'demo:new': {
                    workerUrl: 'new.js',
                    integrity: `sha256-${'A'.repeat(43)}=`,
                    capabilities: ['network:fetch'],
                },
            },
        },
    });
    expect(addedModCapabilities(before, next)).toEqual([
        { modId: 'demo', component: 'demo:new', capabilities: ['network:fetch'] },
    ]);
    expect(() => assertCapabilityUpdate(before, next, false)).toThrow('--accept-capabilities');
    expect(() => assertCapabilityUpdate(before, next, true)).not.toThrow();
});
it.each([
    ['2.0.0', '1.9.1', false],
    ['1.9.1', '2.0.0', true],
    ['1.9.1', '1.10.0', true],
    ['2.0.0', '2.0.0', true],
])('既存%sへ%sを登録・更新する判定は%s', (before, after, expected) =>
    expect(canAdvanceModVersion(before, after)).toBe(expected),
);
