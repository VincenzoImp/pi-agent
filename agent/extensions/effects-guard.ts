import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { assertNoSymbolicLinkComponents } from "./lib/atomic-file.ts";
import { assessRemoteEffect, type RemoteEffect } from "./lib/effects.ts";

/** Optional, and both protections are on without it. Same shape as Pi's own sandbox.json. */
interface GuardConfig {
  effects: boolean;
  secrets: boolean;
}

const DEFAULT_CONFIG: GuardConfig = { effects: true, secrets: true };
const MAX_CONFIG_BYTES = 16 * 1024;

/** `~` expansion, because PI_CODING_AGENT_DIR is a path a person may have typed. */
function agentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (!configured) return getAgentDir();
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
  return configured;
}

/** Unknown keys and non-booleans fall back rather than throw: a typo must not disarm a guard. */
function parseGuardConfig(text: string): GuardConfig {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ...DEFAULT_CONFIG };
  const value = parsed as Record<string, unknown>;
  return {
    effects: typeof value.effects === "boolean" ? value.effects : DEFAULT_CONFIG.effects,
    secrets: typeof value.secrets === "boolean" ? value.secrets : DEFAULT_CONFIG.secrets,
  };
}

interface ToolCallEventLike {
  toolName: string;
  input: Record<string, unknown>;
}

interface ToolResultEventLike {
  toolName: string;
  content: readonly unknown[];
}

interface UserBashEventLike {
  command: string;
}

interface ToolContextLike {
  hasUI: boolean;
  ui: {
    select(title: string, choices: string[]): Promise<string | undefined>;
    notify(message: string, level: "info"): void;
  };
}

interface ToolCallBlock {
  block: true;
  reason: string;
}

interface ToolResultPatch {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}

interface UserBashBlock {
  result: {
    output: string;
    exitCode: 130;
    cancelled: false;
    truncated: false;
  };
}

