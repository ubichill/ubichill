/**
 * 値の表し方（時間・時刻・大きさ）。
 */

/** `812 ms`・`1.2 s`・`2 min 5 s`・`1 h 3 min`。負の値は 0 とみなす（時計の巻き戻り）。数でなければ `-`。 */
export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms)) return '-';
    const safe = Math.max(0, ms);
    // 丸めた後の値で単位を選ぶ（999.6 ms を「1000 ms」、59.96 s を「60.0 s」にしない）
    if (Math.round(safe) < 1000) return `${Math.round(safe)} ms`;
    const tenths = Math.round(safe / 100);
    if (tenths < 600) return `${(tenths / 10).toFixed(1)} s`;
    const seconds = Math.round(safe / 1000);
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
    const minutes = Math.round(safe / 60_000);
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 手元の時刻 `HH:MM:SS`（長く動くコマンドのイベントの頭）。 */
export function formatClock(date: Date): string {
    if (Number.isNaN(date.getTime())) return '--:--:--';
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** `812 B`・`48.3 kB`・`1.2 MB`（1000 区切り。Vite と同じ）。 */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '-';
    const whole = Math.round(bytes);
    if (whole < 1000) return `${whole} B`;
    const kilo = Math.round(whole / 100) / 10;
    if (kilo < 1000) return `${kilo.toFixed(1)} kB`;
    return `${(Math.round(whole / 100_000) / 10).toFixed(1)} MB`;
}
