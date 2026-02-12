import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Determine if docker compose or docker-compose is available
let dockerComposeParam = ['compose'];
const dockerCheck = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
if (dockerCheck.status !== 0) {
    const dockerComposeCheck = spawnSync('docker-compose', ['version'], { stdio: 'ignore' });
    if (dockerComposeCheck.status === 0) {
        dockerComposeParam = []; // Use docker-compose directly, handled below in execution
    } else {
        console.error('Error: docker compose is not installed.');
        process.exit(1);
    }
}

const pluginsDir = join(process.cwd(), 'plugins');
const composeFiles = [];

if (existsSync(pluginsDir)) {
    const entries = readdirSync(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const composeFile = join(pluginsDir, entry.name, 'docker-compose.yml');
            if (existsSync(composeFile)) {
                composeFiles.push('-f', composeFile);
                console.log(`Found plugin definition: ${composeFile}`);
            }
        }
    }
}

if (composeFiles.length === 0) {
    console.log('No plugin docker-compose configuration files found.');
    process.exit(0);
}

// Ensure the shared network exists
const networkCheck = spawnSync('docker', ['network', 'inspect', 'ubichill-network'], { stdio: 'ignore' });
if (networkCheck.status !== 0) {
    spawnSync('docker', ['network', 'create', 'ubichill-network'], { stdio: 'inherit' });
}

const args = process.argv.slice(2);
const command = dockerComposeParam.length > 0 ? 'docker' : 'docker-compose';
const commandArgs = [...dockerComposeParam, ...composeFiles, ...args];

console.log(`Executing: ${command} ${commandArgs.join(' ')}`);

const result = spawnSync(command, commandArgs, { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
