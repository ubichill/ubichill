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
        .default('false')
        .transform((val) => val === 'true'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().default('http://localhost:3001'),
    RESEND_API_KEY: z.string().optional(),
    SKIP_EMAIL_VERIFICATION: z
        .string()
        .default('false')
        .transform((val) => val === 'true'),
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
    db: {
        databaseUrl: parsedEnv.data.DATABASE_URL,
        redisUrl: parsedEnv.data.REDIS_URL,
    },
    auth: {
        secret: parsedEnv.data.BETTER_AUTH_SECRET,
        url: parsedEnv.data.BETTER_AUTH_URL,
    },
    email: {
        resendApiKey: parsedEnv.data.RESEND_API_KEY,
        skipVerification: parsedEnv.data.SKIP_EMAIL_VERIFICATION,
    },
} as const;

// URLのホスト部分だけ表示するヘルパー（機密情報を除く）
function maskUrl(url: string): string {
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
        return '[invalid URL]';
    }
}

// 設定を表示（機密情報を除く）
console.log('📋 サーバー設定:');
console.log(`   環境: ${appConfig.nodeEnv}`);
console.log(`   ポート: ${appConfig.port}`);
console.log(
    `   CORS許可オリジン: ${Array.isArray(appConfig.cors.origin) ? appConfig.cors.origin.join(', ') : appConfig.cors.origin}`,
);
console.log(`   レート制限: ${appConfig.rateLimit.maxRequests}リクエスト/${appConfig.rateLimit.windowMs / 1000}秒`);
console.log(`   デバッグモード: ${appConfig.debug ? '有効' : '無効'}`);
console.log('📦 DB設定:');
console.log(`   DATABASE_URL: ${maskUrl(appConfig.db.databaseUrl)}`);
console.log(`   REDIS_URL: ${maskUrl(appConfig.db.redisUrl)}`);
console.log('🔐 認証設定:');
console.log(`   BETTER_AUTH_URL: ${appConfig.auth.url}`);
console.log(`   BETTER_AUTH_SECRET: ${appConfig.auth.secret ? '設定済み' : '未設定'}`);
console.log('📧 メール設定:');
console.log(`   RESEND_API_KEY: ${appConfig.email.resendApiKey ? '設定済み' : '未設定'}`);
console.log(`   メール確認スキップ: ${appConfig.email.skipVerification ? '有効' : '無効'}`);
