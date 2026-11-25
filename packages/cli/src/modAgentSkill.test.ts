import { readFileSync } from 'node:fs';
import { CAPABILITY_CATALOG } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { MOD_AGENT_SKILL, MOD_AGENT_SKILL_NAME, MOD_AGENT_SKILL_PATHS } from './modAgentSkill.ts';
import { projectFiles } from './packages.ts';

const sdkReadme = readFileSync(new URL('../../sdk/README.md', import.meta.url), 'utf-8');
const sdkStateSource = readFileSync(new URL('../../sdk/src/ubi/state/index.ts', import.meta.url), 'utf-8');

const frontmatter = (text: string): { name?: string; description?: string } =>
    yaml.parse(/^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '') ?? {};

const codeSpans = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '');

describe('mod の雛形の AI エージェント向け skill', () => {
    it('Codex（.agents/skills）と Claude Code（.claude/skills）に同じ中身で入る', () => {
        const files = projectFiles('mod', 'hello');
        expect(MOD_AGENT_SKILL_PATHS.map((path) => files[path])).toEqual([MOD_AGENT_SKILL, MOD_AGENT_SKILL]);
        expect(MOD_AGENT_SKILL_PATHS.map((path) => path.split('/').slice(0, 2).join('/'))).toEqual([
            '.agents/skills',
            '.claude/skills',
        ]);
    });

    it('world の雛形には入らない（world は mod を書かない）', () => {
        const files = projectFiles('world', 'hello');
        for (const path of MOD_AGENT_SKILL_PATHS) expect(files[path]).toBeUndefined();
    });

    it('frontmatter の name はディレクトリ名と同じで、description は Agent Skills の上限に収まる', () => {
        const meta = frontmatter(MOD_AGENT_SKILL);
        expect(meta.name).toBe(MOD_AGENT_SKILL_NAME);
        for (const path of MOD_AGENT_SKILL_PATHS) expect(path).toMatch(new RegExp(`/skills/${meta.name}/SKILL\\.md$`));
        expect(meta.description?.length ?? 0).toBeGreaterThan(20);
        expect(meta.description?.length ?? 0).toBeLessThanOrEqual(1024);
    });

    it('書いてある npm run のスクリプトは、雛形の package.json にある', () => {
        const scripts = JSON.parse(projectFiles('mod', 'hello')['package.json'] ?? '{}').scripts ?? {};
        const mentioned = [...MOD_AGENT_SKILL.matchAll(/npm run ([a-z:-]+)/g)].map((m) => m[1]);
        expect(mentioned.length).toBeGreaterThan(0);
        for (const name of mentioned) expect(scripts).toHaveProperty(name ?? '');
    });

    it('書いてある雛形のファイルは、雛形にある', () => {
        const files = projectFiles('mod', 'hello');
        const paths = codeSpans(MOD_AGENT_SKILL).filter((s) => /^(src\/[\w.-]+|\.github\/[\w./-]+)$/.test(s));
        expect(paths).toEqual(expect.arrayContaining(['src/env.d.ts', '.github/workflows/pages.yml']));
        for (const path of paths) expect(files).toHaveProperty([path]);
    });

    it('書いてある権限はカタログにあり、危険度も合っている', () => {
        const capabilities = codeSpans(MOD_AGENT_SKILL).filter((s) => /^[a-z]+:[a-z-]+$/.test(s));
        expect(capabilities.length).toBeGreaterThan(0);
        for (const id of capabilities) expect(CAPABILITY_CATALOG).toHaveProperty([id]);
        expect(MOD_AGENT_SKILL).toMatch(/`net:fetch` は dangerous/);
        expect(CAPABILITY_CATALOG['net:fetch'].risk).toBe('dangerous');
    });

    it('書いてある Ubi の名前空間は、npm で配る SDK の README に載っている', () => {
        const namespaces = [...new Set([...MOD_AGENT_SKILL.matchAll(/Ubi\.([a-z]+)/g)].map((m) => m[1]))];
        expect(namespaces).toEqual(expect.arrayContaining(['state', 'fetch', 'asset']));
        for (const ns of namespaces) expect(sdkReadme).toContain(`Ubi.${ns}`);
    });

    it('書いてある Ubi.state.sync のオプションは SDK にある', () => {
        const options = [...MOD_AGENT_SKILL.matchAll(/\{ (\w+): true \}/g)].map((m) => m[1]);
        expect(options).toEqual(['perUser', 'ephemeral']);
        for (const option of options) expect(sdkStateSource).toMatch(new RegExp(`\\b${option}\\?: boolean`));
    });
});
