/**
 * Go の起動・起動し直し・停止（偽のバイナリで確かめる）。子プロセスを残さないこと。
 */
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { startGo, superviseGo } from './goRuntime.ts';

const dir = mkdtempSync(join(tmpdir(), 'ubichill-fake-go-'));
const pidDir = join(dir, 'pids');
const delayFile = join(dir, 'delay');

/**
 * 偽の Go: --listen の場所で /health に答える。起動するたびに PID を記録し、delayFile の ms だけ待ってから待ち受ける。
 */
const fakeGo = join(dir, 'fake-instance');
writeFileSync(
    fakeGo,
    `#!${process.execPath}
const { createServer } = require('node:http');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
mkdirSync(${JSON.stringify(pidDir)}, { recursive: true });
writeFileSync(${JSON.stringify(pidDir)} + '/' + process.pid, '');
const [host, port] = process.argv.find((a) => a.startsWith('--listen=')).slice(9).split(':');
let delay = 0;
try { delay = Number(readFileSync(${JSON.stringify(delayFile)}, 'utf-8')); } catch {}
setTimeout(() => createServer((req, res) => { res.writeHead(200); res.end('{}'); }).listen(Number(port), host), delay);
`,
);
chmodSync(fakeGo, 0o755);

const alive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};
const startedPids = (): number[] => {
    try {
        return readdirSync(pidDir).map(Number);
    } catch {
        return [];
    }
};

afterAll(() => {
    for (const pid of startedPids()) if (alive(pid)) process.kill(pid, 'SIGKILL');
    rmSync(dir, { recursive: true, force: true });
});

describe('startGo', () => {
    it('起動して /health を待ち、stop は終わるまで待つ', async () => {
        writeFileSync(delayFile, '0');
        const runtime = await startGo({ binary: fakeGo, origins: [], log: () => {} });
        const pid = startedPids().at(-1) as number;
        expect(alive(pid)).toBe(true);
        await runtime.stop();
        expect(alive(pid)).toBe(false);
    });

    it('起動の途中で中止すると、子プロセスを止めてから reject する', async () => {
        writeFileSync(delayFile, '60000');
        const controller = new AbortController();
        const before = startedPids().length;
        const starting = startGo({ binary: fakeGo, origins: [], log: () => {}, signal: controller.signal });
        await vi.waitFor(() => expect(startedPids().length).toBe(before + 1), { timeout: 5000 });
        controller.abort();
        await expect(starting).rejects.toThrow('中止');
        expect(alive(startedPids().at(-1) as number)).toBe(false);
    });
});

describe('superviseGo', () => {
    it('落ちたら起動し直し、起動し直しの途中で止めても子プロセスが残らない', async () => {
        writeFileSync(delayFile, '0');
        const restarted = vi.fn();
        const go = superviseGo({ binary: fakeGo, origins: [], log: () => {}, onRestarted: restarted });
        await go.start();
        const first = startedPids().at(-1) as number;
        expect(go.current).toBeDefined();

        // 次の起動は /health に答えるまで時間がかかる（起動し直しの途中で止める）
        writeFileSync(delayFile, '60000');
        const before = startedPids().length;
        process.kill(first, 'SIGKILL');
        await vi.waitFor(() => expect(startedPids().length).toBe(before + 1), { timeout: 5000 });
        expect(go.current).toBeUndefined();

        await go.stop();
        for (const pid of startedPids()) expect(alive(pid), `pid ${pid}`).toBe(false);
        expect(restarted).not.toHaveBeenCalled();
    });

    it('起動し直しが終わると onRestarted を呼ぶ。止めた後は落ちても起動し直さない', async () => {
        writeFileSync(delayFile, '0');
        const restarted = vi.fn();
        const go = superviseGo({ binary: fakeGo, origins: [], log: () => {}, onRestarted: restarted });
        await go.start();
        process.kill(startedPids().at(-1) as number, 'SIGKILL');
        await vi.waitFor(() => expect(restarted).toHaveBeenCalledTimes(1), { timeout: 5000 });
        expect(go.current).toBeDefined();
        const count = startedPids().length;
        await go.stop();
        await new Promise((r) => setTimeout(r, 300));
        expect(startedPids().length).toBe(count);
        for (const pid of startedPids()) expect(alive(pid)).toBe(false);
        expect(readFileSync(delayFile, 'utf-8')).toBe('0');
    });

    it('killNow は起動の途中の子プロセスにも待たずに届く（node が落ちるときの最後の砦）', async () => {
        writeFileSync(delayFile, '60000');
        const go = superviseGo({ binary: fakeGo, origins: [], log: () => {} });
        const before = startedPids().length;
        const starting = go.start().catch(() => undefined);
        await vi.waitFor(() => expect(startedPids().length).toBe(before + 1), { timeout: 5000 });
        const pid = startedPids().at(-1) as number;
        go.killNow();
        await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 });
        await go.stop();
        await starting;
        writeFileSync(delayFile, '0');
    });
});
