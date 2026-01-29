'use client';

import { WorldProvider } from '@/core/contexts/WorldContext';
import { SocketProvider } from '@/core/hooks/useSocket';
import { PenCanvasProvider } from '@/plugins/pen/context/PenCanvasContext';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SocketProvider>
            <WorldProvider>
                <PenCanvasProvider>{children}</PenCanvasProvider>
            </WorldProvider>
        </SocketProvider>
    );
}
