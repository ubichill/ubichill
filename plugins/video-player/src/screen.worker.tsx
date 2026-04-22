/**
 * video-player:screen Worker エントリ。
 *
 * ロジックは system/screen.ts に分離してある。ここでは登録と初期化のみ。
 */

import { initScreen, ScreenSystem } from './system/screen';

Ubi.registerSystem(ScreenSystem);
initScreen();
