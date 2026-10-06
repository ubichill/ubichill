import { SocketProvider, WorldProvider } from '@ubichill/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PermissionRoot } from './components/permissions/PermissionRoot';
import { resolveInstance } from './lib/instanceConnection';
import { AppRouter } from './router';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
    <StrictMode>
        <SocketProvider resolveInstance={resolveInstance}>
            <WorldProvider>
                <PermissionRoot>
                    <AppRouter />
                </PermissionRoot>
            </WorldProvider>
        </SocketProvider>
    </StrictMode>,
);
