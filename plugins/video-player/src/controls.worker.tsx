/**
 * video-player:controls Worker エントリ。
 *
 * ロジックは system/controls.ts、UI は ui/controls.ui.tsx に分離してある。
 * ここでは登録と初期化のみ。
 */

import { ControlsSystem, initControls } from './system/controls';

Ubi.registerSystem(ControlsSystem);
initControls();
