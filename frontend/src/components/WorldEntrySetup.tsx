import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Gauge, ImagePlus, LoaderCircle, MessageSquareText, Play, Settings2, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { generateImageOnce } from "../imageGenerationClient";
import { readImageProviderSettings } from "../imageProviderSettings";
import { prepareGeneratedPortrait } from "../portraitImage";
import { findActorPortrait, saveVisualAsset } from "../visualAssetLibrary";
import { buildPortraitPrompt } from "../visualPromptBuilder";
import type { WorldRoomController } from "../world/WorldRoomContext";
import type { WorldView } from "../world/types";

type EntryMode = "world" | "stage";

export default function WorldEntrySetup({
  view,
  context,
  room,
  onStarted,
}: {
  view: WorldView;
  context: WorldView["contexts"][number];
  room: WorldRoomController;
  onStarted: (mode: EntryMode) => void;
}) {
  const [mode, setMode] = useState<EntryMode>(context.presentationMode);
  const [pacing, setPacing] = useState(context.pacingMultiplier);
  const [prefetch, setPrefetch] = useState(context.presentationPrefetchLimit);
  const [portraitActorIds, setPortraitActorIds] = useState<Set<string>>(new Set());
  const [portraitBusy, setPortraitBusy] = useState<string>();
  const [portraitError, setPortraitError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const cast = useMemo(() => view.actors.filter((actor) => !actor.playerControlled && context.actorIds.includes(actor.id)), [context.actorIds, view.actors]);
  const imageSettings = readImageProviderSettings();

  useEffect(() => {
    let cancelled = false;
    void Promise.all(cast.map(async (actor) => [actor.id, Boolean(await findActorPortrait(actor.id))] as const)).then((results) => {
      if (!cancelled) setPortraitActorIds(new Set(results.filter(([, exists]) => exists).map(([actorId]) => actorId)));
    });
    return () => { cancelled = true; };
  }, [cast]);

  async function storePortrait(actorId: string, blob: Blob, prompt: string, model?: string) {
    await saveVisualAsset({
      id: `portrait:${actorId}:${crypto.randomUUID()}`,
      kind: "actor_portrait",
      ownerId: actorId,
      archiveId: view.world.archiveId,
      blob,
      mimeType: blob.type,
      prompt,
      model,
      createdAt: Date.now(),
    });
    setPortraitActorIds((current) => new Set(current).add(actorId));
  }

  async function uploadPortrait(actorId: string, file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setPortraitError("请选择不超过 10MB 的 PNG、JPEG 或 WebP 图片。");
      return;
    }
    setPortraitBusy(actorId);
    setPortraitError(undefined);
    try {
      await storePortrait(actorId, file, "用户在启幕配置中上传");
    } finally {
      setPortraitBusy(undefined);
    }
  }

  async function generatePortrait(actorId: string) {
    const actor = cast.find((candidate) => candidate.id === actorId);
    if (!actor) return;
    if (!imageSettings.apiKey) {
      setPortraitError("请先在图片模型设置中配置连接，或直接上传立绘。");
      return;
    }
    setPortraitBusy(actorId);
    setPortraitError(undefined);
    try {
      const prompt = buildPortraitPrompt({
        artDirection: context.presentation?.artDirection,
        actorName: actor.name,
        appearance: actor.visual?.appearance || actor.description,
      });
      const result = await generateImageOnce(`entry-portrait:${actorId}`, imageSettings, prompt, imageSettings.portraitSize);
      await storePortrait(actorId, await prepareGeneratedPortrait(result.blob), prompt, result.model);
    } catch (cause) {
      setPortraitError(cause instanceof Error ? cause.message : "立绘生成失败，请稍后重试。");
    } finally {
      setPortraitBusy(undefined);
    }
  }

  async function startWorld() {
    if (starting) return;
    setStarting(true);
    setPortraitError(undefined);
    try {
      const policySaved = await room.setPresentationPolicy({
        presentationPrefetchLimit: prefetch,
      });
      if (!policySaved) throw new Error("演出参数保存失败。");
      if (!await room.setPacingMultiplier(pacing)) throw new Error("世界节奏保存失败。");
      if (!await room.setPresentationMode(mode)) throw new Error("进入方式保存失败。");
      if (!await room.start()) throw new Error("世界启动失败。");
      onStarted(mode);
    } catch (cause) {
      setPortraitError(cause instanceof Error ? cause.message : "暂时无法开启世界。");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="world-entry-backdrop" role="presentation">
      <section className="world-entry-setup" role="dialog" aria-modal="true" aria-labelledby="world-entry-title">
        <header className="world-entry-heading">
          <div><p className="eyebrow">启幕配置</p><h2 id="world-entry-title">先决定怎样进入“{view.world.name}”</h2><p>世界仍处于静止状态。确认体验方式和资源后，第一幕才会开始生成。</p></div>
          <span><Settings2 size={18} />启动前不会消耗剧情 Token</span>
        </header>

        <div className="world-entry-body">
          <section className="world-entry-section">
            <div className="world-entry-section-title"><span>01</span><div><strong>选择体验方式</strong><small>以后仍可切换视图，不会创建第二个世界。</small></div></div>
            <div className="world-entry-mode-grid">
              <button className={mode === "world" ? "is-selected" : ""} type="button" onClick={() => setMode("world")}>
                <MessageSquareText size={21} /><span><strong>世界视图</strong><small>像实时群聊一样连续展开，适合观察、输入和管理剧情。</small></span><i />
              </button>
              <button className={mode === "stage" ? "is-selected" : ""} type="button" onClick={() => setMode("stage")}>
                <Clapperboard size={21} /><span><strong>演出模式</strong><small>逐句阅读、手动推进，使用背景和角色立绘呈现。</small></span><i />
              </button>
            </div>
          </section>

          <section className="world-entry-section">
            <div className="world-entry-section-title"><span>02</span><div><strong>调整运行节奏</strong><small>这些参数只属于当前世界，随时可以在管理页再改。</small></div></div>
            <div className="world-entry-controls">
              <label><span><Gauge size={15} /><strong>世界视图节奏</strong><small>{pacingLabel(pacing)}；演出模式固定即时生成</small></span><input type="range" min="0.5" max="2.5" step="0.05" value={pacing} onChange={(event) => setPacing(Number(event.target.value))} /></label>
              <label><span><strong>后台预生成</strong><small>演出时提前准备，遇到玩家回合会停下</small></span><select value={prefetch} onChange={(event) => setPrefetch(Number(event.target.value))}>{[0, 1, 3, 5, 8, 10].map((value) => <option key={value} value={value}>{value} 条</option>)}</select></label>
            </div>
          </section>

          <section className="world-entry-section">
            <div className="world-entry-section-title"><span>03</span><div><strong>准备角色立绘</strong><small>可选。缺少立绘不会阻止世界启动，已有素材会跨幕复用。</small></div></div>
            <div className="world-entry-cast">
              {cast.map((actor) => {
                const ready = portraitActorIds.has(actor.id);
                return <article key={actor.id}><span className={ready ? "is-ready" : ""}>{ready ? "已备" : actor.name.slice(0, 1)}</span><div><strong>{actor.name}</strong><small>{portraitBusy === actor.id ? "正在准备立绘…" : ready ? "固定立绘已就绪" : "尚未准备，可稍后补充"}</small></div><label title={`上传 ${actor.name} 的立绘`}><Upload size={16} /><input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadPortrait(actor.id, event.target.files?.[0])} /></label><button type="button" title={`生成 ${actor.name} 的立绘`} disabled={Boolean(portraitBusy)} onClick={() => void generatePortrait(actor.id)}>{portraitBusy === actor.id ? <LoaderCircle className="is-spinning" size={16} /> : <ImagePlus size={16} />}</button></article>;
              })}
            </div>
            {!imageSettings.apiKey && <p className="world-entry-image-hint">尚未配置图片模型。你仍可上传图片或先进入世界，之后在<Link to="/settings/images">图片模型设置</Link>中完成配置。</p>}
          </section>
        </div>

        <footer className="world-entry-footer">
          <div>{portraitError ? <span className="is-error">{portraitError}</span> : <span>{portraitActorIds.size}/{cast.length} 位角色已准备立绘</span>}</div>
          <button className="button button-primary" type="button" disabled={starting || Boolean(portraitBusy)} onClick={() => void startWorld()}>{starting ? <LoaderCircle className="is-spinning" size={16} /> : <Play size={16} />}{starting ? "正在开启…" : mode === "stage" ? "以演出模式开启" : "进入世界"}</button>
        </footer>
      </section>
    </div>
  );
}

function pacingLabel(value: number): string {
  if (value < 0.9) return "快速";
  if (value < 1.15) return "标准";
  if (value < 1.55) return "慢一些";
  if (value < 2) return "舒缓";
  return "很慢";
}
