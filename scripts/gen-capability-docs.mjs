/**
 * gen-capability-docs.mjs
 *
 * 権限（capability）ドキュメントを単一の真実源から自動生成する。
 *
 * 生成物: docs/CAPABILITIES.md
 * 出所  : packages/shared/src/mod/capability.ts の CAPABILITY_CATALOG
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
import { CAPABILITY_DETECTORS } from './build-workers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// capability → それを付ける Ubi API のヒント（静的検出ルール由来。build-workers.mjs が正）。
const API_BY_CAP = Object.fromEntries(CAPABILITY_DETECTORS.map((d) => [d.cap, d.api]));

// カタログ + プロトコル定数を @ubichill/shared から 1 バンドルに集約して data URL 経由で読み込む。
// @ubichill/shared は sandbox パッケージ配下に symlink されているため resolveDir を sandbox にする。
const sandboxDir = join(root, 'packages', 'sandbox');
const entry = `
export { CAPABILITY_CATALOG, PROTOCOL_VERSION, MIN_COMPATIBLE_PROTOCOL_VERSION } from '@ubichill/shared';
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
            const api = API_BY_CAP[cap] ? `\`${API_BY_CAP[cap]}\`` : '（自動検出対象外）';
            return `| \`${cap}\` | ${spec.label} | ${api} | ${spec.description} | ${commands} |`;
        });
    if (rows.length === 0) return '';
    const meta = RISK_META[risk];
    return [
        `### ${meta.heading}`,
        '',
        meta.note,
        '',
        '| capability | ラベル | 発生元 API | 説明 | 許可されるコマンド |',
        '| --- | --- | --- | --- | --- |',
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
[\`packages/shared/src/mod/capability.ts\`](../packages/shared/src/mod/capability.ts) から生成している。

- 定義済み capability: **${total}** 件（🟢 ${countByRisk('safe')} / 🟡 ${countByRisk('sensitive')} / 🔴 ${countByRisk('dangerous')}）
- 未知の権限は安全側に倒して **dangerous** として扱われる（承認必須）。

## 危険度ティア

| ティア | 既定の挙動 |
| --- | --- |
| ${RISK_META.safe.badge} | 自動許可（確認なし） |
| ${RISK_META.sensitive.badge} | 既定で許可・設定で要承認に変更可 |
| ${RISK_META.dangerous.badge} | 明示承認が必要 |

## 同意モデル

ゼロトラストで、信頼境界は Worker→Host の postMessage 一点。**mod 開発者は権限を宣言しない**
（使用 API からビルド時に自動生成される）。実際の許可はユーザーが与える。

- **mod 読み込み時に一括承認**: mod（Worker）が読み込まれた時点で、承認が要る capability を
  1 つのダイアログでまとめて許可/拒否する（実行時プロンプトではない）。途中で追加した mod も同様。
  **決定が済むまで Worker は実行しない**（コードのダウンロードのみ）ため「確認前に動く」ことがない。
  決定後は許可/拒否どちらでも Worker は動き、拒否された権限は実行時ゲートが個別に拒否する
  （mod 丸ごと停止にはしない）。実行時ゲートは**プロンプトを出さず即時に許可判定だけ**行う
  （高頻度 RPC がタイムアウトしない）。決定は localStorage に記憶。拒否診断は 3 秒レート制限。
- **fetch はドメイン単位で on-demand**（ドメインは読み込み時に不明なため）: \`net:fetch\` は
  ゲートを常に通し、実通信は**接続先ホスト名ごと**に「今回だけ / 次回以降も許可 / 拒否」の 3 択で承認。
  ポリシー: ① 自mod のアセット領域（modBase 配下）は承認不要 / ② 自mod の公開名前空間
  \`/mods/<modId>/\` も承認不要 / ③ 本体オリジンのそれ以外（コア \`/api\`・他mod領域）は**禁止** /
  ④ それ以外の外部ドメインはドメイン単位で承認。
- **シールドレベル**（設定画面）: なし / 確認（既定・危険のみ）/ 厳格な確認（注意も）/ 拒否。
- enforcement は単一ゲート。未承認コマンドは拒否（RPC は \`CAPABILITY_DENIED\`）。拒否は必ず
  console 診断＋トーストに出るため沈黙しない。

## capability 一覧

「発生元 API」= その API を mod が使うとビルド時にこの capability が自動付与される、の意。

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
