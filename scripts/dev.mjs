import concurrently from 'concurrently';
import { randomBytes } from 'node:crypto';
import killPort from 'kill-port';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createTerminal, debugFromEnv, formatDuration, HintedError, messageOf, processIO } from '@ubichill/terminal';

const term = createTerminal(processIO(), { debug: debugFromEnv(process.env) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 1 秒おきに最大 attempts 回 check する。 */
const waitFor = async (check, attempts) => {
    if (check()) return true;
    if (attempts <= 1) return false;
    await sleep(1000);
    return waitFor(check, attempts - 1);
};

async function main() {
    process.env.INSTANCE_ADMIN_TOKEN ||= randomBytes(32).toString('hex');
    process.env.INSTANCE_PUBLIC_URL ||= 'http://localhost:3002/realtime/v1/ws';

    term.info('Checking for existing processes on ports 3000, 3001 and 3002...');
    try {
        await killPort(3000);
        await killPort(3001);
        // 残った `pnpm instance:dev`（ゲストモード）が居ると、Go が起動できないか管理トークンが食い違う
        await killPort(3002);
        term.success('Existing processes killed or ports are free');
    } catch (err) {
        term.warn(`Error killing ports: ${messageOf(err)}`);
    }

    // Build shared / db (依存先は turbo の ^build が解決する)
    term.info('Building shared & db packages...');
    const buildDeps = spawnSync('pnpm', ['turbo', 'build', '--filter=@ubichill/shared', '--filter=@ubichill/db'], {
        stdio: 'inherit',
        shell: true,
    });
    if (buildDeps.status !== 0) {
        term.error('Failed to build shared/db packages');
        process.exit(1);
    }

    // Start database
    term.info('Starting PostgreSQL database...');
    const startDb = spawnSync('docker', ['compose', '-f', 'packages/db/docker-compose.yml', 'up', '-d'], { stdio: 'inherit', shell: true });
    if (startDb.status !== 0) {
        term.failure(new HintedError('Failed to start database', 'Make sure Docker is running'));
        process.exit(1);
    }

    // Wait for database to be ready
    term.info('Waiting for database to be ready...');
    const waitStarted = performance.now();
    const pgIsReady = () =>
        spawnSync('docker', ['compose', '-f', 'packages/db/docker-compose.yml', 'exec', '-T', 'db', 'pg_isready', '-U', 'ubichill'], { stdio: 'pipe', shell: true }).status === 0;
    if (!(await waitFor(pgIsReady, 30))) {
        term.error('Database failed to start within timeout');
        process.exit(1);
    }
    term.success('Database is ready', formatDuration(performance.now() - waitStarted));

    // Run database migrations
    term.info('Running database migrations...');
    const migrate = spawnSync('pnpm', ['--filter', '@ubichill/db', 'push'], { stdio: 'inherit', shell: true });
    if (migrate.status !== 0) {
        term.error('Failed to run database migrations');
        process.exit(1);
    }

    // Build mod workers and regenerate the world locks from the exact output.
    // `pnpm build:workers` is the single canonical pipeline; duplicating only the
    // worker-build half here leaves worlds/*.lock.json pointing at old hashes.
    term.info('Building mod workers and world locks...');
    const buildWorkers = spawnSync('pnpm', ['build:workers'], { stdio: 'inherit', shell: true });
    if (buildWorkers.status !== 0) {
        term.error('Failed to build mod workers');
        process.exit(1);
    }

    // Cleanup function
    let isCleaning = false;
    const cleanup = () => {
        if (isCleaning) return;
        isCleaning = true;
        term.info('Stopping database...');
        spawnSync('docker', ['compose', '-f', 'packages/db/docker-compose.yml', 'down'], { stdio: 'inherit', shell: true });

        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Run dev server using concurrently
    term.info('Starting development server...');

    // shared / workers は watch のみで、終了しても frontend/backend を道連れにしない
    // .result を catch しないと unhandled rejection になるため明示的に握り潰す
    concurrently(
        [
            { command: 'pnpm --filter @ubichill/shared dev', name: 'shared', prefixColor: 'yellow' },
            { command: 'node scripts/watch-workers.mjs', name: 'workers', prefixColor: 'green' },
        ],
        { prefix: '[{name}]', killOthers: [], restartTries: 3 },
    ).result.catch(() => {});

    const { result } = concurrently(
        [
            { command: 'pnpm --filter @ubichill/frontend dev', name: 'frontend', prefixColor: 'cyan' },
            { command: 'pnpm --filter @ubichill/backend dev', name: 'backend', prefixColor: 'magenta' },
            { command: 'go -C services/instance run ./cmd/instance --origins=http://localhost:3000', name: 'instance', prefixColor: 'blue' },
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
