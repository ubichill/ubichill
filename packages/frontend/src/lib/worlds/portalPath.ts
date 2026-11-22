import type { PortalGoal } from '@/world';

/** ポータルの行き先の、このサーバーの中のページ。ワールドはワールドのページ（そこで入室まで進む）、部屋はその部屋。 */
export function portalPath(goal: PortalGoal): string {
    switch (goal.kind) {
        case 'share': {
            const [handle, name] = goal.path.split('/');
            return `/${handle}/${encodeURIComponent(name ?? '')}`;
        }
        case 'id':
            return `/world/${encodeURIComponent(goal.id)}`;
        case 'url':
            return `/world?url=${encodeURIComponent(goal.url)}`;
        case 'room':
            return `/instance/${encodeURIComponent(goal.room)}`;
    }
}
