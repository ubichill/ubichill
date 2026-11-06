import { createServerLogger } from '@ubichill/terminal';
import { debugFromEnv } from '../config/debug';

/**
 * backend のロガー。1 つの出来事を 1 行にし（本番は ISO 時刻・色なし、手元の端末は短い時刻・色付き）、level を残す。
 * debug を出すかは appConfig.debug と同じ規則で、呼ぶたびに env を読む（.env を読み込んだ後の値に従う）。
 * 設定（config）は読み込まない: 読み込むと、ロガーを使うだけのモジュールのテストでも設定の検証が走る。
 */
export const logger = createServerLogger({ debug: () => debugFromEnv(process.env.DEBUG, process.env.NODE_ENV) });
