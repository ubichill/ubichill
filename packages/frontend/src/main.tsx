import { SocketProvider, WorldProvider } from '@ubichill/sdk/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './router';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
    <StrictMode>
        <SocketProvider>
            <WorldProvider>
                <AppRouter />
            </WorldProvider>
        </SocketProvider>
    </StrictMode>,
);
