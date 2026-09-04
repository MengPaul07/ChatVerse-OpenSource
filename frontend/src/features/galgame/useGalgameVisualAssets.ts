import { useEffect, useState } from "react";
import type { WorldView, WorldViewBeat } from "../../world/types";
import type { WorldTemplateStageAssets } from "../../worldTemplateCatalog";
import {
  findActorPortrait,
  findBeatBackground,
  saveVisualAsset,
} from "../../visualAssetLibrary";
import { readImageProviderSettings } from "../../imageProviderSettings";
import { prepareGeneratedPortrait } from "../../portraitImage";
import { generateImageOnce } from "../../imageGenerationClient";
import { buildBeatBackgroundPrompt, buildPortraitPrompt } from "../../visualPromptBuilder";

const IMAGE_ATTEMPT_PREFIX = "chatverse:visual-generation-attempt:v1:";
const IMAGE_ATTEMPT_COOLDOWN_MS = 10 * 60 * 1000;

type WorldContext = WorldView["contexts"][number];
type WorldActor = WorldView["actors"][number];

export interface GalgameVisualAssets {
  backgroundUrl?: string;
  backgroundStatus: "idle" | "generating" | "failed";
  backgroundPrompt: string;
  backgroundBusy: boolean;
  backgroundError?: string;
  portraitUrls: Record<string, string>;
  portraitBusy?: string;
  portraitErrors: Record<string, string>;
  visualActorId?: string;
  setVisualActorId: (actorId: string) => void;
  visualActor?: WorldActor;
  portraitPrompt: string;
  setPortraitPrompt: (prompt: string) => void;
  setBackgroundPrompt: (prompt: string) => void;
  uploadPortrait: (actorId: string, file?: File) => Promise<void>;
  generatePortrait: (actorId: string, useReference?: boolean) => Promise<void>;
  regenerateBackground: (useReference: boolean) => Promise<void>;
  uploadBackground: (file?: File) => Promise<void>;
}

