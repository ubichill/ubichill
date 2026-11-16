import { describe, expect, it } from 'vitest';
import { nextPublishVersion } from './publishVersion';

describe('nextPublishVersion', () => {
    it('まだ公開していなければ書いてある版のまま', () => {
        expect(nextPublishVersion({ version: '1.0.0', publishedVersion: null, changed: true })).toBe('1.0.0');
    });

    it('公開中と同じ版で中身を変えたらパッチだけ上げる', () => {
        expect(nextPublishVersion({ version: '1.0.0', publishedVersion: '1.0.0', changed: true })).toBe('1.0.1');
    });

    it('中身を変えていなければ上げない（同じ版の公開し直し）', () => {
        expect(nextPublishVersion({ version: '1.0.0', publishedVersion: '1.0.0', changed: false })).toBe('1.0.0');
    });

    it('作者が自分で上げていればそのまま（マイナー・メジャーも尊重する）', () => {
        expect(nextPublishVersion({ version: '2.0.0', publishedVersion: '1.4.9', changed: true })).toBe('2.0.0');
    });

    it('公開中より古い版が書いてあれば公開中から上げる（古い下書き・YAML の貼り付け）', () => {
        expect(nextPublishVersion({ version: '1.0.0', publishedVersion: '1.2.3', changed: true })).toBe('1.2.4');
    });

    it('版の形が崩れていても公開中から上げる', () => {
        expect(nextPublishVersion({ version: 'v1', publishedVersion: '1.0.9', changed: true })).toBe('1.0.10');
    });

    it('公開中の版が読めなければ書いてある版のまま（サーバーに判断させる）', () => {
        expect(nextPublishVersion({ version: '1.0.0', publishedVersion: 'latest', changed: true })).toBe('1.0.0');
    });
});
