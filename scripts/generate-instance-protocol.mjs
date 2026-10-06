import { spawnSync } from 'node:child_process';

const commands = [
    ['go', ['run', 'github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.5.0', '-generate', 'types', '-package', 'protocol', '-o', 'services/instance/internal/protocol/api.gen.go', 'protocol/instance/openapi.json']],
    ['pnpm', ['--dir', 'tools/protocol', 'exec', 'openapi-typescript', '../../protocol/instance/openapi.json', '-o', '../../packages/shared/src/generated/instance.ts']],
    ['pnpm', ['exec', 'biome', 'format', '--write', 'packages/shared/src/generated/instance.ts']],
];
for (const [command, args] of commands) {
    const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) process.exit(result.status ?? 1);
}
