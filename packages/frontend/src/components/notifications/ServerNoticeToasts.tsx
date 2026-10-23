import { useSocket } from '@ubichill/react';
import { parseServerNotice } from '@ubichill/shared';
import { useEffect } from 'react';
import { serverNoticeMessage } from '@/lib/notifications';
import { pushToast } from '@/lib/toast';

/** インスタンスのその場だけの知らせ（切断の予告など）をトーストに出す。保存しない。知らない種類は読み飛ばす。 */
export function ServerNoticeToasts() {
    const { socket } = useSocket();
    useEffect(() => {
        if (!socket) return;
        const onNotice = (data: unknown) => {
            const notice = parseServerNotice(data);
            if (notice?.kind === 'disconnect') pushToast(serverNoticeMessage(notice, Date.now()), 'warn');
        };
        socket.on('server:notice', onNotice);
        return () => {
            socket.off('server:notice', onNotice);
        };
    }, [socket]);
    return null;
}
