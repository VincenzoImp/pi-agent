/**
 * Verifies that an installed copy of this setup actually loads — every skill, every prompt,
 * every extension, including the three that carry the limits (guard, worklog, sandbox), which
 * are exactly the ones a broken copy loses while still looking healthy.
 *
 * Runs against ~/.pi/agent (or PI_AGENT_DIR) using the globally installed Pi. No build, no
 * network, no model call.
 *
 *   node check.mjs
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = dirname(fileURLToPath(import.meta.url));
const target = process.env.PI_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

let failures = 0;
const ok = (message) => console.log(`  ✓ ${message}`);
const bad = (message) => { failures += 1; console.log(`  ✗ ${message}`); };
const expect = (condition, pass, fail) => (condition ? ok(pass) : bad(fail));

// --- locate the Pi module the running `pi` uses ------------------------------------------------

function piModule() {
  if (process.env.PI_MODULE) return process.env.PI_MODULE;
  const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
  const candidate = join(globalRoot, "@earendil-works", "pi-coding-agent", "dist", "index.js");
  if (existsSync(candidate)) return candidate;
  throw new Error(`Pi module not found at ${candidate}; set PI_MODULE to its dist/index.js`);
}

console.log(`Checking ${target}\n`);
const { DefaultResourceLoader, SettingsManager } = await import(pathToFileURL(resolve(piModule())).href);

// --- load everything, exactly as Pi would ------------------------------------------------------

const cwd = join(target, "..");
const settingsManager = SettingsManager.create(cwd, target, { projectTrusted: false });
const loader = new DefaultResourceLoader({ cwd, agentDir: target, settingsManager, noContextFiles: true });
await loader.reload({ resolveProjectTrust: async () => false });
const extensions = loader.getExtensions();
const skills = loader.getSkills();
const prompts = loader.getPrompts();

expect(extensions.errors.length === 0,
  "no extension errors",
  `extension errors: ${extensions.errors.map((error) => error.error.split("\n")[0]).join(" | ")}`);
expect(skills.diagnostics.length === 0 && prompts.diagnostics.length === 0,
  "no skill or prompt diagnostics",
  `diagnostics: ${JSON.stringify([...skills.diagnostics, ...prompts.diagnostics])}`);

// --- everything the repo ships must have arrived and loaded ------------------------------------
// Compared against the repo's own directories, so adding a skill updates the check with it, but
// a copy that silently dropped something still fails.

const loadedSkills = new Set(skills.skills.map((skill) => skill.name));
for (const name of readdirSync(join(repo, "agent", "skills"))) {
  if (!statSync(join(repo, "agent", "skills", name)).isDirectory()) continue;
  expect(loadedSkills.has(name), `skill: ${name}`, `skill missing from the loaded set: ${name}`);
}

const loadedPrompts = new Set(prompts.prompts.map((prompt) => prompt.name));
for (const file of readdirSync(join(repo, "agent", "prompts"))) {
  const name = file.replace(/\.md$/, "");
  expect(loadedPrompts.has(name), `prompt: /${name}`, `prompt missing from the loaded set: /${name}`);
}

const loadedExtensionPaths = extensions.extensions.map((extension) => extension.resolvedPath ?? "");
for (const name of ["effects-guard.ts", "worklog.ts", "sandbox/index.ts", "plan-mode/index.ts",
  "preset.ts", "questionnaire.ts", "todo.ts", "tools.ts"]) {
  expect(loadedExtensionPaths.some((path) => path.endsWith(`/extensions/${name}`)),
    `extension: ${name}`, `extension did not load: ${name}`);
}

// --- the traps this project actually fell into, kept as regressions ----------------------------

// The agreement is always in context; if it names a worklog path the extension does not use,
// the model keeps its worklog where compaction re-injection never looks.
// It must also be a path the model can RESOLVE. Pi exports no agent-directory variable into
// bash (only PI_CODING_AGENT and PI_SUBAGENT_PARENT_SESSION), so an env-var path expands to
// nothing and lands the worklog in /worklog/. Observed on a real session: the model gave up
// and invented ./worklog/ in the cwd, where compaction re-injection never looks.
const agreement = readFileSync(join(target, "AGENTS.md"), "utf8");
expect(agreement.includes("~/.pi/agent/worklog/"),
  "agreement names the worklog path the extension uses",
  "AGENTS.md worklog path does not match extensions/worklog.ts");
expect(!/\$PI_[A-Z_]*(DIR|HOME)[^\s`]*\/worklog/.test(agreement),
  "the worklog path resolves inside bash",
  "AGENTS.md points the worklog at an env var bash never sets — it will expand to /worklog/");

// The agreement is always in context, so a skill it names that no longer exists is an
// instruction the model cannot follow. Removing the bundled `web` skill left exactly that
// behind, and every other check still passed.
const namedSkills = [...agreement.matchAll(/`([a-z][a-z-]*)` skill/g)].map((match) => match[1]);
for (const name of namedSkills) {
  expect(loadedSkills.has(name),
    `agreement names a skill that exists: ${name}`,
    `AGENTS.md tells the model to use the \`${name}\` skill, which is not installed`);
}
expect(!/arcwell/i.test(agreement), "agreement carries no stale references", "AGENTS.md still mentions arcwell");

// Web access is a package, not a shell script here: a bash-based search is unreachable from
// inside the sandbox (its allowlist is npm/PyPI/GitHub), which reads as "search is broken".
// Measured on a real host: DuckDuckGo's keyless endpoint bot-refused 5 of 5 queries.
const packages = readFileSync(join(repo, "packages.txt"), "utf8");
expect(packages.includes("pi-web-access"),
  "web access ships as a package",
  "packages.txt no longer installs pi-web-access — the setup has no web search");

// Without this settings key the agreement reaches the model but none of its subagents.
try {
  const settings = JSON.parse(readFileSync(join(target, "settings.json"), "utf8"));
  const overrides = settings.subagents?.agentOverrides ?? {};
  const covered = ["planner", "reviewer", "scout", "worker"]
    .every((agent) => overrides[agent]?.inheritGlobalContext !== undefined);
  expect(covered, "subagents inherit the working agreement", "subagent overrides missing from settings.json");
} catch {
  bad("settings.json is missing or unreadable — run ./install.sh");
}

// The Claude adapter, when installed, must pass the system prompt as a FILE flag. 0.3.1 hands
// a path to a literal-text flag, so the agreement and every skill silently never reach the
// model (rchern/pi-claude-cli#39) — and a `pi update` reverts the fix. This keeps the loss loud.
// Published pi-claude-cli 0.3.1 loses the system prompt entirely, and drops the user's
// question whenever an extension appends a message after it (plan mode does). Both fail
// silently, so the loud check is that the npm build is not what got installed.
const npmAdapter = join(target, "npm", "node_modules", "pi-claude-cli");
const forkAdapter = join(target, "git", "github.com", "VincenzoImp", "pi-claude-cli");
if (existsSync(npmAdapter) || existsSync(forkAdapter)) {
  expect(existsSync(forkAdapter) && !existsSync(npmAdapter),
    "claude adapter is the fixed fork",
    "claude adapter is the unfixed npm build — the system prompt is lost and plan mode " +
    "returns empty answers; run ./install.sh --claude");
}
if (existsSync(forkAdapter)) {
  const source = readFileSync(join(forkAdapter, "src", "prompt-builder.ts"), "utf8");
  expect(/role === "toolResult" \|\| messages\[i\]\.role === "user"/.test(source),
    "the fork carries the resume-prompt fix",
    "the installed fork predates the plan-mode fix; re-run ./install.sh --claude");
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
