import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
    title: 'Ubichill',
    description: '2D metaverse-style work sharing application',
    icons: {
        icon: '/icon.png',
    },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ja" className={inter.variable}>
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
