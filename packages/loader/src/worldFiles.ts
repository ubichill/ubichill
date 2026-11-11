import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** 解決が完了してから書く。途中の書き込み失敗では元へ戻す。同時更新は原文比較で拒否する。 */
export function writeWorldFiles(changes: Array<{ path: string; text: string; expected?: string | null }>): void {
    const files = changes.map((c) => ({
        ...c,
        old: existsSync(c.path) ? readFileSync(c.path, 'utf8') : null,
        temp: `${c.path}.${randomUUID()}.tmp`,
    }));
    if (files.some((c) => c.expected !== undefined && c.old !== c.expected))
        throw new Error('編集中にファイルが変わりました。読み直して実行してください');
    const written: typeof files = [];
    try {
        for (const c of files) writeFileSync(c.temp, c.text, { flag: 'wx' });
        for (const c of files) {
            renameSync(c.temp, c.path);
            written.push(c);
        }
    } catch (error) {
        for (const c of written.reverse()) {
            if (c.old === null) rmSync(c.path, { force: true });
            else writeFileSync(c.path, c.old);
        }
        throw error;
    } finally {
        for (const c of files) rmSync(c.temp, { force: true });
    }
}
