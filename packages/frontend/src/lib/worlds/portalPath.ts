import type { PortalTarget } from '@ubichill/core-components';

/** 入口の行き先の、このサーバーの中のページ（ワールドのページが入室まで進める）。 */
export function portalPath(target: PortalTarget): string {
    switch (target.kind) {
        case 'share': {
            const [handle, name] = target.path.split('/');
            return `/${handle}/${encodeURIComponent(name ?? '')}`;
        }
        case 'id':
            return `/world/${encodeURIComponent(target.id)}`;
        case 'url':
            return `/world?url=${encodeURIComponent(target.url)}`;
    }
}
