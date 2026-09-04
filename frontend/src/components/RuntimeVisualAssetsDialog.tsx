import { ImagePlus, LoaderCircle, RefreshCw, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { generateImageOnce } from "../imageGenerationClient";
import { readImageProviderSettings } from "../imageProviderSettings";
import { prepareGeneratedPortrait } from "../portraitImage";
import { findActorPortrait, findBeatBackground, saveVisualAsset } from "../visualAssetLibrary";
import { buildBeatBackgroundPrompt, buildPortraitPrompt } from "../visualPromptBuilder";
import type { WorldView } from "../world/types";

export default function RuntimeVisualAssetsDialog({
  view,
  context,
  onClose,
  onBackgroundChanged,
}: {
  view: WorldView;
  context: WorldView["contexts"][number];
  onClose: () => void;
  onBackgroundChanged?: (blob: Blob) => void;
}) {
  const activeBeat = view.narrative.beats.find((beat) => beat.status === "running" && beat.contextIds.includes(context.id));
  const cast = useMemo(() => view.actors.filter((actor) => context.actorIds.includes(actor.id)), [context.actorIds, view.actors]);
  const [actorId, setActorId] = useState(cast[0]?.id);
  const actor = cast.find((candidate) => candidate.id === actorId) ?? cast[0];
  const [portraitUrls, setPortraitUrls] = useState<Record<string, string>>({});
  const [backgroundUrl, setBackgroundUrl] = useState<string>();
  const [portraitPrompt, setPortraitPrompt] = useState("");
  const [backgroundPrompt, setBackgroundPrompt] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const urls: string[] = [];
    let cancelled = false;
    void Promise.all(cast.map(async (item) => {
      const asset = await findActorPortrait(item.id);
      if (!asset) return undefined;
      const url = URL.createObjectURL(asset.blob);
      urls.push(url);
      return [item.id, url] as const;
    })).then((results) => {
      if (!cancelled) setPortraitUrls(Object.fromEntries(results.filter(Boolean) as Array<readonly [string, string]>));
    });
    return () => { cancelled = true; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [cast]);

  useEffect(() => {
    if (!activeBeat) { setBackgroundUrl(undefined); return; }
    let url: string | undefined;
    let cancelled = false;
    void findBeatBackground(view.world.archiveId, activeBeat.id).then((asset) => {
      if (!asset || cancelled) return;
      url = URL.createObjectURL(asset.blob);
      setBackgroundUrl(url);
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [activeBeat?.id, view.world.archiveId]);

  useEffect(() => {
    setBackgroundPrompt(buildBeatBackgroundPrompt({
      artDirection: context.presentation?.artDirection,
      worldName: view.world.name,
      beatBrief: activeBeat?.brief,
      sceneNow: context.scene.text,
    }));
  }, [activeBeat?.brief, context.presentation?.artDirection, context.scene.text, view.world.name]);

  useEffect(() => {
    if (!actor) return;
    setPortraitPrompt(buildPortraitPrompt({
      artDirection: context.presentation?.artDirection,
      actorName: actor.name,
      appearance: actor.visual?.appearance || actor.description,
    }));
  }, [actor, context.presentation?.artDirection]);

  async function generateBackground(useReference: boolean) {
    if (!activeBeat || !backgroundPrompt.trim()) return;
    const settings = readImageProviderSettings();
    if (!settings.apiKey) { setError("请先在图片模型设置中配置连接。"); return; }
    setBusy("background");
    setError(undefined);
    try {
      const referenceImage = useReference ? (await findBeatBackground(view.world.archiveId, activeBeat.id))?.blob : undefined;
      const result = await generateImageOnce(
        `runtime-background:${view.world.archiveId}:${activeBeat.id}:${crypto.randomUUID()}`,
        settings,
        backgroundPrompt.trim(),
        settings.landscapeSize,
        referenceImage ? { referenceImage } : {},
      );
      await saveVisualAsset({ id: `beat-background:${view.world.archiveId}:${activeBeat.id}`, kind: "beat_background", ownerId: context.id, archiveId: view.world.archiveId, beatId: activeBeat.id, blob: result.blob, mimeType: result.mimeType, prompt: backgroundPrompt.trim(), model: result.model, createdAt: Date.now() });
      setBackgroundUrl((previous) => { if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous); return URL.createObjectURL(result.blob); });
      onBackgroundChanged?.(result.blob);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "背景生成失败。");
    } finally { setBusy(undefined); }
  }

  async function uploadBackground(file?: File) {
    if (!activeBeat || !file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError("请选择不超过 10MB 的 PNG、JPEG 或 WebP 图片。");
      return;
    }
    setBusy("background");
    setError(undefined);
    try {
      await saveVisualAsset({
        id: `beat-background:${view.world.archiveId}:${activeBeat.id}`,
        kind: "beat_background",
        ownerId: context.id,
        archiveId: view.world.archiveId,
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
      onBackgroundChanged?.(file);
    } finally {
      setBusy(undefined);
    }
  }

  async function storePortrait(targetActorId: string, blob: Blob, prompt: string, model?: string) {
    const target = cast.find((candidate) => candidate.id === targetActorId);
    if (!target) return;
    await saveVisualAsset({ id: `portrait:${targetActorId}:${crypto.randomUUID()}`, kind: target.playerControlled ? "player_portrait" : "actor_portrait", ownerId: targetActorId, archiveId: view.world.archiveId, blob, mimeType: blob.type, prompt, model, createdAt: Date.now() });
    setPortraitUrls((previous) => ({ ...previous, [targetActorId]: URL.createObjectURL(blob) }));
  }

  async function uploadPortrait(file?: File) {
    if (!actor || !file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError("请选择不超过 10MB 的 PNG、JPEG 或 WebP 图片。");
      return;
    }
    setBusy(actor.id);
    try { await storePortrait(actor.id, file, "用户上传"); } finally { setBusy(undefined); }
  }

  async function generatePortrait(useReference: boolean) {
    if (!actor || !portraitPrompt.trim()) return;
    const settings = readImageProviderSettings();
    if (!settings.apiKey) { setError("请先在图片模型设置中配置连接。"); return; }
    setBusy(actor.id);
    setError(undefined);
    try {
      const referenceImage = useReference ? (await findActorPortrait(actor.id))?.blob : undefined;
      const result = await generateImageOnce(`runtime-portrait:${actor.id}:${crypto.randomUUID()}`, settings, portraitPrompt.trim(), settings.portraitSize, referenceImage ? { referenceImage } : {});
      await storePortrait(actor.id, await prepareGeneratedPortrait(result.blob), portraitPrompt.trim(), result.model);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "立绘生成失败。");
    } finally { setBusy(undefined); }
  }

  return <div className="runtime-visual-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="runtime-visual-dialog" role="dialog" aria-modal="true" aria-labelledby="runtime-visual-title">
      <header className="runtime-visual-header"><div><p className="eyebrow">视觉工作台</p><h2 id="runtime-visual-title">整理当前世界的演出素材</h2><span>背景跟随剧情节点，角色立绘跨节点复用。</span></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
      <div className="galgame-visual-workbench runtime-visual-body">
        <section>
          <header><div><strong>当前 Beat 背景</strong><span>{activeBeat ? "只替换画面，不改变剧情" : "新 Beat 开始后可生成"}</span></div>{busy === "background" && <LoaderCircle className="is-spinning" size={16} />}</header>
          <div className="galgame-background-preview" style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined} />
          <label><span>生成提示词</span><textarea rows={5} value={backgroundPrompt} onChange={(event) => setBackgroundPrompt(event.target.value)} /></label>
          <div className="galgame-asset-actions"><label><Upload size={16} />上传成品<input hidden type="file" accept="image/png,image/jpeg,image/webp" disabled={!activeBeat || Boolean(busy)} onChange={(event) => void uploadBackground(event.target.files?.[0])} /></label><button type="button" disabled={!activeBeat || Boolean(busy)} onClick={() => void generateBackground(false)}><ImagePlus size={16} />全新生成</button><button type="button" disabled={!backgroundUrl || Boolean(busy)} onClick={() => void generateBackground(true)}><RefreshCw size={16} />参考当前图调整</button></div>
        </section>
        <section>
          <header><div><strong>固定角色立绘</strong><span>跨 Beat 复用，不随台词重绘</span></div></header>
          <div className="galgame-actor-tabs">{cast.map((item) => <button type="button" key={item.id} className={actor?.id === item.id ? "is-active" : ""} onClick={() => setActorId(item.id)}>{item.name}</button>)}</div>
          {actor && <><div className="galgame-portrait-editor">{portraitUrls[actor.id] ? <img src={portraitUrls[actor.id]} alt={actor.name} /> : <div className="galgame-asset-placeholder">{actor.name.slice(0, 1)}</div>}<div><strong>{actor.name}</strong><span>{busy === actor.id ? "正在生成…" : "可上传成品或参考当前图继续调整"}</span></div></div><label><span>生成提示词</span><textarea rows={6} value={portraitPrompt} onChange={(event) => setPortraitPrompt(event.target.value)} /></label><div className="galgame-asset-actions"><label><Upload size={16} />上传成品<input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadPortrait(event.target.files?.[0])} /></label><button type="button" disabled={Boolean(busy)} onClick={() => void generatePortrait(false)}><ImagePlus size={16} />全新生成</button><button type="button" disabled={!portraitUrls[actor.id] || Boolean(busy)} onClick={() => void generatePortrait(true)}><RefreshCw size={16} />参考当前图调整</button></div></>}
        </section>
      </div>
      {error && <p className="notice notice-danger runtime-visual-notice">{error}</p>}
    </section>
  </div>;
}
