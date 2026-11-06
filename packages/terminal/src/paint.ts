/**
 * 色付け。色を付けるかは作るときに決め、以降は同じ入力に同じ出力を返す（テストでは色ありも色なしも試せる）。
 */
import { stripVTControlCharacters, styleText } from 'node:util';

export type Tone = 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'gray' | 'bold' | 'dim';

/** `tone` を重ねて `text` を塗る。bold と dim は閉じる符号が同じなので重ねない（内側の閉じで外側も消える）。 */
export type Paint = (tone: Tone | readonly Tone[], text: string) => string;

export const plainPaint: Paint = (_tone, text) => text;

export const ansiPaint: Paint = (tone, text) =>
    text === ''
        ? ''
        : (typeof tone === 'string' ? [tone] : tone).reduce(
              // validateStream: false — 色を付けるかは colorEnabled で決め済み。styleText に stdout で判定し直させない
              (painted, t) => styleText(t, painted, { validateStream: false }),
              text,
          );

export const createPaint = (enabled: boolean): Paint => (enabled ? ansiPaint : plainPaint);

/** ANSI の制御符号を取り除く（幅の計算・色の無いログ・テスト）。 */
export const stripAnsi = (text: string): string => stripVTControlCharacters(text);
