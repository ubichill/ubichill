import { defineConfig } from '@pandacss/dev';

export default defineConfig({
    // Whether to use css reset
    preflight: true,

    // Where to look for your css declarations
    include: ["./src/**/*.{js,jsx,ts,tsx}"],

    // Files to exclude
    exclude: [
        '**/node_modules/**',
        '**/styled-system/**',
        '**/.next/**',
    ],

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
                    // メインカラー（ダークネイビー - ボタンやアクセントに使用）
                    primary: { value: '#1b2a44' },
                    
                    // セカンダリカラー（ベージュ系 - カード背景などに使用）
                    secondary: { value: '#d4c4ab' },
                    
                    // 背景色（全体の背景）
                    background: { value: '#faf6f0' },
                    
                    // サーフェス（カードやパネルの背景）
                    surface: { value: '#f5ecdf' },
                    surfaceHover: { value: '#ede4d6' },
                    surfaceAccent: { value: '#e6d7c4' },
                    
                    // テキスト色
                    text: { value: '#1b2a44' },
                    textMuted: { value: '#5e6a82' },
                    textSubtle: { value: '#8a7e6d' },
                    textOnPrimary: { value: '#f8f3ea' },
                    
                    // ボーダー
                    border: { value: '#cebca2' },
                    borderStrong: { value: '#b0a48e' },
                    
                    // ボタンホバー/アクティブ
                    primaryHover: { value: '#1e3155' },
                    primaryActive: { value: '#263d68' },
                    
                    // ステータス色
                    success: { value: '#8ad29b' },
                    warning: { value: '#f1c86c' },
                    error: { value: '#c0392b' },
                    errorBg: { value: '#f9e4e1' },
                    errorText: { value: '#922b21' },
                    successBg: { value: '#e4f5ec' },
                    successText: { value: '#1e7e46' },
                    info: { value: '#9ea7bd' },
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
