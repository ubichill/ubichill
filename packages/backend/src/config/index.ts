import { config } from 'dotenv';
import { z } from 'zod';

// 環境変数を読み込む
config();

// 環境変数のバリデーションスキーマ
const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().finite().default(900000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().finite().default(100),
    DEBUG: z
        .string()
        .optional()
        .transform((val) => {
            if (val === 'true') return true;
            if (val === 'false') return false;
            return process.env.NODE_ENV !== 'production';
        }),
});

// 環境変数をパースして検証
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error('❌ 無効な環境変数:');
    console.error(parsedEnv.error.format());
    throw new Error('環境変数が無効です');
}

// CORS originの処理: '*'の場合は文字列のまま、それ以外は配列化
const corsOrigin =
    parsedEnv.data.CORS_ORIGIN === '*'
        ? '*'
        : parsedEnv.data.CORS_ORIGIN.split(',').map((origin: string) => origin.trim());

// 検証済みの設定をエクスポート
export const appConfig = {
    port: parsedEnv.data.PORT,
    nodeEnv: parsedEnv.data.NODE_ENV,
    isDevelopment: parsedEnv.data.NODE_ENV === 'development',
    isProduction: parsedEnv.data.NODE_ENV === 'production',
    debug: parsedEnv.data.DEBUG,
    cors: {
        origin: corsOrigin,
    },
    rateLimit: {
        windowMs: parsedEnv.data.RATE_LIMIT_WINDOW_MS,
        maxRequests: parsedEnv.data.RATE_LIMIT_MAX_REQUESTS,
    },
} as const;

// 設定を表示（機密情報を除く）
console.log('📋 サーバー設定:');
console.log(`   環境: ${appConfig.nodeEnv}`);
console.log(`   ポート: ${appConfig.port}`);
console.log(
    `   CORS許可オリジン: ${Array.isArray(appConfig.cors.origin) ? appConfig.cors.origin.join(', ') : appConfig.cors.origin}`,
);
console.log(`   レート制限: ${appConfig.rateLimit.maxRequests}リクエスト/${appConfig.rateLimit.windowMs / 1000}秒`);
console.log(`   デバッグモード: ${appConfig.debug ? '有効' : '無効'}`);
