import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  getImageProviderPresetDefinition,
  IMAGE_PROVIDER_PRESETS,
  type ImageProviderPreset,
} from "../imageProviderCatalog";
import {
  clearImageProviderSettings,
  normalizeImageProviderSettings,
  readImageProviderSettings,
  saveImageProviderSettings,
  testImageProviderConnection,
  type ImageProviderSettings,
} from "../imageProviderSettings";

type Status = "idle" | "testing" | "saved" | "cleared" | "error";

export default function ImageModelSettingsPage() {
  const [initialSettings] = useState(readImageProviderSettings);
  const [settings, setSettings] = useState(initialSettings);
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [verification, setVerification] = useState<"credentials" | "endpoint">();
  const selected = getImageProviderPresetDefinition(settings.preset);
  const selectedModel = selected.models.find((candidate) => candidate.id === settings.model);
  const modelChoice = selectedModel?.id ?? "__custom__";
  const isTesting = status === "testing";
  const isDirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(savedSettings), [settings, savedSettings]);

  function update<K extends keyof ImageProviderSettings>(key: K, value: ImageProviderSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setStatus("idle");
    setError("");
    setVerification(undefined);
  }

  function choosePreset(preset: ImageProviderPreset) {
    const definition = getImageProviderPresetDefinition(preset);
    setSettings((current) => ({
      preset,
      protocol: definition.protocol,
      providerName: definition.providerName,
      apiKey: current.apiKey,
      baseURL: definition.baseURL,
      model: definition.models[0]?.id ?? "",
      landscapeSize: definition.landscapeSizes[0] ?? "1536x1024",
      portraitSize: definition.portraitSizes[0] ?? "1024x1536",
    }));
    setStatus("idle");
    setError("");
    setVerification(undefined);
  }

  async function save() {
    const candidate = normalizeImageProviderSettings(settings);
    const validationError = validateSettings(candidate);
    if (validationError) {
      setStatus("error");
      setError(validationError);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    setStatus("testing");
    setError("");
    setVerification(undefined);
    try {
      const result = await testImageProviderConnection(candidate, controller.signal);
      const saved = saveImageProviderSettings(candidate);
      setSettings(saved);
      setSavedSettings(saved);
      setVerification(result.verification);
      setStatus("saved");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error && cause.name === "AbortError"
        ? "连接测试超时，请检查服务商地址、网络和账户状态。"
        : cause instanceof Error ? cause.message : "图片模型连接测试失败。");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function clear() {
    if (isTesting) return;
    clearImageProviderSettings();
    const empty = readImageProviderSettings();
    setSettings(empty);
    setSavedSettings(empty);
    setStatus("cleared");
    setError("");
    setVerification(undefined);
  }

  return (
    <div className="workspace-page image-provider-page page-enter">
      <header className="page-header">
        <div>
          <p className="eyebrow">应用设置 · 视觉生成</p>
          <h1>图片模型</h1>
          <p>为 Galgame 背景和角色立绘连接独立图片服务。文字编排与图片生成使用不同的 Key 和模型。</p>
        </div>
      </header>

      <section className="provider-settings-card image-provider-workbench" aria-labelledby="image-provider-title">
        <div className="image-provider-intro">
          <span className="provider-settings-icon"><ImageIcon size={19} /></span>
          <div>
            <p className="eyebrow">BYOK · IMAGE GENERATION</p>
            <h2 id="image-provider-title">连接图片生成服务</h2>
            <p>配置保存在当前浏览器。生成时 Key 仅随本次请求发送，不写入世界、素材记录或服务端日志。</p>
          </div>
          <span className={`image-provider-save-state${isDirty ? " is-dirty" : ""}`}>
            {isDirty ? "有未保存修改" : settings.apiKey ? "本机已配置" : "尚未配置"}
          </span>
        </div>

        <div className="image-provider-adapter-strip">
          <div>
            <span>当前适配器</span>
            <strong>{selected.protocolLabel}</strong>
          </div>
          <div>
            <span>响应方式</span>
            <strong>{settings.protocol === "bfl" ? "任务轮询后下载" : settings.protocol === "stability" ? "直接返回图片字节" : "生成后立即归档"}</strong>
          </div>
          <a href={selected.docsURL} target="_blank" rel="noreferrer">官方文档 <ExternalLink size={13} /></a>
        </div>

        <div className="image-provider-form">
          <label className="provider-settings-field image-provider-span-all">
            <span>服务商</span>
            <select value={settings.preset} disabled={isTesting} onChange={(event) => choosePreset(event.target.value as ImageProviderPreset)}>
              <optgroup label="国内服务">
                {IMAGE_PROVIDER_PRESETS.filter((item) => item.category === "domestic").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </optgroup>
              <optgroup label="国际服务">
                {IMAGE_PROVIDER_PRESETS.filter((item) => item.category === "international").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </optgroup>
              <optgroup label="自定义">
                {IMAGE_PROVIDER_PRESETS.filter((item) => item.category === "custom").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </optgroup>
            </select>
            <small className="provider-settings-hint">{selected.note}</small>
          </label>

          <label className="provider-settings-field">
            <span>API Base URL</span>
            <input value={settings.baseURL} disabled={isTesting} onChange={(event) => update("baseURL", event.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} />
          </label>
          <label className="provider-settings-field">
            <span>图片模型</span>
            {selected.models.length > 0 && <select value={modelChoice} disabled={isTesting} onChange={(event) => update("model", event.target.value === "__custom__" ? "" : event.target.value)}>
              {selected.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              <option value="__custom__">自定义模型 ID...</option>
            </select>}
            {(!selectedModel || selected.models.length === 0) && <input value={settings.model} disabled={isTesting} onChange={(event) => update("model", event.target.value)} placeholder="填写服务商模型 ID" spellCheck={false} />}
          </label>

          <div className="image-provider-output image-provider-span-all">
            <div className="image-provider-output-heading">
              <div><span>演出画幅</span><small>生成背景和立绘时使用；不支持精确尺寸的厂商会自动匹配最近画幅。</small></div>
            </div>
            <div className="image-provider-size-grid">
              <label>
                <span className="image-provider-aspect is-landscape" aria-hidden="true" />
                <span><strong>场景背景</strong><small>横向画布</small></span>
                <input value={settings.landscapeSize} list={`image-landscape-${settings.preset}`} disabled={isTesting} onChange={(event) => update("landscapeSize", event.target.value)} spellCheck={false} />
                <datalist id={`image-landscape-${settings.preset}`}>{selected.landscapeSizes.map((size) => <option key={size} value={size} />)}</datalist>
              </label>
              <label>
                <span className="image-provider-aspect is-portrait" aria-hidden="true" />
                <span><strong>角色立绘</strong><small>纵向画布</small></span>
                <input value={settings.portraitSize} list={`image-portrait-${settings.preset}`} disabled={isTesting} onChange={(event) => update("portraitSize", event.target.value)} spellCheck={false} />
                <datalist id={`image-portrait-${settings.preset}`}>{selected.portraitSizes.map((size) => <option key={size} value={size} />)}</datalist>
              </label>
            </div>
          </div>

          <label className="provider-settings-field image-provider-span-all">
            <span>API Key</span>
            <div className="image-provider-key-field">
              <KeyRound size={16} />
              <input type="password" value={settings.apiKey} disabled={isTesting} onChange={(event) => update("apiKey", event.target.value)} placeholder="仅保存到当前浏览器" autoComplete="off" spellCheck={false} />
            </div>
          </label>
        </div>

        <div className="image-provider-footer">
          <div className="provider-settings-actions">
            <button className="button button-primary" type="button" onClick={() => void save()} disabled={isTesting}>
              {isTesting ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
              {isTesting ? "正在验证连接..." : "测试并保存"}
            </button>
            <button className="button button-quiet" type="button" onClick={clear} disabled={isTesting || !settings.apiKey}><Trash2 size={15} />清除图片配置</button>
          </div>
          {status === "testing" && <p className="image-provider-feedback" role="status">正在通过所选适配器验证地址与凭证，不会生成付费图片。</p>}
          {status === "saved" && <p className="image-provider-feedback is-success" role="status"><CheckCircle2 size={15} />{verification === "endpoint" ? "服务端已响应，配置已保存；模型权限会在首次生成时确认。" : "凭证验证成功，图片连接已保存到本机。"}</p>}
          {status === "cleared" && <p className="image-provider-feedback" role="status">本机图片模型配置已清除。</p>}
          {status === "error" && <p className="image-provider-feedback is-error" role="alert">{error}</p>}
        </div>
      </section>

      <p className="provider-settings-note">服务端会拒绝本机和内网 Base URL，并限制返回图片为 PNG、JPEG 或 WebP 且不超过 10 MB。模型可用性、地区限制和费用以对应服务商控制台为准。</p>
    </div>
  );
}

function validateSettings(settings: ImageProviderSettings): string | undefined {
  if (!settings.apiKey || !settings.baseURL || !settings.model) return "请完整填写 API Base URL、图片模型和 API Key。";
  try {
    const url = new URL(settings.baseURL);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid");
  } catch {
    return "API Base URL 需要是不含账号密码的 HTTPS 地址。";
  }
  if (!isPixelSize(settings.landscapeSize) || !isPixelSize(settings.portraitSize)) {
    return "背景与立绘尺寸需要使用“宽x高”格式，例如 1536x1024。";
  }
  return undefined;
}

function isPixelSize(value: string): boolean {
  const match = /^(\d{3,4})x(\d{3,4})$/i.exec(value);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width >= 256 && width <= 8192 && height >= 256 && height <= 8192;
}
