import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const WORKSPACE_CONTAINERS = ["packages", "apps"];

export function discoverSourceWorkspaces(root) {
  const directories = [];
  for (const container of WORKSPACE_CONTAINERS) {
    const containerPath = resolve(root, container);
    if (!existsSync(containerPath)) continue;
    for (const entry of readdirSync(containerPath, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(resolve(containerPath, entry.name));
    }
  }
  const frontend = resolve(root, "frontend");
  if (existsSync(frontend)) directories.push(frontend);

  return directories.flatMap((directory) => {
    const packagePath = resolve(directory, "package.json");
    const sourceRoot = resolve(directory, "src");
    if (!existsSync(packagePath) || !existsSync(sourceRoot)) return [];
    const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
    const entry = resolveSourceCandidate(resolve(sourceRoot, "index"))
      ?? resolveSourceCandidate(resolve(sourceRoot, "main"));
    return [{
      name: manifest.name,
      directory,
      sourceRoot,
      entry,
      entries: uniqueEntries([
        entry,
        ...resolveExportEntries(manifest.exports, directory, sourceRoot),
      ]),
    }];
  });
}

export function collectProductionModules(workspaces) {
  return workspaces.flatMap(({ sourceRoot }) => walk(sourceRoot)).filter(isProductionSource);
}

export function readModuleGraph(root, workspaces) {
  const files = collectProductionModules(workspaces);
  const fileSet = new Set(files);
  const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const graph = new Map();
  const imports = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const dependencies = new Set();
    for (const specifier of importSpecifiers(source)) {
      const dependency = resolveModuleImport(file, specifier, workspaceByName);
      imports.push({ file, specifier, dependency });
      if (dependency && fileSet.has(dependency)) dependencies.add(dependency);
    }
    graph.set(file, dependencies);
  }

  return { files, fileSet, graph, imports };
}

export function importSpecifiers(source) {
  const specifiers = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }
  return specifiers.filter(Boolean);
}

export function resolveModuleImport(importer, specifier, workspaceByName) {
  if (specifier.startsWith(".")) {
    return resolveSourceCandidate(resolve(dirname(importer), specifier));
  }

  for (const [name, workspace] of workspaceByName) {
    if (specifier === name) return workspace.entry;
    if (specifier.startsWith(`${name}/`)) {
      const subpath = specifier.slice(name.length + 1).replace(/^src\//, "");
      return resolveSourceCandidate(resolve(workspace.sourceRoot, subpath));
    }
  }
  return undefined;
}

export function owningWorkspace(file, workspaces) {
  return workspaces.find(({ sourceRoot }) => isWithin(file, sourceRoot));
}

export function isWithin(file, directory) {
  const path = relative(directory, file);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

export function relativePath(root, file) {
  return relative(root, file).replaceAll("\\", "/");
}

function resolveSourceCandidate(base) {
  const extension = extname(base);
  const candidates = extension
    ? [
        base,
        ...SOURCE_EXTENSIONS.map((sourceExtension) => base.replace(/\.[^.]+$/, sourceExtension)),
      ]
    : [
        ...SOURCE_EXTENSIONS.map((sourceExtension) => `${base}${sourceExtension}`),
        ...SOURCE_EXTENSIONS.map((sourceExtension) => resolve(base, `index${sourceExtension}`)),
      ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function resolveExportEntries(exportsField, directory, sourceRoot) {
  if (!exportsField) return [];
  const targets = [];
  collectExportTargets(exportsField, targets);
  return targets
    .map((target) => {
      if (!target.startsWith(".")) return undefined;
      const packagePath = target.replace(/^\.\//, "");
      const sourcePath = packagePath.startsWith("dist/")
        ? resolve(sourceRoot, packagePath.slice("dist/".length))
        : resolve(directory, packagePath);
      return resolveSourceCandidate(sourcePath);
    })
    .filter(Boolean);
}

function collectExportTargets(value, targets) {
  if (typeof value === "string") {
    targets.push(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const nested of Object.values(value)) collectExportTargets(nested, targets);
}

function uniqueEntries(entries) {
  return [...new Set(entries.filter(Boolean))];
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function isProductionSource(file) {
  return SOURCE_EXTENSIONS.includes(extname(file))
    && !/\.(?:test|spec)\.[^.]+$/.test(file)
    && !file.endsWith(".d.ts");
}
