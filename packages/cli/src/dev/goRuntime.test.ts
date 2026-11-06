/**
 * Go の起動・起動し直し・停止（偽のバイナリで確かめる）。子プロセスを残さないこと。
 */
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordingLogger, silentLogger } from '@ubichill/terminal';
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

/**
 * ログを書く偽の Go（slog の JSONHandler の形）。1 行の JSON を 2 回に分けて書き（チャンクの境目で行が切れる）、
 * JSON でない行（panic など）も混ぜる。受け取った引数は debug の行に載せる。
 */
const loggingGo = join(dir, 'fake-logging-instance');
writeFileSync(
    loggingGo,
    `#!${process.execPath}
const { createServer } = require('node:http');
const { mkdirSync, writeFileSync } = require('node:fs');
mkdirSync(${JSON.stringify(pidDir)}, { recursive: true });
writeFileSync(${JSON.stringify(pidDir)} + '/' + process.pid, '');
const [host, port] = process.argv.find((a) => a.startsWith('--listen=')).slice(9).split(':');
const line = (o) => JSON.stringify({ time: '2026-11-06T12:01:03.123+09:00', ...o }) + '\\n';
process.stderr.write(line({ level: 'DEBUG', msg: 'args', args: process.argv.slice(2).join(' ') }));
process.stderr.write(line({ level: 'INFO', msg: 'listening', addr: host + ':' + port }));
const warn = line({ level: 'WARN', msg: 'slow room', room: 'r 1', took: '1.2s', req: { id: 7 } });
process.stderr.write(warn.slice(0, 20));
setTimeout(() => {
    process.stderr.write(warn.slice(20));
    process.stdout.write('panic: 日本語の行\\n');
    createServer((req, res) => { res.writeHead(200); res.end('{}'); }).listen(Number(port), host);
}, 50);
`,
);
chmodSync(loggingGo, 0o755);

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
        const runtime = await startGo({ binary: fakeGo, origins: [], log: silentLogger });
        const pid = startedPids().at(-1) as number;
        expect(alive(pid)).toBe(true);
        await runtime.stop();
        expect(alive(pid)).toBe(false);
    });

    it('起動の途中で中止すると、子プロセスを止めてから reject する', async () => {
        writeFileSync(delayFile, '60000');
        const controller = new AbortController();
        const before = startedPids().length;
        const starting = startGo({ binary: fakeGo, origins: [], log: silentLogger, signal: controller.signal });
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
        const go = superviseGo({ binary: fakeGo, origins: [], log: silentLogger, onRestarted: restarted });
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
        const go = superviseGo({ binary: fakeGo, origins: [], log: silentLogger, onRestarted: restarted });
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
        const go = superviseGo({ binary: fakeGo, origins: [], log: silentLogger });
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

describe('Go のログ', () => {
    const fromGo = (entries: readonly { message: string }[]) =>
        entries.filter((e) => !e.message.startsWith('Go を起動します') && !e.message.startsWith('Go が応答しました'));

    it('--log-format=json で起動し、warn と JSON でない行はいつも、info・debug は出さない（チャンクの境目で切れた行もまとめる）', async () => {
        const { logger, entries } = recordingLogger();
        const runtime = await startGo({ binary: loggingGo, origins: ['http://localhost:1'], log: logger });
        await vi.waitFor(() => expect(fromGo(entries)).toHaveLength(2), { timeout: 5000 });
        await runtime.stop();
        expect(fromGo(entries)).toEqual([
            { level: 'warn', message: 'slow room', detail: 'room="r 1" took=1.2s req.id=7' },
            { level: 'info', message: 'panic: 日本語の行' },
        ]);
    });

    it('--debug では Go を debug の level で起動し、info・debug の行も出す', async () => {
        const { logger, entries } = recordingLogger();
        const runtime = await startGo({ binary: loggingGo, origins: ['http://localhost:1'], log: logger, debug: true });
        await vi.waitFor(() => expect(fromGo(entries)).toHaveLength(4), { timeout: 5000 });
        await runtime.stop();
        const args = fromGo(entries).find((e) => e.message === 'args') as { detail?: string };
        expect(args.detail).toContain('--log-format=json');
        expect(args.detail).toContain('--log-level=debug');
        expect(fromGo(entries).map((e) => e.message)).toContain('listening');
    });
});
