export async function register() {
    // サーバーサイドのみ出力（Edge runtimeでは不要）
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        console.log('📋 フロントエンド設定:');
        console.log(`   コミット: ${process.env.COMMIT_HASH ?? 'unknown'}`);
        console.log(`   環境: ${process.env.NODE_ENV}`);
        console.log(`   ポート: ${process.env.PORT ?? '3000'}`);
    }
}
