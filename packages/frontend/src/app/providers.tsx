'use client';

import { PenCanvasProvider } from '@ubichill/plugin-pen';
import { SocketProvider, WorldProvider } from '@ubichill/sdk';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SocketProvider>
            <WorldProvider>
                <PenCanvasProvider>{children}</PenCanvasProvider>
            </WorldProvider>
        </SocketProvider>
    );
}
