/**
 * `ubichill`（引数なし・--help）の案内。
 */
import { displayWidth, type Paint, padDisplay } from '@ubichill/terminal';
import { DEBUG_FLAG } from './output.ts';

export const COMMANDS: readonly (readonly [usage: string, summary: string])[] = [
    ['dev [world.yaml]', '手元の mod を本番と同じ Go で動かす開発サーバー'],
    ['build', 'mod をビルドする'],
    ['install <world.yaml>', 'ワールドが使う mod を固定する（<world>.lock.json）'],
    ['update <world.yaml>', '版を固定した mod を最新にする'],
    ['verify [world.yaml]', 'mod のビルド（lock と署名）か、ワールドの署名を確かめる'],
    ['world build <world.yaml>', 'Go に渡すワールドの定義 JSON を作る'],
    ['login', 'ブラウザで承認して、この端末から公開できるようにする'],
    ['logout', 'この端末の公開環境を取り消す'],
    ['whoami', 'ログインしているアカウントを表示する'],
    ['publish <world.yaml | dist>', 'ワールド・mod に署名して公開する'],
    ['ci create --name=<表示名>', 'CI 用の公開環境を作る'],
];

export function formatHelp(version: string | undefined, paint: Paint): string {
    const width = Math.max(...COMMANDS.map(([usage]) => displayWidth(usage))) + 2;
    return [
        `${paint(['green', 'bold'], 'ubichill')}${version ? `  ${paint('green', `v${version}`)}` : ''}`,
        '',
        `使い方: ubichill <コマンド> [...オプション] [${DEBUG_FLAG}]`,
        '',
        ...COMMANDS.map(([usage, summary]) => `  ${paint('cyan', padDisplay(usage, width))}${summary}`),
        '',
        `  ${paint('cyan', padDisplay(DEBUG_FLAG, width))}ログを詳しくし、失敗にスタックトレースを付ける（UBICHILL_DEBUG=1 と同じ）`,
        '',
        paint(
            'dim',
            '各コマンドの詳しいオプションは README（https://www.npmjs.com/package/@ubichill/cli）を見てください',
        ),
    ].join('\n');
}