export function useGalgameVisualAssets({
  view,
  context,
  presentation,
  activeBeat,
  bundledStageAssets,
}: {
  view?: WorldView;
  context?: WorldContext;
  presentation?: WorldContext["presentation"];
  activeBeat?: WorldViewBeat;
  bundledStageAssets?: WorldTemplateStageAssets;
}): GalgameVisualAssets {
  const [backgroundUrl, setBackgroundUrl] = useState<string>();
  const [backgroundStatus, setBackgroundStatus] = useState<"idle" | "generating" | "failed">("idle");
  const [portraitUrls, setPortraitUrls] = useState<Record<string, string>>({});
  const [portraitBusy, setPortraitBusy] = useState<string>();
  const [portraitErrors, setPortraitErrors] = useState<Record<string, string>>({});
  const [visualActorId, setVisualActorId] = useState<string>();
  const [portraitPrompt, setPortraitPrompt] = useState("");
  const [backgroundPrompt, setBackgroundPrompt] = useState("");
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string>();

  const actors = view?.actors;
  const actorIdsKey = actors?.map((actor) => actor.id).join("\u0000") ?? "";
  const archiveId = view?.world.archiveId;
  const contextId = context?.id;
  const sceneText = context?.scene.text;
  const artDirection = presentation?.artDirection;
  const activeBeatId = activeBeat?.id;
  const activeBeatBrief = activeBeat?.brief;
  const bundledBackgroundUrl = bundledStageAssets?.background.src;
  const bundledPortraits = bundledStageAssets?.portraits;
  const bundledPortraitKey = Object.entries(bundledPortraits ?? {})
    .map(([actorName, asset]) => `${actorName}:${asset.src}`)
    .join("\u0000");
  const visualActor = actors?.find((actor) => actor.id === visualActorId);

  useEffect(() => {
    if (!actors) return;
    let cancelled = false;
    const urls: string[] = [];
    setPortraitUrls({});
    void Promise.all(actors.map(async (actor) => {
      const asset = await findActorPortrait(actor.id);
      if (asset) {
        const url = URL.createObjectURL(asset.blob);
        urls.push(url);
        return [actor.id, url] as const;
      }
      const bundled = bundledPortraits?.[actor.name];
      return bundled ? [actor.id, bundled.src] as const : undefined;
    })).then((results) => {
      if (!cancelled) setPortraitUrls(Object.fromEntries(results.filter(Boolean) as Array<readonly [string, string]>));
    });
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [actorIdsKey, bundledPortraitKey]);

  useEffect(() => {
    setBackgroundUrl(bundledBackgroundUrl);
    setBackgroundStatus("idle");
    if (!archiveId || !contextId || !sceneText || !artDirection || !activeBeatId || !activeBeatBrief || !view) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    const assetId = `beat-background:${archiveId}:${activeBeatId}`;
    void (async () => {
      const cached = await findBeatBackground(archiveId, activeBeatId);
      if (cancelled) return;
      if (cached) {
        finishImageGeneration(assetId);
        objectUrl = URL.createObjectURL(cached.blob);
        setBackgroundUrl(objectUrl);
        return;
      }
      if (bundledBackgroundUrl) return;
      const settings = readImageProviderSettings();
      if (!settings.apiKey) return;
      if (!claimImageGeneration(assetId)) {
        setBackgroundStatus("failed");
        return;
      }
      setBackgroundStatus("generating");
      const prompt = buildBeatBackgroundPrompt({
        artDirection,
        worldName: view.world.name,
        beatBrief: activeBeatBrief,
        sceneNow: sceneText,
      });
      const result = await generateImageOnce(assetId, settings, prompt, settings.landscapeSize);
      await saveVisualAsset({ id: assetId, kind: "beat_background", ownerId: contextId, archiveId, beatId: activeBeatId, blob: result.blob, mimeType: result.mimeType, prompt, model: result.model, createdAt: Date.now() });
      finishImageGeneration(assetId);
      if (cancelled) return;
      objectUrl = URL.createObjectURL(result.blob);
      setBackgroundUrl(objectUrl);
      setBackgroundStatus("idle");
    })().catch(() => { failImageGeneration(assetId); if (!cancelled) setBackgroundStatus("failed"); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [activeBeatId, archiveId, contextId, bundledBackgroundUrl]);

  useEffect(() => {
    setBackgroundPrompt(buildBeatBackgroundPrompt({
      artDirection,
      worldName: view?.world.name ?? "当前世界",
      beatBrief: activeBeatBrief,
      sceneNow: sceneText,
    }));
  }, [activeBeatBrief, artDirection, sceneText, view?.world.name]);

  useEffect(() => {
    if (!visualActorId) {
      const firstActor = actors?.find((actor) => context?.actorIds.includes(actor.id));
      if (firstActor) setVisualActorId(firstActor.id);
    }
  }, [context?.actorIds, actors, visualActorId]);

  useEffect(() => {
    if (!visualActor) return;
    setPortraitPrompt(buildPortraitPrompt({
      artDirection: presentation?.artDirection,
      actorName: visualActor.name,
      appearance: visualActor.visual?.appearance || visualActor.description,
    }));
  }, [presentation?.artDirection, visualActor]);

  const storePortrait = async (actorId: string, blob: Blob, prompt: string, model?: string) => {
    const actor = view?.actors.find((candidate) => candidate.id === actorId);
    if (!actor || !view) return;
    const id = `portrait:${actorId}:${crypto.randomUUID()}`;
    await saveVisualAsset({ id, kind: actor.playerControlled ? "player_portrait" : "actor_portrait", ownerId: actorId, archiveId: view.world.archiveId, blob, mimeType: blob.type, prompt, model, createdAt: Date.now() });
    const url = URL.createObjectURL(blob);
    setPortraitUrls((currentUrls) => ({ ...currentUrls, [actorId]: url }));
  };

  const uploadPortrait = async (actorId: string, file?: File) => {
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) return;
    setPortraitBusy(actorId);
    try { await storePortrait(actorId, file, "用户上传"); } finally { setPortraitBusy(undefined); }
  };

  const generatePortrait = async (actorId: string, useReference = false) => {
    const actor = view?.actors.find((candidate) => candidate.id === actorId);
    if (!actor || !presentation) return;
    const settings = readImageProviderSettings();
    if (!settings.apiKey) return;
    setPortraitErrors((current) => ({ ...current, [actorId]: "" }));
    setPortraitBusy(actorId);
    try {
      const prompt = actorId === visualActorId && portraitPrompt.trim()
        ? portraitPrompt.trim()
        : buildPortraitPrompt({
            artDirection: presentation.artDirection,
            actorName: actor.name,
            appearance: actor.visual?.appearance || actor.description,
          });
      const referenceImage = useReference ? (await findActorPortrait(actorId))?.blob : undefined;
      const result = await generateImageOnce(
        `portrait:${actorId}:${useReference ? "edit" : "new"}:${crypto.randomUUID()}`,
        settings,
        prompt,
        settings.portraitSize,
        referenceImage ? { referenceImage } : {},
      );
      const portrait = await prepareGeneratedPortrait(result.blob);
      await storePortrait(actorId, portrait, prompt, result.model);
    } catch (cause) {
      setPortraitErrors((current) => ({
        ...current,
        [actorId]: cause instanceof Error ? cause.message : "立绘生成失败，请稍后重试。",
      }));
    } finally { setPortraitBusy(undefined); }
  };

  const regenerateBackground = async (useReference: boolean) => {
    if (!activeBeat || !archiveId || !contextId || !backgroundPrompt.trim()) return;
    const settings = readImageProviderSettings();
    if (!settings.apiKey) return;
    setBackgroundBusy(true);
    setBackgroundError(undefined);
    try {
      const referenceImage = useReference ? (await findBeatBackground(archiveId, activeBeat.id))?.blob : undefined;
      const result = await generateImageOnce(
        `beat-background-redraw:${archiveId}:${activeBeat.id}:${crypto.randomUUID()}`,
        settings,
        backgroundPrompt.trim(),
        settings.landscapeSize,
        referenceImage ? { referenceImage } : {},
      );
      const assetId = `beat-background:${archiveId}:${activeBeat.id}`;
      await saveVisualAsset({
        id: assetId,
        kind: "beat_background",
        ownerId: contextId,
        archiveId,
        beatId: activeBeat.id,
        blob: result.blob,
        mimeType: result.mimeType,
        prompt: backgroundPrompt.trim(),
        model: result.model,
        createdAt: Date.now(),
      });
      setBackgroundUrl((previous) => {
        if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
        return URL.createObjectURL(result.blob);
      });
      setBackgroundStatus("idle");
    } catch (cause) {
      setBackgroundError(cause instanceof Error ? cause.message : "背景生成失败，请稍后重试。");
    } finally {
      setBackgroundBusy(false);
    }
  };

  const uploadBackground = async (file?: File) => {
    if (!file || !activeBeat || !archiveId || !contextId) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setBackgroundError("请选择不超过 10MB 的 PNG、JPEG 或 WebP 图片。");
      return;
    }
    setBackgroundBusy(true);
    setBackgroundError(undefined);
    try {
      await saveVisualAsset({
        id: `beat-background:${archiveId}:${activeBeat.id}`,
        kind: "beat_background",
        ownerId: contextId,
        archiveId,
        beatId: activeBeat.id,
        blob: file,
        mimeType: file.type,
        prompt: backgroundPrompt.trim() || "用户上传",
        createdAt: Date.now(),
      });
      setBackgroundUrl((previous) => {
        if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
        return URL.createObjectURL(file);
      });
      setBackgroundStatus("idle");
    } finally {
      setBackgroundBusy(false);
    }
  };

  return {
    backgroundUrl,
    backgroundStatus,
    backgroundPrompt,
    backgroundBusy,
    backgroundError,
    portraitUrls,
    portraitBusy,
    portraitErrors,
    visualActorId,
    setVisualActorId,
    visualActor,
    portraitPrompt,
    setPortraitPrompt,
    setBackgroundPrompt,
    uploadPortrait,
    generatePortrait,
    regenerateBackground,
    uploadBackground,
  };
}

function claimImageGeneration(assetId: string): boolean {
  const key = `${IMAGE_ATTEMPT_PREFIX}${assetId}`;
  const previous = Number(window.localStorage.getItem(key) ?? 0);
  if (previous > 0 && Date.now() - previous < IMAGE_ATTEMPT_COOLDOWN_MS) return false;
  window.localStorage.setItem(key, String(Date.now()));
  return true;
}

function finishImageGeneration(assetId: string): void {
  window.localStorage.removeItem(`${IMAGE_ATTEMPT_PREFIX}${assetId}`);
}

function failImageGeneration(assetId: string): void {
  window.localStorage.setItem(`${IMAGE_ATTEMPT_PREFIX}${assetId}`, String(Date.now()));
}
