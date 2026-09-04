import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  collectProductionModules,
  discoverSourceWorkspaces,
} from "./lib/source-workspaces.mjs";

const root = resolve(import.meta.dirname, "..");
const files = collectProductionModules(discoverSourceWorkspaces(root));
const sources = files.map((file) => ({ file, source: readFileSync(file, "utf8") }));
const combined = sources.map(({ source }) => source).join("\n");
const candidates = [];

for (const { file, source } of sources) {
  if (file.endsWith("index.ts") || file.endsWith("index.tsx")) continue;
  const pattern = /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    const occurrences = combined.match(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"))?.length ?? 0;
    if (occurrences === 1) {
      const line = source.slice(0, match.index).split("\n").length;
      candidates.push(`${file.slice(root.length + 1)}:${line} ${name}`);
    }
  }
}

if (candidates.length === 0) {
  console.log("No single-use exported declarations found outside entry modules.");
} else {
  console.log("Single-use exported declarations outside entry modules:");
  for (const candidate of candidates) console.log(`- ${candidate}`);
  process.exitCode = 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
