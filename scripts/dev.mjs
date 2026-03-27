import concurrently from 'concurrently';
import killPort from 'kill-port';
import { spawnSync } from 'node:child_process';
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

    // Build db package
    console.log('🏗️  Building db package...');
    const buildDb = spawnSync('pnpm', ['--filter', '@ubichill/db', 'build'], { stdio: 'inherit', shell: true });
    if (buildDb.status !== 0) {
        console.error('Failed to build db package.');
        process.exit(1);
    }

    // Start database
    console.log('🗄️  Starting PostgreSQL database...');
    const startDb = spawnSync('docker', ['compose', '-f', 'packages/db/docker-compose.yml', 'up', '-d'], { stdio: 'inherit', shell: true });
    if (startDb.status !== 0) {
        console.error('Failed to start database. Make sure Docker is running.');
        process.exit(1);
    }

    // Wait for database to be ready
    console.log('⏳ Waiting for database to be ready...');
    let dbReady = false;
    for (let i = 0; i < 30; i++) {
        const check = spawnSync('docker', ['compose', '-f', 'packages/db/docker-compose.yml', 'exec', '-T', 'db', 'pg_isready', '-U', 'ubichill'], { stdio: 'pipe', shell: true });
        if (check.status === 0) {
            dbReady = true;
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!dbReady) {
        console.error('Database failed to start within timeout.');
        process.exit(1);
    }
    console.log('✅ Database is ready.');

    // Run database migrations
    console.log('🔄 Running database migrations...');
    const migrate = spawnSync('pnpm', ['--filter', '@ubichill/db', 'push'], { stdio: 'inherit', shell: true });
    if (migrate.status !== 0) {
        console.error('Failed to run database migrations.');
        process.exit(1);
    }

    // Build plugin workers (TypeScript → JS bundle → .gen.ts)
    console.log('🔨 Building plugin workers...');
    const buildWorkers = spawnSync(process.execPath, ['scripts/build-workers.mjs'], { stdio: 'inherit' });
    if (buildWorkers.status !== 0) {
        console.error('Failed to build plugin workers.');
        process.exit(1);
    }

    // Start plugins
    console.log('🚀 Starting Docker plugins...');
    const startPlugins = spawnSync(process.execPath, ['scripts/start-plugins.mjs', 'up', '-d'], { stdio: 'inherit' });
    if (startPlugins.status !== 0) {
        console.error('Failed to start plugins.');
        // Don't exit here, maybe we can run without plugins or user can fix it
    }

    // Cleanup function
    let isCleaning = false;
    const cleanup = () => {
        if (isCleaning) return;
        isCleaning = true;
        console.log('\n🛑 Stopping Docker plugins...');
        spawnSync(process.execPath, ['scripts/start-plugins.mjs', 'down'], { stdio: 'inherit' });
        console.log('🛑 Stopping database...');
        spawnSync('docker', ['compose', '-f', 'packages/db/docker-compose.yml', 'down'], { stdio: 'inherit', shell: true });

        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Run dev server using concurrently
    console.log('💻 Starting development server...');

    // shared / workers は watch のみで、終了しても frontend/backend を道連れにしない
    concurrently(
        [
            { command: 'pnpm --filter @ubichill/shared dev', name: 'shared', prefixColor: 'yellow' },
            { command: 'node scripts/watch-workers.mjs', name: 'workers', prefixColor: 'green' },
        ],
        { prefix: '[{name}]', killOthers: [], restartTries: 3 },
    );

    const { result } = concurrently(
        [
            { command: 'pnpm --filter @ubichill/frontend dev', name: 'frontend', prefixColor: 'cyan' },
            { command: 'pnpm --filter @ubichill/backend dev', name: 'backend', prefixColor: 'magenta' },
        ],
        {
            prefix: '[{name}]',
            killOthers: ['failure', 'success'],
            restartTries: 0,
        }
    );

    result.then(
        () => cleanup(),
        () => cleanup()
    );
}

main();
