import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { defineGroupCard } from "@chatverse/core";
import type { GroupCard } from "@chatverse/core";

export const GROUP_PACKAGE_SCHEMA_VERSION = 1;
export const GROUP_PACKAGE_EXTENSION = ".chatverse.zip";

export interface GroupPackageAsset {
  path: string;
  bytes: Uint8Array;
}

export interface DecodedGroupPackage {
  directoryName: string;
  group: GroupCard;
  assets: GroupPackageAsset[];
}

export interface GroupPackageLimits {
  maxArchiveBytes: number;
  maxJsonBytes: number;
  maxAssetBytes: number;
  maxAssets: number;
  maxExpandedBytes: number;
}

export const DEFAULT_GROUP_PACKAGE_LIMITS: GroupPackageLimits = {
  maxArchiveBytes: 20 * 1024 * 1024,
  maxJsonBytes: 2 * 1024 * 1024,
  maxAssetBytes: 10 * 1024 * 1024,
  maxAssets: 100,
  maxExpandedBytes: 40 * 1024 * 1024,
};

export class GroupPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupPackageError";
  }
}

export function createGroupPackageArchive(groupInput: GroupCard, assets: readonly GroupPackageAsset[] = []): Uint8Array {
  const group = defineGroupCard(groupInput);
  const directoryName = groupPackageDirectoryName(group);
  const files: Record<string, Uint8Array> = {
    [`${directoryName}/group.json`]: strToU8(JSON.stringify(group, null, 2)),
    [`${directoryName}/assets/`]: new Uint8Array(),
  };
  const seen = new Set<string>();
  for (const asset of assets) {
    const path = normalizeAssetPath(asset.path);
    if (seen.has(path)) throw new GroupPackageError(`Duplicate asset path: ${path}`);
    seen.add(path);
    files[`${directoryName}/assets/${path}`] = asset.bytes;
  }
  validateAssetReferences(group, seen);
  return zipSync(files, { level: 6 });
}

export function decodeGroupPackageArchive(
  archive: Uint8Array,
  limits: GroupPackageLimits = DEFAULT_GROUP_PACKAGE_LIMITS,
): DecodedGroupPackage {
  if (archive.byteLength > limits.maxArchiveBytes) throw new GroupPackageError("Group package is too large");

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch {
    throw new GroupPackageError("Invalid or damaged group package archive");
  }

  const entries = Object.entries(files);
  if (entries.length === 0) throw new GroupPackageError("Group package is empty");
  let expandedBytes = 0;
  for (const [path, bytes] of entries) {
    if (!isSafeArchivePath(path)) throw new GroupPackageError(`Unsafe package path: ${path}`);
    expandedBytes += bytes.byteLength;
    if (expandedBytes > limits.maxExpandedBytes) throw new GroupPackageError("Expanded group package is too large");
  }

  const groupEntry = entries.filter(([path]) => path.endsWith("/group.json"));
  if (groupEntry.length !== 1) throw new GroupPackageError("Package must contain exactly one group.json");
  const [groupPath, groupBytes] = groupEntry[0]!;
  const directoryName = groupPath.slice(0, -"/group.json".length);
  if (!directoryName.endsWith(".chatverse") || directoryName.includes("/")) {
    throw new GroupPackageError("Package root directory must end with .chatverse");
  }
  if (groupBytes.byteLength > limits.maxJsonBytes) throw new GroupPackageError("group.json is too large");

  const assets: GroupPackageAsset[] = [];
  for (const [path, bytes] of entries) {
    if (path === groupPath) continue;
    if (path === `${directoryName}/assets/`) continue;
    const prefix = `${directoryName}/assets/`;
    if (!path.startsWith(prefix)) throw new GroupPackageError(`Unexpected package file: ${path}`);
    if (assets.length >= limits.maxAssets) throw new GroupPackageError("Package contains too many assets");
    if (bytes.byteLength > limits.maxAssetBytes) throw new GroupPackageError(`Asset is too large: ${path}`);
    assets.push({ path: normalizeAssetPath(path.slice(prefix.length)), bytes });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(groupBytes));
  } catch {
    throw new GroupPackageError("group.json is not valid JSON");
  }
  if (!isRecord(raw) || raw.kind !== "chatverse.group") throw new GroupPackageError("group.json is not a ChatVerse group");
  if (raw.schemaVersion !== GROUP_PACKAGE_SCHEMA_VERSION) {
    throw new GroupPackageError(`Unsupported group schemaVersion: ${String(raw.schemaVersion)}`);
  }
  if (!isRecord(raw.metadata) || typeof raw.metadata.name !== "string" || !isRecord(raw.scene) || !Array.isArray(raw.characters)) {
    throw new GroupPackageError("group.json is missing required group fields");
  }

  const assetPaths = new Set(assets.map((asset) => asset.path));
  validateAssetReferences(raw, assetPaths);
  return { directoryName, group: defineGroupCard(raw as unknown as GroupCard), assets };
}

export function groupPackageDirectoryName(group: Pick<GroupCard, "metadata">): string {
  const slug = slugify(group.metadata.name || "chatverse-group");
  return `${slug}.chatverse`;
}

export function groupPackageFileName(group: Pick<GroupCard, "metadata">): string {
  return `${groupPackageDirectoryName(group)}.zip`;
}

export function normalizeAssetPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new GroupPackageError(`Invalid asset path: ${path}`);
  }
  return normalized;
}

function validateAssetReferences(value: unknown, assetPaths: ReadonlySet<string>): void {
  for (const reference of findAssetReferences(value)) {
    const path = normalizeAssetPath(reference);
    if (!assetPaths.has(path)) throw new GroupPackageError(`Missing referenced asset: ${path}`);
  }
}

function* findAssetReferences(value: unknown): Iterable<string> {
  if (typeof value === "string") {
    if (value.startsWith("asset://")) yield value.slice("asset://".length);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) yield* findAssetReferences(item);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) yield* findAssetReferences(item);
  }
}

function isSafeArchivePath(path: string): boolean {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  return Boolean(normalized) && !normalized.startsWith("/") && !normalized.includes("\\") && !normalized.split("/").some((part) => part === "" || part === "." || part === "..");
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "chatverse-group";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
