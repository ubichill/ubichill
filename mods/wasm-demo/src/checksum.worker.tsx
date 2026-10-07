/**
 * wasm-demo:checksum Worker — 同梱 WASM で FNV-1a を計算するサンプル。
 *
 * 確かめること:
 *  - 同梱アセット（fnv1a.wasm・sample.txt）を Ubi.asset で読む（Host が manifest の integrity と照合する）。
 *  - 外部 URL の本文を Ubi.fetch でバイト列のまま受け取る（ドメイン承認・上限・取り消し）。
 *  - WASM に渡して計算し、結果を UI に返す。
 */
import type { ComponentConfig } from 'ubichill';
import { createWasmHasher, toHex, type WasmHasher } from './fnv1a';

export const config: ComponentConfig = {
    defaultTransform: { x: 40, y: 40, z: 10, w: 380, h: 250 },
    description: '同梱した WASM で FNV-1a を計算するサンプル（同梱アセット・バイナリ fetch・WASM 実行の確認用）。',
};

const MAX_FETCH_BYTES = 8 * 1024 * 1024;

const view = Ubi.state.define({
    asset: '計算中',
    url: 'https://cdn.jsdelivr.net/npm/ubichill/package.json',
    result: '',
    busy: false,
});

const inflight = new Set<AbortController>();

function errorText(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${code}: ${error.message}` : error.message;
}

async function loadHasher(): Promise<WasmHasher> {
    Ubi.runtime.require('wasm');
    return createWasmHasher(await Ubi.asset.wasm('fnv1a.wasm'));
}

const hasher = loadHasher();

async function digestOf(bytes: ArrayBuffer): Promise<string> {
    return `${bytes.byteLength} byte / ${toHex((await hasher).digest(new Uint8Array(bytes)))}`;
}

void Ubi.asset
    .bytes('sample.txt')
    .then(digestOf)
    .then(
        (text) => {
            view.local.asset = text;
        },
        (error: unknown) => {
            view.local.asset = errorText(error);
        },
    );

async function fetchAndDigest(): Promise<void> {
    const controller = new AbortController();
    inflight.add(controller);
    view.local.busy = true;
    view.local.result = '取得中';
    try {
        const res = await Ubi.fetch(view.local.url, {
            responseType: 'arrayBuffer',
            maxBytes: MAX_FETCH_BYTES,
            signal: controller.signal,
        });
        view.local.result = res.ok
            ? await digestOf(res.body)
            : `取得できませんでした: ${res.error?.code ?? `HTTP ${res.status}`}`;
    } catch (error) {
        view.local.result = errorText(error);
    } finally {
        inflight.delete(controller);
        view.local.busy = inflight.size > 0;
    }
}

function cancelAll(): void {
    for (const controller of inflight) controller.abort();
}

const row = { display: 'flex', gap: '6px', alignItems: 'center' };
const label = { fontSize: '11px', color: '#94a3b8' };
const value = { fontFamily: 'ui-monospace, monospace', fontSize: '12px', wordBreak: 'break-all' };
const button = {
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid #475569',
    background: '#1e293b',
    color: '#e2e8f0',
    cursor: 'pointer',
};

export default function ChecksumView() {
    const busy = view.local.busy;
    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                boxSizing: 'border-box',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                borderRadius: '10px',
                background: '#0f172a',
                color: '#e2e8f0',
                fontFamily: 'system-ui, sans-serif',
            }}
        >
            <div style={{ fontSize: '13px', fontWeight: '600' }}>WASM チェックサム (FNV-1a)</div>
            <div>
                <div style={label}>同梱アセット sample.txt</div>
                <div style={value}>{view.local.asset}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={label}>外部 URL の本文（許可したドメインのみ・最大 8 MiB）</div>
                <input
                    type="url"
                    value={view.local.url}
                    onUbiInput={(next: unknown) => {
                        view.local.url = String(next);
                    }}
                    style={{
                        padding: '4px 6px',
                        borderRadius: '6px',
                        border: '1px solid #475569',
                        background: '#020617',
                        color: '#e2e8f0',
                    }}
                />
                <div style={row}>
                    <button type="button" disabled={busy} onUbiClick={() => void fetchAndDigest()} style={button}>
                        取得して計算
                    </button>
                    <button type="button" disabled={!busy} onUbiClick={cancelAll} style={button}>
                        取り消し
                    </button>
                </div>
                <div style={value}>{view.local.result}</div>
            </div>
        </div>
    );
}
