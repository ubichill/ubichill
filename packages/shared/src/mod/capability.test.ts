import { describe, expect, it } from 'vitest';
import {
    ALWAYS_ALLOWED_COMMANDS,
    buildAllowedCommands,
    CAPABILITY_CATALOG,
    CAPABILITY_COMMANDS,
    CAPABILITY_DETECTORS,
    CAPABILITY_RISK,
    describeCapability,
    detectCapabilities,
    getCapabilityRisk,
    listCapabilities,
} from './capability';

describe('getCapabilityRisk', () => {
    it('カタログ通りの危険度を返す', () => {
        expect(getCapabilityRisk('scene:read')).toBe('safe');
        expect(getCapabilityRisk('scene:update')).toBe('sensitive');
        expect(getCapabilityRisk('net:fetch')).toBe('dangerous');
    });

    it('host:message は内部通知なので sensitive（外部通信の dangerous ではない）', () => {
        // 既定シールドで確認プロンプトを出さないための分類。net:fetch のみ dangerous。
        expect(getCapabilityRisk('host:message')).toBe('sensitive');
    });

    it('未知の capability は dangerous 扱い（フェイルセーフ）', () => {
        expect(getCapabilityRisk('unknown:power')).toBe('dangerous');
        expect(getCapabilityRisk('')).toBe('dangerous');
    });
});

describe('CAPABILITY_CATALOG（単一の真実の源）', () => {
    it('全エントリが risk/commands/label/description を揃えている', () => {
        for (const [cap, spec] of Object.entries(CAPABILITY_CATALOG)) {
            expect(['safe', 'sensitive', 'dangerous'], `${cap} の risk が不正`).toContain(spec.risk);
            expect(spec.commands.length, `${cap} に commands が無い`).toBeGreaterThan(0);
            expect(spec.label.length, `${cap} に label が無い`).toBeGreaterThan(0);
            expect(spec.description.length, `${cap} に description が無い`).toBeGreaterThan(0);
        }
    });

    it('派生ビュー CAPABILITY_COMMANDS / CAPABILITY_RISK がカタログと一致する', () => {
        for (const [cap, spec] of Object.entries(CAPABILITY_CATALOG)) {
            expect(CAPABILITY_COMMANDS[cap]).toEqual(spec.commands);
            expect(CAPABILITY_RISK[cap]).toBe(spec.risk);
        }
        expect(Object.keys(CAPABILITY_COMMANDS).sort()).toEqual(Object.keys(CAPABILITY_CATALOG).sort());
    });
});

describe('CAPABILITY_DETECTORS（カタログとの drift-guard）', () => {
    it('全 detector の cap は CAPABILITY_CATALOG に実在する（typo・削除漏れの検知）', () => {
        const knownCaps = new Set(Object.keys(CAPABILITY_CATALOG));
        for (const d of CAPABILITY_DETECTORS) {
            expect(knownCaps.has(d.cap), `detector "${d.cap}" が CAPABILITY_CATALOG に存在しない`).toBe(true);
        }
    });

    it('detectCapabilities が返す capability も必ずカタログに実在する', () => {
        const knownCaps = new Set(Object.keys(CAPABILITY_CATALOG));
        const detected = detectCapabilities('Ubi.fetch(); Ubi.ui.render(); Ubi.canvas.frame(); Ubi.media.play();');
        for (const cap of detected) {
            expect(knownCaps.has(cap), `detectCapabilities が未知の capability "${cap}" を返した`).toBe(true);
        }
    });
});

