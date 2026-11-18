import { describe, expect, it } from 'vitest';
import { renderCapabilityDocs } from './gen-capability-docs.mjs';

const spec = (risk, commands, label = 'ラベル', description = '説明') => ({ risk, commands, label, description });

const render = (catalog, detectors = []) =>
    renderCapabilityDocs({
        CAPABILITY_CATALOG: catalog,
        CAPABILITY_DETECTORS: detectors,
        PROTOCOL_VERSION: 9,
        MIN_COMPATIBLE_PROTOCOL_VERSION: 3,
    });

describe('renderCapabilityDocs', () => {
    it('カタログの並びに関係なく safe → sensitive → dangerous の順に節を出し、該当の無い危険度の節は出さない', () => {
        const md = render({
            'net:fetch': spec('dangerous', ['NETWORK_FETCH']),
            'ui:toast': spec('safe', ['UI_SHOW_TOAST']),
        });
        expect(md.indexOf('### safe')).toBeGreaterThan(-1);
        expect(md.indexOf('### safe')).toBeLessThan(md.indexOf('### dangerous'));
        expect(md).not.toContain('### sensitive');
        expect(md).toContain('**2** 件（🟢 1 / 🟡 0 / 🔴 1）');
    });

    it('検出ルールの無い capability は「自動検出対象外」、コマンドは <br> で区切る', () => {
        const md = render(
            {
                'avatar:set': spec('sensitive', ['AVATAR_SET', 'AVATAR_CLEAR'], 'アバター'),
                'net:fetch': spec('dangerous', ['NETWORK_FETCH'], '外部通信'),
            },
            [{ cap: 'net:fetch', api: 'Ubi.fetch' }],
        );
        expect(md).toContain('| `avatar:set` | アバター | （自動検出対象外） | 説明 | `AVATAR_SET`<br>`AVATAR_CLEAR` |');
        expect(md).toContain('| `net:fetch` | 外部通信 | `Ubi.fetch` |');
    });

    it('プロトコルの版を埋め込み、同じ入力からは同じ文字列を返す（--check が差分を誤検出しない）', () => {
        const catalog = { 'ui:toast': spec('safe', ['UI_SHOW_TOAST']) };
        const md = render(catalog);
        expect(md).toContain('`PROTOCOL_VERSION`: **9**');
        expect(md).toContain('`MIN_COMPATIBLE_PROTOCOL_VERSION`: **3**');
        expect(render(catalog)).toBe(md);
    });
});
