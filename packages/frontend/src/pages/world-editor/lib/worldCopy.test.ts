import { createModLock, type ModLockEntry } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { loadWorldCopy, worldCopy } from './worldCopy';

const entry = (id: string, version: string): ModLockEntry => ({
    id,
    version,
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    components: {},
});
const source = {
    apiVersion: 'ubichill.com/v1alpha1' as const,
    kind: 'World' as const,
    metadata: { name: 'chillwa', version: '1.1.0', author: { name: 'ようかん' } },
    spec: {
        displayName: 'ちるわ',
        capacity: { default: 10, max: 20 },
        dependencies: [{ name: 'pen', source: { url: 'https://ubichill.github.io/ubichill/mods', version: 'latest' } }],
        initialEntities: [],
        permissions: { allowGuestCreate: true, allowGuestDelete: false },
        lock: createModLock({ stale: entry('stale', '0.1.0') }),
    },
};
const lock = createModLock({ pen: entry('pen', '2.1.0') });

describe('worldCopy', () => {
    it('名前を新しくし、版は 1.0.0 から。作者の表示は持ち込まず、ほかの設定（権限など）はそのまま', () => {
        const copy = worldCopy(source, 'newname', lock);
        expect(copy.metadata).toEqual({ name: 'newname', version: '1.0.0' });
        expect(copy.spec.displayName).toBe('ちるわ');
        expect(copy.spec.permissions).toEqual(source.spec.permissions);
        expect(copy.spec.dependencies).toEqual(source.spec.dependencies);
    });

    it('lock はサーバーで確かめた元のワールドのものを使う（YAML に書かれた lock は使わない）', () => {
        expect(worldCopy(source, 'n', lock).spec.lock).toEqual(lock);
        expect(worldCopy(source, 'n', undefined).spec).not.toHaveProperty('lock');
    });
});

describe('loadWorldCopy', () => {
    it('サーバーで解決した取得元から YAML を読み、コピーにする', async () => {
        const fetchText = vi.fn(async () => yaml.stringify(source));
        const copy = await loadWorldCopy('https://example.com/w.yaml', {
            resolve: async () => ({ source: { url: 'https://cdn.example.com/w.yaml' }, lock }),
            fetchText,
            newName: () => 'fresh',
        });
        expect(fetchText).toHaveBeenCalledWith('https://cdn.example.com/w.yaml');
        expect(copy.metadata.name).toBe('fresh');
        expect(copy.spec.lock).toEqual(lock);
    });

    it('ワールドの形でない YAML は失敗する', async () => {
        await expect(
            loadWorldCopy('https://example.com/w.yaml', {
                resolve: async () => ({ source: { url: 'https://example.com/w.yaml' } }),
                fetchText: async () => 'kind: Mod\n',
                newName: () => 'fresh',
            }),
        ).rejects.toThrow('ワールドの YAML を読めません');
    });
});
