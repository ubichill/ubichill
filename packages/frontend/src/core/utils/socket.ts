import type { SocketLike } from '@ubichill/sdk/ui';
import type { Socket } from 'socket.io-client';

export function wrapSocket(socket: Socket): SocketLike {
    return {
        emit: (event, ...args) => (socket.emit as (ev: string, ...a: unknown[]) => void)(event, ...args),
        on: (event, handler) => socket.on(event as never, handler as never),
        off: (event, handler) => socket.off(event as never, handler as never),
        get id() {
            return socket.id;
        },
    };
}
