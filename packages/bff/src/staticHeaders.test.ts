import { SANDBOX_WORKER_CSP } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { staticAssetHeaders } from './staticHeaders';

describe('staticAssetHeaders', () => {
    it('Vite が出力した Sandbox Worker には Worker 専用の CSP を付ける', () => {
        expect(staticAssetHeaders('/app/frontend/dist/assets/sandbox.worker-DEgCgfkx.js')).toEqual({
            'Content-Security-Policy': SANDBOX_WORKER_CSP,
        });
    });

    it('ページや他のスクリプトには CSP を付けない（ページの CSP は別の話）', () => {
        expect(staticAssetHeaders('/app/frontend/dist/index.html')).toEqual({});
        expect(staticAssetHeaders('/app/frontend/dist/assets/index-DEgCgfkx.js')).not.toHaveProperty(
            'Content-Security-Policy',
        );
    });

    it('/mods 配下は no-cache、ハッシュ付きファイルは immutable（従来どおり）', () => {
        expect(staticAssetHeaders('/dist/mods/pen/v2.0.0/pen/index.df9fd0ce.js')).toEqual({
            'Cache-Control': 'public, no-cache',
        });
        expect(staticAssetHeaders('/dist/assets/font.0123abcd.woff2')).toEqual({
            'Cache-Control': 'public, max-age=31536000, immutable',
        });
    });
});
