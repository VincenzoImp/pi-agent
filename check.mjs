/**
 * Verifies that an installed copy of this setup actually loads — every skill, every prompt,
 * every extension, and the packages that carry the limits — the sandbox, the command guard and
 * the memory that survives compaction — which are exactly what a broken copy loses while still
 * looking healthy.
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
for (const name of ["preset.ts", "questionnaire.ts", "todo.ts", "tools.ts"]) {
  expect(loadedExtensionPaths.some((path) => path.endsWith(`/extensions/${name}`)),
    `extension: ${name}`, `extension did not load: ${name}`);
}

// --- the traps this project actually fell into, kept as regressions ----------------------------

// The guardrails and the memory that survives compaction are packages now, not files here.
// A copy that loses them still loads cleanly and looks healthy, which is exactly the failure
// this project keeps meeting, so assert the manifest still names every one of them.
const agreement = readFileSync(join(target, "AGENTS.md"), "utf8");
const packages = readFileSync(join(repo, "packages.txt"), "utf8");
for (const [name, role] of [
  ["pi-web-access", "web search"],
  ["pi-sandbox", "the OS sandbox"],
  ["cc-safety-net", "destructive-command and secret-file blocking"],
  ["pi-hermes-memory", "memory that survives compaction"],
  ["@narumitw/pi-plan-mode", "plan mode"],
]) {
  expect(packages.includes(name), `packages.txt installs ${name}`,
    `packages.txt no longer installs ${name} — the setup has no ${role}`);
}

// cc-safety-net does not stop a plain `git push`; a rulebook adds that back. Verified by
// running the push before and after: it went through with no confirmation, then was refused
// by rule pi-agent-remote-effects/remote-git-push before execution.
const rulebook = join(homedir(), ".cc-safety-net", "rules", "pi-agent-remote-effects", "rulebook.json");
expect(existsSync(rulebook),
  "remote effects need a human",
  "the remote-effects rulebook is not installed — `git push` and `npm publish` run unattended");

// Plan mode's own default is `read` alone, which leaves the agent unable to look at anything.
try {
  const plan = JSON.parse(readFileSync(join(target, "pi-plan-mode.json"), "utf8"));
  const tools = plan.defaultPlanTools ?? [];
  expect(["grep", "find", "ls"].every((tool) => tools.includes(tool)),
    "plan mode can explore",
    `pi-plan-mode.json allows only [${tools.join(", ")}] — the agent cannot inspect anything`);
} catch {
  bad("pi-plan-mode.json is missing or unreadable — run ./install.sh");
}

// The agreement is always in context, so it must name the memory tools that actually exist.
// It previously described a worklog file the model could not resolve, and the model invented
// its own location; the compaction re-injection then read an empty directory.
expect(agreement.includes("memory_add"),
  "agreement names the memory tools the model can call",
  "AGENTS.md does not tell the model how to record durable state");
expect(!/worklog/i.test(agreement),
  "agreement carries no stale worklog references",
  "AGENTS.md still refers to the removed worklog extension");

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

// The Claude provider is optional, but if the superseded one is present it is a fork we no
// longer maintain and a package that silently loses the system prompt.
for (const stale of [join(target, "npm", "node_modules", "pi-claude-cli"),
  join(target, "git", "github.com", "VincenzoImp", "pi-claude-cli")]) {
  expect(!existsSync(stale),
    "no superseded Claude adapter installed",
    `pi-claude-cli is still installed at ${stale}; pi-claude-bridge replaces it`);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
