import "dotenv/config";
import { listenWorldServer } from "./server.js";

const port = Number(process.env.PORT) || 8787;

if (await hasRunningChatVerseServer(port)) {
    console.log(`ChatVerse World Server already running on http://127.0.0.1:${port}; reusing it.`);
} else {
  try {
    await listenWorldServer(port);
  } catch (error) {
    const message = isAddressInUse(error)
      ? `Cannot start ChatVerse World Server: port ${port} is occupied by another service.`
      : `Cannot start ChatVerse World Server: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message);
    process.exitCode = 1;
  }
}

async function hasRunningChatVerseServer(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return false;
    const payload = await response.json() as { service?: unknown };
    return payload.service === "chatverse-world-server";
  } catch {
    return false;
  }
}

function isAddressInUse(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "EADDRINUSE",
  );
}
