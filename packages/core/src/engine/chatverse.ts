import type { ChatVerseConfig } from "../contracts/chat.js";
import type { ChatProvider } from "../contracts/provider.js";
import { InProcessRuntimeHost } from "../runtime/index.js";
import type { RuntimeHost } from "../runtime/index.js";
import type { CreateWorldOptions, WorldDefinition } from "../contracts/world.js";
import { World } from "./world/index.js";

/**
 * ChatVerse 引擎入口。
 * 绑定 Provider 与运行时宿主，负责创建 World。
 *
 * ```ts
 * // 简写（推荐）
 * const chatverse = new ChatVerse({ provider });
 *
 * const chatverse = new ChatVerse({
 *   directorProvider: cheapModel,
 *   characterProvider: strongModel,
 * });
 * ```
 */
export class ChatVerse {
  private directorProvider: ChatProvider;
  private characterProvider: ChatProvider;
  private runtime: RuntimeHost;

  constructor(config: ChatVerseConfig) {
    const dp = ("provider" in config ? config.provider : undefined)
      ?? ("directorProvider" in config ? config.directorProvider : undefined);
    const cp = ("provider" in config ? config.provider : undefined)
      ?? ("characterProvider" in config ? config.characterProvider : undefined)
      ?? dp;

    if (!dp || !cp) {
      throw new Error("ChatVerse requires a provider.");
    }
    this.directorProvider = dp;
    this.characterProvider = cp;
    this.runtime = config.runtime ?? new InProcessRuntimeHost();
  }

  createWorld(definition: WorldDefinition, options: CreateWorldOptions = {}): World {
    return new World(
      definition,
      this.directorProvider,
      this.characterProvider,
      this.runtime,
      options,
    );
  }
}
