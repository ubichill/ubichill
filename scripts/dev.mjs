import killPort from 'kill-port';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

async function main() {
    console.log('🧹 Checking for existing processes on ports 3000 and 3001...');
    try {
        await killPort(3000);
        await killPort(3001);
        console.log('Existing processes killed or ports are free.');
    } catch (err) {
        console.error('Error killing ports:', err);
    }

    // Build shared package
    console.log('🏗️  Building shared package...');
    const buildShared = spawnSync('pnpm', ['--filter', '@ubichill/shared', 'build'], { stdio: 'inherit', shell: true });
    if (buildShared.status !== 0) {
        console.error('Failed to build shared package.');
        process.exit(1);
    }

    // Start plugins
    console.log('🚀 Starting Docker plugins...');
    const startPlugins = spawnSync('node', ['scripts/start-plugins.mjs', 'up', '-d'], { stdio: 'inherit' });
    if (startPlugins.status !== 0) {
        console.error('Failed to start plugins.');
        // Don't exit here, maybe we can run without plugins or user can fix it
    }

    // Cleanup function
    const cleanup = () => {
        console.log('\n🛑 Stopping Docker plugins...');
        spawnSync('node', ['scripts/start-plugins.mjs', 'down'], { stdio: 'inherit' });
        process.exit();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', () => {
        // This might be called on normal exit, catch-all
    });

    // Run dev server
    console.log('💻 Starting development server...');
    const concurrentlyArgs = [
        '-k',
        '-p', '[{name}]',
        '-n', 'BACK,FRONT,SHARED',
        '-c', 'blue.bold,magenta.bold,yellow.bold',
        '"pnpm --filter @ubichill/backend dev"',
        '"pnpm --filter @ubichill/frontend dev"',
        '"pnpm --filter @ubichill/shared dev"'
    ];

    const devServer = spawn(join('node_modules', '.bin', 'concurrently'), concurrentlyArgs, { stdio: 'inherit', shell: true });

    devServer.on('close', (code) => {
        cleanup();
    });
}

main();
