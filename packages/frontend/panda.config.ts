import { defineConfig } from '@pandacss/dev';

export default defineConfig({
    // Whether to use css reset
    preflight: true,

    // Where to look for your css declarations
    include: [
        './src/**/*.{js,jsx,ts,tsx}',
        `${process.env.PLUGIN_PATH || '../../plugins/music-player/frontend/src'}/**/*.{js,jsx,ts,tsx}`,
    ],

    // Files to exclude
    exclude: [],

    // Useful for theme customization
    theme: {
        extend: {
            keyframes: {
                spin: {
                    '0%': { transform: 'rotate(0deg)' },
                    '100%': { transform: 'rotate(360deg)' },
                },
            },
            tokens: {
                colors: {
                    primary: { value: '#3b82f6' },
                    secondary: { value: '#10b981' },
                    background: { value: '#f3f4f6' },
                    surface: { value: '#ffffff' },
                    text: { value: '#1f2937' },
                    textMuted: { value: '#6b7280' },
                    border: { value: '#e5e7eb' },
                },
                fonts: {
                    body: { value: 'var(--font-inter), system-ui, sans-serif' },
                    mono: { value: 'Menlo, monospace' },
                },
            },
            semanticTokens: {
                colors: {
                    fg: {
                        DEFAULT: { value: '{colors.text}' },
                        muted: { value: '{colors.textMuted}' },
                    },
                    bg: {
                        DEFAULT: { value: '{colors.background}' },
                        surface: { value: '{colors.surface}' },
                    },
                },
            },
        },
    },

    // The output directory for your css system
    outdir: 'styled-system',

    // React framework specifically
    jsxFramework: 'react',
});
