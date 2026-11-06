/**
 * npm の公開物をソースから束ねるタスクは、依存パッケージのソースの変更でキャッシュが外れること（^transit）。
 * これが無いと、react・sandbox などを変えても turbo のキャッシュが当たり、古いコードが配布物に入る。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const turbo = JSON.parse(readFileSync(new URL('../turbo.json', import.meta.url), 'utf-8'));

describe('turbo.json', () => {
    it('transit は依存の transit だけに依存する（何も実行せず、依存の中身をハッシュに入れる）', () => {
        expect(turbo.tasks.transit).toEqual({ dependsOn: ['^transit'] });
    });

    it.each(['@ubichill/frontend#build:world', '@ubichill/cli#build', '@ubichill/sdk#build'])(
        '%s は依存パッケージのソースをハッシュに入れる',
        (task) => {
            expect(turbo.tasks[task]?.dependsOn).toContain('^transit');
        },
    );

    it('cli は world.html だけのビルドに依存し、SNS の画面のビルドには依存しない', () => {
        const deps = turbo.tasks['@ubichill/cli#build'].dependsOn;
        expect(deps).toContain('@ubichill/frontend#build:world');
        expect(deps).not.toContain('@ubichill/frontend#build');
    });

    it('パッケージの外の入力は $TURBO_ROOT$ で書く', () => {
        const inputs = Object.values(turbo.tasks).flatMap((task) => task.inputs ?? []);
        expect(inputs.filter((input) => input.startsWith('../'))).toEqual([]);
    });
});