describe('detectCapabilities（Ubi API の静的検出）', () => {
    it('Ubi.fetch から net:fetch を検出する', () => {
        expect(detectCapabilities('const r = await Ubi.fetch("https://api.example.com");')).toContain('net:fetch');
    });

    it('Ubi.ui.render から ui:render を検出する', () => {
        expect(detectCapabilities('Ubi.ui.render(() => <div/>);')).toContain('ui:render');
    });

    it('.showToast( から ui:toast を検出する', () => {
        expect(detectCapabilities('Ubi.ui.showToast("hi");')).toContain('ui:toast');
    });

    it('Ubi.entity / Ubi.state から scene:read と scene:update を検出する（over-approx）', () => {
        const caps = detectCapabilities('const e = Ubi.entity.self; Ubi.state.sync({});');
        expect(caps).toContain('scene:read');
        expect(caps).toContain('scene:update');
    });

    it('.broadcast( から event:broadcast、.sendToHost( から host:message を検出する', () => {
        const caps = detectCapabilities('Ubi.event.broadcast("x", {}); Ubi.event.sendToHost("user:update", {});');
        expect(caps).toContain('event:broadcast');
        expect(caps).toContain('host:message');
        expect(caps).toContain('event:emit');
    });

    it('Ubi.canvas → canvas:draw、Ubi.media → media:control', () => {
        expect(detectCapabilities('Ubi.canvas.frame();')).toContain('canvas:draw');
        expect(detectCapabilities('Ubi.media.play("t");')).toContain('media:control');
    });

    it('Ubi API を使わないコードは空配列を返す', () => {
        expect(detectCapabilities('const x = 1 + 2; console.log(x);')).toEqual([]);
    });

    it('emit だけのmodは host-message / broadcast を申告しない（過剰にならない）', () => {
        const caps = detectCapabilities('Ubi.event.emit("tick", {});');
        expect(caps).toContain('event:emit');
        expect(caps).not.toContain('event:broadcast');
        expect(caps).not.toContain('host:message');
    });

    it('結果はソート済み・重複なし', () => {
        const caps = detectCapabilities('Ubi.entity.self; Ubi.entity.query(); Ubi.ui.render();');
        expect(caps).toEqual([...new Set(caps)].sort());
    });
});

describe('describeCapability / listCapabilities（見える化）', () => {
    it('既知の capability を known=true で説明する', () => {
        const info = describeCapability('net:fetch');
        expect(info).toMatchObject({ capability: 'net:fetch', risk: 'dangerous', known: true });
        expect(info.label).not.toBe('');
        expect(info.description).not.toBe('');
    });

    it('未知の capability も known=false・dangerous で必ず説明を返す', () => {
        const info = describeCapability('mystery:power');
        expect(info).toMatchObject({ capability: 'mystery:power', risk: 'dangerous', known: false });
        expect(info.description.length).toBeGreaterThan(0);
    });

    it('listCapabilities はカタログ全件を返す', () => {
        const all = listCapabilities();
        expect(all).toHaveLength(Object.keys(CAPABILITY_CATALOG).length);
        expect(all.every((c) => c.known)).toBe(true);
    });
});

describe('buildAllowedCommands', () => {
    it('capabilities 未指定でもコアコマンドのみ許可する（default-deny）', () => {
        const allowed = buildAllowedCommands(undefined);
        expect([...allowed].sort()).toEqual([...ALWAYS_ALLOWED_COMMANDS].sort());
        // 宣言していない外部通信コマンドは決して含まれない
        expect(allowed.has('NETWORK_FETCH')).toBe(false);
    });

    it('空配列でもコアコマンドのみ許可する', () => {
        const allowed = buildAllowedCommands([]);
        expect([...allowed].sort()).toEqual([...ALWAYS_ALLOWED_COMMANDS].sort());
    });

    it('宣言 capability に対応するコマンドを追加する', () => {
        const allowed = buildAllowedCommands(['net:fetch']);
        expect(allowed.has('NETWORK_FETCH')).toBe(true);
        // コアコマンドは常に含まれる
        expect(allowed.has('CMD_LOG')).toBe(true);
    });

    it('未知の capability はコマンドを増やさない（無視される）', () => {
        const base = buildAllowedCommands([]);
        const withUnknown = buildAllowedCommands(['bogus:cap']);
        expect([...withUnknown].sort()).toEqual([...base].sort());
    });

    it('複数 capability の和集合を作る', () => {
        const allowed = buildAllowedCommands(['scene:read', 'scene:update']);
        expect(allowed.has('SCENE_GET_ENTITY')).toBe(true);
        expect(allowed.has('SCENE_CREATE_ENTITY')).toBe(true);
    });
});