export function readGuardConfigFile(path: string): GuardConfig {
  let descriptor: number | undefined;
  try {
    assertNoSymbolicLinkComponents(path);
    if (lstatSync(path).isSymbolicLink()) return structuredClone(DEFAULT_CONFIG);
    descriptor = openSync(path, "r");
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytes > MAX_CONFIG_BYTES) return structuredClone(DEFAULT_CONFIG);
    return parseGuardConfig(buffer.subarray(0, bytes).toString("utf8"));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function defaultProtectionConfigPath(): string {
  return join(agentDir(), "extensions", "effects-guard.json");
}

function readGlobalConfig(): GuardConfig {
  return readGuardConfigFile(defaultProtectionConfigPath());
}

function recognizedEffect(command: string): boolean {
  return [
    /(?:^|[;&|]\s*)git(?:\s+(?:(?:-C|-c|--git-dir|--work-tree|--namespace)\s+\S+|--(?:git-dir|work-tree|namespace)=\S+|--(?:bare|no-pager|paginate|literal-pathspecs|no-replace-objects)))*\s+push(?:\s|$)/i,
    /(?:^|[;&|]\s*)(?:npm|pnpm|yarn)\s+(?:[^;&|]*\s)?publish(?:\s|$)/i,
    /(?:^|[;&|]\s*)gh(?:\s+(?:--repo|-R)\s+\S+)*\s+pr\s+(?:create|merge)(?:\s|$)/i,
    /(?:^|[;&|]\s*)gh(?:\s+(?:--repo|-R)\s+\S+)*\s+release\s+(?:create|upload|delete)(?:\s|$)/i,
    /(?:^|[;&|]\s*)(?:vercel|netlify|wrangler|fly)\s+(?:deploy|publish)(?:\s|$)/i,
    /(?:^|[;&|]\s*)kubectl(?:\s+(?:--context|--namespace|-n)\s+\S+)*\s+(?:apply|create|delete|patch|replace|rollout)(?:\s|$)/i,
  ].some((pattern) => pattern.test(command));
}

/**
 * Normalize only literal text that shells can join without evaluating a variable: adjacent
 * quoted fragments and PowerShell's `'<text>' + '<text>'`. This deliberately does not try to
 * interpret variables, substitutions, or scripts; command scanning is a guardrail, not a shell.
 */
function normalizeStaticSecretCommandText(command: string): string {
  const literal = "[A-Za-z0-9_./\\\\:~-]*";
  const concatenation = new RegExp(`(['\"])(${literal})\\1\\s*\\+\\s*(['\"])(${literal})\\3`, "g");
  let normalized = command;
  let previous: string;
  do {
    previous = normalized;
    normalized = normalized.replace(
      concatenation,
      (_match, quote: string, left: string, _rightQuote: string, right: string) => `${quote}${left}${right}${quote}`,
    );
  } while (normalized !== previous);
  return normalized.replace(
    new RegExp(`(['\"])(${literal})\\1`, "g"),
    (_match, _quote: string, value: string) => value,
  );
}

/** Mentioning a protected name is enough to fail closed, including in command wrappers. */
function protectedCredentialReference(command: string): string | undefined {
  const normalized = normalizeStaticSecretCommandText(command).replaceAll("\\", "/").toLowerCase();
  const patterns: readonly [string, RegExp][] = [
    [".ssh", /(^|[^a-z0-9_.-])\.ssh(?=$|[^a-z0-9_.-])/],
    [".env", /(^|[^a-z0-9_.-])\.env(?:\.[a-z0-9_.-]+)?(?=$|[^a-z0-9_.-])/],
    [".envrc", /(^|[^a-z0-9_.-])\.envrc(?=$|[^a-z0-9_.-])/],
    ["auth.json", /(^|[^a-z0-9_.-])auth\.json(?=$|[^a-z0-9_.-])/],
    [".npmrc", /(^|[^a-z0-9_.-])\.npmrc(?=$|[^a-z0-9_.-])/],
    [".pypirc", /(^|[^a-z0-9_.-])\.pypirc(?=$|[^a-z0-9_.-])/],
    [".netrc", /(^|[^a-z0-9_.-])\.netrc(?=$|[^a-z0-9_.-])/],
    ["credentials", /(^|[^a-z0-9_.-])credentials(?=$|[^a-z0-9_.-])/],
    ["tfvars", /(^|[^a-z0-9_.-])[a-z0-9_.-]+\.tfvars(?:\.json)?(?=$|[^a-z0-9_.-])/],
    ["private key", /(^|[^a-z0-9_.-])id_(?:rsa|dsa|ecdsa|ed25519)(?=$|[^a-z0-9_.-])/],
  ];
  return patterns.find(([, pattern]) => pattern.test(normalized))?.[0];
}

function protectedCredentialPath(path: string): boolean {
  return protectedCredentialReference(path) !== undefined;
}

function containsPrivateKeyMaterial(content: readonly unknown[]): boolean {
  return content.some((item) => {
    if (!item || typeof item !== "object") return false;
    const text = (item as { text?: unknown }).text;
    return typeof text === "string" && /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(text);
  });
}

async function ask(effect: RemoteEffect, ctx: ToolContextLike): Promise<"allow" | "allow-similar" | "block"> {
  let choice: string | undefined;
  try {
    choice = await ctx.ui.select(
      `Authorise a remote effect?\n${effect.action} cannot be undone from here.`,
      ["Allow once", `Allow every ${effect.effect} this session`, "Block"],
    );
  } catch {
    return "block";
  }
  if (choice === "Allow once") return "allow";
  if (choice?.startsWith("Allow every")) return "allow-similar";
  try { ctx.ui.notify(`${effect.action} blocked`, "info"); } catch {}
  return "block";
}

export function createProtectionHandlers(config: GuardConfig) {
  const allowedEffects = new Set<RemoteEffect["effect"]>();
  const userBashDecisions = new WeakMap<UserBashEventLike, Promise<string | undefined>>();

  async function assessCommand(command: string, ctx: ToolContextLike): Promise<string | undefined> {
    if (config.secrets) {
      const protectedName = protectedCredentialReference(command);
      if (protectedName) return `Protected credential name cannot enter model context: ${protectedName}`;
    }
    if (!config.effects) return undefined;
    const effect = assessRemoteEffect(command);
    if (!effect || allowedEffects.has(effect.effect)) return undefined;
    if (!ctx.hasUI) return `${effect.action} needs explicit authorisation, but no approval UI is available`;
    const decision = await ask(effect, ctx);
    if (decision === "allow-similar") {
      allowedEffects.add(effect.effect);
      return undefined;
    }
    if (decision === "allow") return undefined;
    return `${effect.action} needs explicit authorisation`;
  }

  return {
    async toolCall(event: ToolCallEventLike, ctx: ToolContextLike): Promise<ToolCallBlock | undefined> {
      if (["bash", "powershell", "pwsh"].includes(event.toolName)) {
        const command = event.input.command;
        if (typeof command === "string") {
          const reason = await assessCommand(command, ctx);
          if (reason) return { block: true, reason };
        }
      }
      if (config.secrets && ["read", "grep", "find"].includes(event.toolName)) {
        const path = event.input.path;
        if (typeof path === "string" && protectedCredentialPath(path)) {
          return { block: true, reason: `Protected credential path cannot enter model context: ${path}` };
        }
      }
      return undefined;
    },
    toolResult(event: ToolResultEventLike): ToolResultPatch | undefined {
      if (!config.secrets || !containsPrivateKeyMaterial(event.content)) return undefined;
      return {
        content: [{ type: "text", text: "Arcwell blocked private-key material from model context." }],
        isError: true,
      };
    },
    async userBash(event: UserBashEventLike, ctx: ToolContextLike): Promise<UserBashBlock | undefined> {
      let decision = userBashDecisions.get(event);
      if (!decision) {
        decision = assessCommand(event.command, ctx);
        userBashDecisions.set(event, decision);
      }
      const reason = await decision;
      if (!reason) return undefined;
      return {
        result: {
          output: `${reason}\n`,
          exitCode: 130,
          cancelled: false,
          truncated: false,
        },
      };
    },
  };
}

export function registerProtectionHandlers(pi: Pick<ExtensionAPI, "on">, config: GuardConfig): void {
  const handlers = createProtectionHandlers(config);
  pi.on("tool_call", (event, ctx) => handlers.toolCall(event, ctx));
  pi.on("tool_result", (event) => handlers.toolResult(event));
  pi.on("user_bash", (event, ctx) => handlers.userBash(event, ctx));
}

export default function effectsGuard(pi: ExtensionAPI): void {
  registerProtectionHandlers(pi, readGlobalConfig());
}
