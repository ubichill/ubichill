import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
    title: 'Ubichill',
    description: '2D metaverse-style work sharing application',
    icons: {
        icon: '/icon.png',
    },
};

import { UbichillOverlay } from '@/components/UbichillOverlay';

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={inter.className}>
                <Providers>
                    <UbichillOverlay />
                    {children}
                </Providers>
            </body>
        </html>
    );
}
