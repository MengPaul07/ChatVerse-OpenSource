import { createReadStream, existsSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

export function serveStatic(
  response: ServerResponse,
  requestPath: string,
  staticRoot: string,
  headOnly: boolean,
): boolean {
  if (!existsSync(staticRoot)) return false;
  const decoded = decodeURIComponent(requestPath);
  const root = resolve(staticRoot);
  const requested = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  let filePath = resolve(root, requested);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return false;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = resolve(root, "index.html");
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  response.writeHead(200, {
    "Content-Type": mimeType(filePath),
    "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  if (headOnly) response.end();
  else createReadStream(filePath).pipe(response);
  return true;
}

function mimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".svg": return "image/svg+xml";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}
