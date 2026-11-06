/**
 * 起動し終えたときの案内（Vite の「ready in」と同じ形）。起動の最後に 1 回だけ出す。
 *
 *   ubichill dev  v1.0.2  ready in 812 ms
 *
 *   ➜  Local:   http://localhost:3333/
 *   ➜  World:   worlds/chillwa.yaml  (mods 2, local 0)
 */
import type { LineStyle } from './event.ts';
import { formatDuration } from './format.ts';
import type { Paint } from './paint.ts';
import { displayWidth, padDisplay } from './width.ts';

export interface BannerRow {
    readonly label: string;
    readonly value: string;
    /** 値の後ろに薄く付ける補足。 */
    readonly note?: string;
    /** `url` は cyan（ポートは太字）、`dim` は値ごと薄く、`warn` は黄色（起動はしたが直すものがある）。 */
    readonly tone?: 'url' | 'plain' | 'dim' | 'warn';
}

export interface Banner {
    readonly title: string;
    readonly version?: string;
    readonly readyMs?: number;
    readonly rows: readonly BannerRow[];
}

/** ラベルの欄の最小の幅（`Network:` が入る幅。行が 1 つでも Vite と同じ位置に値を揃える）。 */
const MIN_LABEL_WIDTH = 'Network:'.length;

export function paintUrl(url: string, paint: Paint): string {
    const match = /^(https?:\/\/(?:\[[^\]]*\]|[^/:[]*):)(\d+)(.*)$/.exec(url);
    if (!match) return paint('cyan', url);
    const [, head = '', port = '', tail = ''] = match;
    return `${paint('cyan', head)}${paint(['cyan', 'bold'], port)}${paint('cyan', tail)}`;
}

function paintValue(row: BannerRow, paint: Paint): string {
    if (row.tone === 'url') return paintUrl(row.value, paint);
    if (row.tone === 'dim') return paint('dim', row.value);
    if (row.tone === 'warn') return paint('yellow', row.value);
    return row.value;
}

export function formatBanner(banner: Banner, { paint, symbols }: LineStyle): string {
    const headline = [
        paint(['green', 'bold'], banner.title),
        banner.version ? paint('green', `v${banner.version}`) : '',
        banner.readyMs === undefined
            ? ''
            : `${paint('dim', 'ready in')} ${paint('bold', formatDuration(banner.readyMs))}`,
    ]
        .filter((part) => part !== '')
        .join('  ');
    const labelWidth = Math.max(MIN_LABEL_WIDTH, ...banner.rows.map((row) => displayWidth(row.label) + 1)) + 1;
    const rows = banner.rows.map((row) => {
        const label = `${paint('bold', row.label)}:`;
        const note = row.note ? `  ${paint('dim', row.note)}` : '';
        return `  ${paint('green', symbols.arrow)}  ${padDisplay(label, labelWidth)}${paintValue(row, paint)}${note}`;
    });
    return ['', `  ${headline}`, ...(rows.length > 0 ? ['', ...rows] : []), ''].join('\n');
}
