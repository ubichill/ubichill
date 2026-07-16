/**
 * gen-capability-docs.mjs
 *
 * 権限（capability）ドキュメントを単一の真実源から自動生成する。
 *
 * 生成物: docs/CAPABILITIES.md
 * 出所  : packages/sandbox/src/host/capability.ts の CAPABILITY_CATALOG
 *         + packages/shared の PROTOCOL_VERSION（プロトコル互換ルール）
 *
 * mod 開発者が「どの権限で何ができるか・危険度・既定の許可挙動」を迷わず確認でき、
 * かつカタログを変更したら `pnpm docs:capabilities` で常に最新へ再生成できる。
 * 手書きしないことで定義とドキュメントの乖離を防ぐ。
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// カタログ + プロトコル定数を 1 バンドルに集約して data URL 経由で読み込む。
// @ubichill/shared は sandbox パッケージ配下に symlink されているため、
// resolveDir を sandbox にして bare import を解決させる（capability.ts は絶対パス指定）。
const sandboxDir = join(root, 'packages', 'sandbox');
const capabilityPath = join(sandboxDir, 'src', 'host', 'capability.ts');
const entry = `
export { CAPABILITY_CATALOG } from ${JSON.stringify(capabilityPath)};
export { PROTOCOL_VERSION, MIN_COMPATIBLE_PROTOCOL_VERSION } from '@ubichill/shared';
`;

const { outputFiles } = await esbuild.build({
    stdin: { contents: entry, resolveDir: sandboxDir, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
});

const dataUrl = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`;
const { CAPABILITY_CATALOG, PROTOCOL_VERSION, MIN_COMPATIBLE_PROTOCOL_VERSION } = await import(dataUrl);

// ── 危険度メタ（表示順と説明。capability.ts の CapabilityRisk と対応）────────
const RISK_META = {
    safe: {
        heading: 'safe（安全）',
        badge: '🟢 safe',
        note: 'ワールド内で完結し外部副作用・情報流出が無い。**常に自動許可**され、ユーザーへの確認は出ない。',
    },
    sensitive: {
        heading: 'sensitive（要注意）',
        badge: '🟡 sensitive',
        note: 'ワールド状態を書き換えるが外部へは出ない。**既定で許可**（ユーザー設定で「要承認」に変更可）。',
    },
    dangerous: {
        heading: 'dangerous（危険）',
        badge: '🔴 dangerous',
        note: '外部通信など情報流出/外部API操作のリスク。**既定で明示承認を要求**する。',
    },
};
const RISK_ORDER = ['safe', 'sensitive', 'dangerous'];

const entries = Object.entries(CAPABILITY_CATALOG);

const section = (risk) => {
    const rows = entries
        .filter(([, spec]) => spec.risk === risk)
        .map(([cap, spec]) => {
            const commands = spec.commands.map((c) => `\`${c}\``).join('<br>');
            return `| \`${cap}\` | ${spec.label} | ${spec.description} | ${commands} |`;
        });
    if (rows.length === 0) return '';
    const meta = RISK_META[risk];
    return [
        `### ${meta.heading}`,
        '',
        meta.note,
        '',
        '| capability | ラベル | 説明 | 許可されるコマンド |',
        '| --- | --- | --- | --- |',
        ...rows,
        '',
    ].join('\n');
};

const total = entries.length;
const countByRisk = (risk) => entries.filter(([, s]) => s.risk === risk).length;

const md = `<!-- このファイルは scripts/gen-capability-docs.mjs による自動生成物です。手で編集しないでください。 -->
<!-- 再生成: pnpm docs:capabilities -->

# mod 権限（capability）リファレンス

mod は必要な権限を \`mod.json\` の \`capabilities\` で宣言する（ビルド時に静的解析で自動補完もされる）。
宣言していない権限のコマンドは **default-deny** で拒否される。ここは唯一の定義元
[\`packages/sandbox/src/host/capability.ts\`](../packages/sandbox/src/host/capability.ts) から生成している。

- 定義済み capability: **${total}** 件（🟢 ${countByRisk('safe')} / 🟡 ${countByRisk('sensitive')} / 🔴 ${countByRisk('dangerous')}）
- 未知の権限は安全側に倒して **dangerous** として扱われる（承認必須）。

## 危険度ティア

| ティア | 既定の挙動 |
| --- | --- |
| ${RISK_META.safe.badge} | 自動許可（確認なし） |
| ${RISK_META.sensitive.badge} | 既定で許可・設定で要承認に変更可 |
| ${RISK_META.dangerous.badge} | 明示承認が必要 |

## capability 一覧

${RISK_ORDER.map(section).filter(Boolean).join('\n')}
## プロトコルバージョン

SDK（mod）と Host（本体）は独立して更新されるため、初期化時に互いのプロトコルバージョンを
名乗り合い、非互換を検出して警告する（詳細は
[\`packages/shared/src/mod/protocol.ts\`](../packages/shared/src/mod/protocol.ts)）。

- 現在の \`PROTOCOL_VERSION\`: **${PROTOCOL_VERSION}**
- 互換可能な最小バージョン \`MIN_COMPATIBLE_PROTOCOL_VERSION\`: **${MIN_COMPATIBLE_PROTOCOL_VERSION}**

進化ルール（後方互換の生命線）:

- コマンド名・イベント名の値は **削除・改名しない**（追加のみ）。ペイロードのフィールドは optional でのみ追加する。
- 加算的変更のたびに \`PROTOCOL_VERSION\` を +1 する。
- やむなく互換を壊す変更のときだけ \`MIN_COMPATIBLE_PROTOCOL_VERSION\` を引き上げる。

加算的進化である限り「古い mod × 新しい Host」は常に動作する。危険なのは「mod が Host より新しい」場合のみで、
このとき Host は未対応コマンドを持たない恐れがあるため \`degraded\` として開発者に警告する。
`;

const outPath = join(root, 'docs', 'CAPABILITIES.md');
const prev = (() => {
    try {
        return readFileSync(outPath, 'utf8');
    } catch {
        return null;
    }
})();

if (prev === md) {
    console.log('docs/CAPABILITIES.md は最新です（変更なし）');
} else {
    writeFileSync(outPath, md);
    console.log(`docs/CAPABILITIES.md を生成しました（capability ${total} 件, protocol v${PROTOCOL_VERSION}）`);
}
