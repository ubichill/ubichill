/**
 * world.html のビルド（vite.world.config.ts）が CSS を抽出するときの Panda の設定。
 * テーマ・トークンは SNS と同じで、抽出の対象を world.html から辿ってよいファイル（scripts/architecture.mjs の
 * WORLD_APP_ALLOWED。world-app-closure の規則が検査する範囲）だけにする。SNS の画面のスタイルは world.html の CSS に入らない。
 */
import { defineConfig } from '@pandacss/dev';
import { WORLD_APP_ALLOWED } from '../../scripts/architecture.mjs';
import base from './panda.config';

export default defineConfig({
    ...base,
    include: WORLD_APP_ALLOWED.map((path) => (path.endsWith('/') ? `./src/${path}**/*.{ts,tsx}` : `./src/${path}`)),
});
