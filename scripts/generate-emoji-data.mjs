#!/usr/bin/env node
/**
 * 絵文字を選ぶ画面のデータ（packages/frontend/src/lib/emoji/emojiData.json）を emojibase-data（MIT、名前は CLDR）から作る。
 * 画面は遅延読み込みでこれだけを読むので、必要な項目（絵文字・日本語の名前・検索の語）だけに絞る。
 *   node scripts/generate-emoji-data.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = join(root, 'packages/frontend');
const require = createRequire(join(frontend, 'package.json'));
const ja = require('emojibase-data/ja/data.json');
const en = require('emojibase-data/en/data.json');
const messages = require('emojibase-data/ja/messages.json');

// 新しすぎる版は OS のフォントに無く豆腐になるので、広く出せる版までにする
const MAX_VERSION = 15.1;
// 肌色・髪型の部品（単独では選ばない）
const COMPONENT_GROUP = 2;

const enByHex = new Map(en.map((e) => [e.hexcode, e]));
const words = (list) => [...new Set(list.join(' ').toLowerCase().split(/\s+/).filter(Boolean))].join(' ');

const groups = messages.groups
    .filter((g) => g.order !== COMPONENT_GROUP)
    .toSorted((a, b) => a.order - b.order)
    .map((g) => ({
        key: g.key,
        label: g.message,
        emojis: ja
            .filter((e) => e.group === g.order && e.version <= MAX_VERSION)
            .toSorted((a, b) => a.order - b.order)
            .map((e) => {
                const english = enByHex.get(e.hexcode);
                return [
                    e.emoji,
                    e.label,
                    words((e.tags ?? []).filter((t) => t !== e.label)),
                    words([english?.label ?? '', ...(english?.tags ?? [])]),
                ];
            }),
    }));

const out = join(frontend, 'src/lib/emoji/emojiData.json');
writeFileSync(out, `${JSON.stringify({ groups })}\n`);
execFileSync(join(root, 'node_modules/.bin/biome'), ['format', '--write', out], { stdio: 'inherit' });
console.log(`${groups.reduce((n, g) => n + g.emojis.length, 0)} emojis -> ${out}`);
