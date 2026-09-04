import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  collectProductionModules,
  discoverSourceWorkspaces,
  importSpecifiers,
  resolveModuleImport,
} from "./lib/source-workspaces.mjs";
import config from "./architecture-audit.config.mjs";

const root = resolve(import.meta.dirname, "..");
const workspaces = discoverSourceWorkspaces(root);
const entries = workspaces.flatMap(({ entry, entries: workspaceEntries }) => (
  workspaceEntries ?? [entry]
)).filter(Boolean);
const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));

const sourceFiles = collectProductionModules(workspaces);
const sourceFileSet = new Set(sourceFiles);
const reachable = new Set();
const pending = entries.filter((entry) => sourceFileSet.has(entry));

while (pending.length > 0) {
  const file = pending.pop();
  if (!file || reachable.has(file)) continue;
  reachable.add(file);
  for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
    const dependency = resolveModuleImport(file, specifier, workspaceByName);
    if (dependency && sourceFileSet.has(dependency) && !reachable.has(dependency)) {
      pending.push(dependency);
    }
  }
}

const waiverEntries = new Map(Object.entries(config.unreachableWaivers));
const unused = sourceFiles.filter((file) => !reachable.has(file)).sort();
const waived = unused.filter((file) => waiverEntries.has(relativePath(file)));
const violations = unused.filter((file) => !waiverEntries.has(relativePath(file)));
const staleWaivers = [...waiverEntries.keys()]
  .filter((path) => !waived.some((file) => relativePath(file) === path))
  .sort();
if (violations.length > 0) {
  console.error("Production modules unreachable from package/app entry points:");
  for (const file of violations) console.error(`- ${relativePath(file)}`);
  process.exitCode = 1;
} else {
  if (waived.length > 0) {
    console.log(`Temporary unreachable module waivers (${waived.length}):`);
    for (const file of waived) {
      const path = relativePath(file);
      console.log(`- ${path} - ${waiverEntries.get(path)}`);
    }
  }
  console.log(`Module graph clean: ${reachable.size}/${sourceFiles.length} production modules are reachable without waivers.`);
  if (staleWaivers.length > 0) {
    console.warn("Unreachable module waivers that may no longer be needed:");
    for (const path of staleWaivers) console.warn(`- ${path}`);
  }
}

function relativePath(file) {
  return file.slice(root.length + 1).replaceAll("\\", "/");
}
