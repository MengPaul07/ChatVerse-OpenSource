import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import config from "./architecture-audit.config.mjs";
import {
  discoverSourceWorkspaces,
  owningWorkspace,
  readModuleGraph,
  relativePath,
} from "./lib/source-workspaces.mjs";

const root = resolve(import.meta.dirname, "..");
const workspaces = discoverSourceWorkspaces(root);
const { files, graph, imports } = readModuleGraph(root, workspaces);
const failures = [];

const deepImports = findDeepImports();
if (deepImports.length > 0) {
  failures.push("Cross-workspace deep src imports");
  console.error("Cross-workspace deep src imports:");
  for (const item of deepImports) console.error(`- ${item}`);
}
printTemporaryWaivers("deep import", config.deepImportWaivers);

const cycles = findCycles();
if (cycles.length > 0) {
  failures.push("Production module cycles");
  console.error("Production module cycles:");
  for (const cycle of cycles) console.error(`- ${cycle.join(" -> ")}`);
}
printTemporaryWaivers("cycle", config.cycleWaivers);

const { violations, waived, staleWaivers } = checkLineLimits();
if (violations.length > 0) {
  failures.push("Production file line limits");
  console.error("Production files over their line limits:");
  for (const item of violations) console.error(`- ${item}`);
}
if (staleWaivers.length > 0) {
  console.warn("Line waivers that may no longer be needed:");
  for (const item of staleWaivers) console.warn(`- ${item}`);
}

if (waived.length > 0) {
  console.log(`Temporary line waivers (${waived.length}):`);
  for (const item of waived) console.log(`- ${item}`);
}

if (failures.length > 0) {
  console.error(`Architecture audit failed: ${failures.join(", ")}.`);
  process.exitCode = 1;
} else {
  console.log(
    `Architecture audit clean: ${files.length} production modules across ${workspaces.length} workspaces.`,
  );
}

function findDeepImports() {
  const waivers = new Set(Object.keys(config.deepImportWaivers));
  const findings = [];
  for (const { file, specifier, dependency } of imports) {
    const sourceWorkspace = owningWorkspace(file, workspaces);
    const targetWorkspace = dependency ? owningWorkspace(dependency, workspaces) : undefined;
    const deepPackageImport = workspaces.some(({ name }) => (
      specifier === `${name}/src` || specifier.startsWith(`${name}/src/`)
    ));
    const relativeCrossWorkspace = specifier.startsWith(".")
      && sourceWorkspace
      && targetWorkspace
      && sourceWorkspace !== targetWorkspace;
    if (!deepPackageImport && !relativeCrossWorkspace) continue;
    const signature = `${relativePath(root, file)} -> ${specifier}`;
    if (!waivers.has(signature)) findings.push(signature);
  }
  return findings.sort();
}

function findCycles() {
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let index = 0;

  function visit(file) {
    indices.set(file, index);
    lowLinks.set(file, index);
    index += 1;
    stack.push(file);
    onStack.add(file);

    for (const dependency of graph.get(file) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(file, Math.min(lowLinks.get(file), lowLinks.get(dependency)));
      } else if (onStack.has(dependency)) {
        lowLinks.set(file, Math.min(lowLinks.get(file), indices.get(dependency)));
      }
    }

    if (lowLinks.get(file) !== indices.get(file)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      component.push(current);
    } while (current !== file);
    const selfCycle = component.length === 1 && graph.get(file)?.has(file);
    if (component.length > 1 || selfCycle) components.push(component);
  }

  for (const file of files) if (!indices.has(file)) visit(file);
  const waivers = new Set(Object.keys(config.cycleWaivers));
  return components
    .map((component) => component.map((file) => relativePath(root, file)).sort())
    .filter((component) => !waivers.has(component.join(" | ")))
    .sort((left, right) => left[0].localeCompare(right[0]));
}

function checkLineLimits() {
  const aggregateRoots = new Set(config.aggregateRoots);
  const waiverEntries = new Map(Object.entries(config.lineWaivers));
  const violations = [];
  const waived = [];
  const usedWaivers = new Set();

  for (const file of files) {
    const path = relativePath(root, file);
    const count = countLines(readFileSync(file, "utf8"));
    const category = path.startsWith("frontend/src/") && /Page\.tsx$/.test(path)
      ? "reactPage"
      : aggregateRoots.has(path)
        ? "aggregateRoot"
        : "default";
    const limit = config.lineLimits[category];
    if (count <= limit) continue;

    const waiver = waiverEntries.get(path);
    if (waiver && count <= waiver.maxLines) {
      usedWaivers.add(path);
      waived.push(`${path}: ${count}/${limit} (temporary max ${waiver.maxLines}) - ${waiver.reason}`);
    } else {
      const allowance = waiver ? `; waiver max ${waiver.maxLines}` : "";
      violations.push(`${path}: ${count}/${limit}${allowance}`);
    }
  }

  const staleWaivers = [...waiverEntries.keys()]
    .filter((path) => !usedWaivers.has(path))
    .map((path) => `${path} - remove or update this waiver`)
    .sort();
  return { violations: violations.sort(), waived: waived.sort(), staleWaivers };
}

function countLines(source) {
  if (source.length === 0) return 0;
  return source.split(/\r?\n/).length - (source.endsWith("\n") ? 1 : 0);
}

function printTemporaryWaivers(label, waivers) {
  const entries = Object.entries(waivers);
  if (entries.length === 0) return;
  console.log(`Temporary ${label} waivers (${entries.length}):`);
  for (const [signature, reason] of entries) console.log(`- ${signature} - ${reason}`);
}
