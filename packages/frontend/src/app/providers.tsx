'use client';

import { SocketProvider } from '@/hooks/useSocket';
import { WorldProvider } from '@/contexts/WorldContext';
import { GlobalCanvasProvider } from '@/contexts/GlobalCanvasContext';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SocketProvider>
            <WorldProvider>
                <GlobalCanvasProvider>
                    {children}
                </GlobalCanvasProvider>
            </WorldProvider>
        </SocketProvider>
    );
}
