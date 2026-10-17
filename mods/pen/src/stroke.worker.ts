/**
 * pen:stroke — 確定したストローク 1 本（CanvasStrokeData）を持つデータ専用の Component。
 *
 * Worker は持たない。canvas.worker.ts が描いたペン Entity の子として spawn し、後から入った人の
 * 描き直しに使う。ここで宣言しておくと、Host は pen:stroke を pen のデータと認識し、Worker を探さない。
 * このファイルはバンドルも実行もされない（config だけが manifest に載る）。
 */

import type { ComponentConfig } from 'ubichill';

export const config: ComponentConfig = {
    dataOnly: true,
    description: '確定したストローク 1 本（点・色・太さ・描くか消すか）',
};
