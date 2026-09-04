import { useMemo, useState } from "react";
import { Check, Globe2, KeyRound, Lightbulb, Route, ShieldCheck, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import GuidedTour, { GuideLauncher, type GuidedTourStep } from "../components/GuidedTour";
import StorageSettingsPage from "./StorageSettingsPage";
import type { ProviderModelProfile } from "@chatverse/core";
import {
  clearProviderSettings,
  providerRequestHeadersForSettings,
  readProviderSettings,
  saveProviderSettings,
  testProviderConnection,
  type ProviderPreset,
} from "../providerSettings";
import {
  getProviderPresetDefinition,
  getProviderModelProfile,
  providerCapabilities,
  providerProtocol,
  PROVIDER_PRESETS,
  type ProviderProtocol,
} from "../providerCatalog";
import {
  clearResearchProviderSettings,
  readResearchProviderSettings,
  saveResearchProviderSettings,
  testResearchProviderConnection,
} from "../researchProviderSettings";
import {
  getResearchProviderPreset,
  RESEARCH_PROVIDER_PRESETS,
  type ResearchProviderPreset,
} from "../researchProviderCatalog";
import type { WebResearchProtocol } from "@chatverse/core";
import { completeOnboardingChapter, dismissOnboardingChapter, readOnboardingState } from "../onboarding";

export default function SettingsPage({ section }: { section: "models" | "storage" | "developer" }) {
  if (section === "models") return <ModelSettingsPage />;
  if (section === "storage") return <StorageSettingsPage />;
  return (
    <div className="workspace-page page-enter">
      <header className="page-header">
        <div>
          <p className="eyebrow">应用设置</p>
          <h1>开发者</h1>
          <p>控制运行观察页中的原始事件和快照是否可见。</p>
        </div>
      </header>
      <section className="developer-settings-panel">
        <div>
          <h2>开发观察</h2>
          <p>开发模式将控制运行观察页中的原始事件和快照是否可见。</p>
        </div>
      </section>
    </div>
  );
}

function ModelSettingsPage() {
  const [initialSettings] = useState(readProviderSettings);
  const [preset, setPreset] = useState<ProviderPreset>(initialSettings.preset);
  const [protocol, setProtocol] = useState<ProviderProtocol>(initialSettings.protocol);
  const [providerName, setProviderName] = useState(initialSettings.providerName);
  const [apiKey, setApiKey] = useState(initialSettings.apiKey);
  const [baseURL, setBaseURL] = useState(initialSettings.baseURL);
  const [model, setModel] = useState(initialSettings.model);
  const [providerOptions, setProviderOptions] = useState<Record<string, unknown>>(initialSettings.providerOptions);
  const [modelProfile, setModelProfile] = useState(initialSettings.modelProfile);
  const [isSaved, setIsSaved] = useState(() => Boolean(
    initialSettings.apiKey && initialSettings.baseURL && initialSettings.model,
  ));
  const [isTesting, setIsTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "testing" | "saved" | "cleared" | "error">("idle");
  const [error, setError] = useState("");
  const [guideOpen, setGuideOpen] = useState(() => (
    readOnboardingState().chapters.models === "pending" && !initialSettings.apiKey
  ));
  const guideSteps = useMemo<GuidedTourStep[]>(() => [
    {
      target: "[data-guide='model-provider']",
      eyebrow: "模型航线 · 01",
      title: "先选你实际有账号的服务商",
      description: "模板会自动填写兼容地址和推荐模型。没有列出的服务商也可以选“自定义”，只要它兼容 OpenAI Chat Completions。",
    },
    {
      target: "[data-guide='model-endpoint']",
      eyebrow: "模型航线 · 02",
      title: "确认地址与模型 ID",
      description: "Base URL 决定请求发到哪里，模型 ID 决定使用哪个模型。预设值可以编辑，最终以服务商控制台为准。",
    },
    {
      target: "[data-guide='model-key']",
      eyebrow: "模型航线 · 03",
      title: "Key 只留在这台浏览器",
      description: "ChatVerse 使用 BYOK。Key 不会进入世界包、聊天存档或调试事件；清理浏览器数据时也会一起移除。",
    },
    {
      target: "[data-guide='model-save']",
      eyebrow: "模型航线 · 04",
      title: "保存前会先做真实连接测试",
      description: "测试成功才会保存。完成后即可进入模板或 Studio，启动世界时请求会临时携带这份本机连接。",
    },
  ], []);

  function choosePreset(nextPreset: ProviderPreset) {
    const definition = getProviderPresetDefinition(nextPreset);
    setPreset(nextPreset);
    const nextProtocol = providerProtocol(definition);
    setProtocol(nextProtocol);
    setIsSaved(false);
    setStatus("idle");
    setError("");
    setProviderName(definition.providerName);
    setBaseURL(definition.baseURL);
    setModel(definition.models[0]?.id ?? "");
    setModelProfile(definition.models[0]
      ? getProviderModelProfile(definition, definition.models[0].id)
      : undefined);
    setProviderOptions(definition.providerOptions ?? {});
  }

  async function save() {
    const normalizedBaseURL = baseURL.trim();
    if (!apiKey.trim() || !normalizedBaseURL || !model.trim()) {
      setStatus("error");
      setError("请填写 API Base URL、模型名称和 API Key。");
      return;
    }
    try {
      const parsed = new URL(normalizedBaseURL);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error("invalid url");
      }
    } catch {
      setStatus("error");
      setError("API Base URL 需要是有效的 http 或 https 地址，且不能包含账号密码。");
      return;
    }

    const candidate = {
      apiKey: apiKey.trim(),
      baseURL: normalizedBaseURL,
      model: model.trim(),
      protocol,
      providerName: providerName.trim() || "自定义服务商",
      preset,
      providerOptions,
      modelProfile,
    };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setIsTesting(true);
    setStatus("testing");
    setError("");
    try {
      await testProviderConnection(candidate, controller.signal);
      const saved = saveProviderSettings({
        ...candidate,
        providerOptions,
      });
      setProviderName(saved.providerName);
      setProtocol(saved.protocol);
      setApiKey(saved.apiKey);
      setBaseURL(saved.baseURL);
      setModel(saved.model);
      setProviderOptions(saved.providerOptions);
      setModelProfile(saved.modelProfile);
      setIsSaved(true);
      setStatus("saved");
      completeOnboardingChapter("models");
      setGuideOpen(false);
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error && cause.name === "AbortError"
        ? "连接测试超时，请检查地址、网络和服务商状态。"
        : cause instanceof Error ? cause.message : "模型连接测试失败，请检查配置。");
    } finally {
      window.clearTimeout(timeout);
      setIsTesting(false);
    }
  }

  function clear() {
    if (isTesting) return;
    clearProviderSettings();
    const empty = readProviderSettings();
    setPreset(empty.preset);
    setProtocol(empty.protocol);
    setProviderName(empty.providerName);
    setApiKey(empty.apiKey);
    setBaseURL(empty.baseURL);
    setModel(empty.model);
    setProviderOptions(empty.providerOptions);
    setModelProfile(empty.modelProfile);
    setIsSaved(false);
    setStatus("cleared");
    setError("");
  }

  const selectedPreset = getProviderPresetDefinition(preset);
  const selectedProtocol = protocol;
  const selectedCapabilities = providerCapabilities({ ...selectedPreset, protocol: selectedProtocol });
  const selectedModel = selectedPreset.models.find((candidate) => candidate.id === model);
  const modelChoice = selectedModel?.id ?? "__custom__";
  return (
    <div className="workspace-page page-enter">
      <header className="page-header">
        <div>
          <p className="eyebrow">应用设置 · 本机连接</p>
          <h1>文本模型与密钥</h1>
          <p>使用你自己的文本模型 Key 运行世界、群聊和创作工具。图片生成使用独立连接。</p>
        </div>
        <GuideLauncher label="配置引导" onClick={() => setGuideOpen(true)} />
      </header>
      <section className="provider-settings-card" aria-labelledby="provider-settings-title">
        <div className="provider-settings-heading">
          <span className="provider-settings-icon"><KeyRound size={18} /></span>
          <div>
           <p className="eyebrow">BYOK · 协议驱动连接</p>
            <h2 id="provider-settings-title">连接自己的模型</h2>
            <p>选择一个服务商模板，或填写任意 OpenAI-compatible API。配置只保存在当前浏览器，发送请求时临时带给服务端，不会写入世界包、聊天存档或调试事件。</p>
          </div>
        </div>
        <div className="model-guide-rail" aria-label="模型连接步骤">
          {[
            { label: "选择服务商", done: Boolean(preset) },
            { label: "确认模型", done: Boolean(baseURL.trim() && model.trim()) },
            { label: "填入 Key", done: Boolean(apiKey.trim()) },
            { label: "测试并保存", done: isSaved },
          ].map((item, index) => (
            <span key={item.label} className={item.done ? "is-done" : index === 0 || [Boolean(preset), Boolean(baseURL.trim() && model.trim()), Boolean(apiKey.trim())].slice(0, index).every(Boolean) ? "is-current" : undefined}>
              <i>{item.done ? <Check size={12} /> : index + 1}</i><strong>{item.label}</strong>
            </span>
          ))}
          <Route size={16} aria-hidden="true" />
        </div>
        <label className="provider-settings-field" data-guide="model-provider">
          <span>服务商模板</span>
          <select value={preset} disabled={isTesting} onChange={(event) => choosePreset(event.target.value as ProviderPreset)}>
            <optgroup label="模型服务商">
              {PROVIDER_PRESETS.filter((definition) => definition.category === "model-vendor").map((definition) => (
                <option key={definition.id} value={definition.id}>{definition.label}</option>
              ))}
            </optgroup>
            <optgroup label="聚合与自定义">
              {PROVIDER_PRESETS.filter((definition) => definition.category !== "model-vendor").map((definition) => (
                <option key={definition.id} value={definition.id}>{definition.label}</option>
              ))}
            </optgroup>
          </select>
          <small className="provider-settings-hint">{selectedPreset.note}</small>
           {(selectedPreset.websiteURL || selectedPreset.apiKeyURL) && (
            <small className="provider-settings-hint provider-settings-links">
              {selectedPreset.websiteURL && <a href={selectedPreset.websiteURL} target="_blank" rel="noreferrer">服务商主页</a>}
              {selectedPreset.apiKeyURL && <a href={selectedPreset.apiKeyURL} target="_blank" rel="noreferrer">获取 API Key</a>}
              <span>{formatProtocol(selectedProtocol)}</span>
            </small>
          )}
        </label>
        {preset === "custom" ? (
          <label className="provider-settings-field">
            <span>协议</span>
            <select
              value={protocol}
              disabled={isTesting}
              onChange={(event) => {
                const nextProtocol = event.target.value as ProviderProtocol;
                setProtocol(nextProtocol);
                setIsSaved(false);
                setStatus("idle");
              }}
            >
              <option value="openai-chat">OpenAI Chat Completions</option>
              <option value="openai-responses">OpenAI Responses</option>
              <option value="anthropic-messages">Anthropic Messages</option>
            </select>
            <small className="provider-settings-hint">自定义连接只需选择它实际支持的协议；普通世界默认使用 Chat Completions。</small>
          </label>
        ) : (
          <div className="provider-settings-field provider-capability-summary">
            <span>连接协议与能力</span>
            <strong>{formatProtocol(selectedProtocol)}</strong>
            <small className="provider-settings-hint">{formatCapabilities(selectedCapabilities)}</small>
          </div>
        )}
        <label className="provider-settings-field">
          <span>显示名称</span>
          <input value={providerName} disabled={isTesting} onChange={(event) => { setProviderName(event.target.value); setIsSaved(false); setStatus("idle"); }} placeholder="例如：Moonshot" />
        </label>
        <label className="provider-settings-field" data-guide="model-endpoint">
          <span>API Base URL</span>
          <input value={baseURL} disabled={isTesting} onChange={(event) => { setBaseURL(event.target.value); setIsSaved(false); setStatus("idle"); }} placeholder="https://api.openai.com/v1" spellCheck={false} />
        </label>
        <label className="provider-settings-field">
          <span>默认模型</span>
          {selectedPreset.models.length > 0 && <select
            value={modelChoice}
            disabled={isTesting}
            onChange={(event) => {
              const nextModel = event.target.value === "__custom__" ? "" : event.target.value;
              setModel(nextModel);
              setModelProfile(nextModel
                ? getProviderModelProfile(selectedPreset, nextModel)
                : undefined);
              setIsSaved(false);
              setStatus("idle");
            }}
          >
            {selectedPreset.models.map((modelPreset) => <option key={modelPreset.id} value={modelPreset.id}>{modelPreset.label}</option>)}
            <option value="__custom__">自定义模型 ID...</option>
          </select>}
          {(!selectedModel || selectedPreset.models.length === 0) && <input
            value={model}
            disabled={isTesting}
            onChange={(event) => {
              setModel(event.target.value);
              setModelProfile(undefined);
              setIsSaved(false);
              setStatus("idle");
            }}
            placeholder="例如：gpt-5-mini"
            spellCheck={false}
          />}
          {selectedModel && (
            <small className="provider-settings-hint">
              {formatModelMetadata(selectedModel, modelProfile)}
            </small>
          )}
        </label>
        <div className="provider-settings-advice" role="note">
          <Lightbulb size={17} aria-hidden="true" />
          <div>
            <strong>模型选择建议</strong>
            <p>Actor、Narrator、普通群聊优先使用轻量、低延迟且支持关闭思考的模型；只有 Director 的复杂规划或长资料整理，再提高推理档位。</p>
            <small>{selectedModel?.reasoningLevels?.includes("none")
              ? "当前模型支持关闭思考，可按任务控制等待时间与 Token 消耗。"
              : "若模型不允许关闭思考，运行可能更慢并消耗更多 Token；请优先选择思考可选的模型。"}</small>
          </div>
        </div>
        <label className="provider-settings-field" data-guide="model-key">
          <span>API Key</span>
          <input
            type="password"
            value={apiKey}
            disabled={isTesting}
            onChange={(event) => { setApiKey(event.target.value); setIsSaved(false); setStatus("idle"); }}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="provider-settings-actions" data-guide="model-save">
          <button className="button button-primary" type="button" onClick={() => void save()} disabled={isTesting}><ShieldCheck size={15} />{isTesting ? "测试连接中..." : "保存连接"}</button>
          <button className="button button-quiet" type="button" onClick={clear} disabled={isTesting || (!apiKey && !baseURL && !model)}><Trash2 size={15} />清除本机配置</button>
          {isSaved && <Link className="button button-quiet" to="/groups">浏览世界模板</Link>}
          {status === "testing" && <span className="provider-settings-status">正在向 API 发送测试请求...</span>}
          {status === "saved" && <span className="provider-settings-status">连接测试成功，已保存到本机浏览器</span>}
          {status === "cleared" && <span className="provider-settings-status">已清除</span>}
          {status === "error" && <span className="provider-settings-error">{error}</span>}
        </div>
      </section>
      <ResearchProviderSettingsCard textSettings={readProviderSettings()} />
       <p className="provider-settings-note">安全提示：不要在截图、公开仓库、群包或分享链接中暴露 Key。服务端只负责转发到你填写的地址，不保存你的连接配置；请确认所选协议与服务商接口一致。</p>
      <GuidedTour
        label="文本模型连接"
        steps={guideSteps}
        open={guideOpen}
        onOpenChange={setGuideOpen}
        onComplete={() => dismissOnboardingChapter("models")}
        onDismiss={() => dismissOnboardingChapter("models")}
      />
    </div>
  );
}

function ResearchProviderSettingsCard({ textSettings }: { textSettings: ReturnType<typeof readProviderSettings> }) {
  const [initial] = useState(readResearchProviderSettings);
  const [preset, setPreset] = useState(initial.preset);
  const [protocol, setProtocol] = useState<WebResearchProtocol>(initial.protocol);
  const [providerName, setProviderName] = useState(initial.providerName);
  const [baseURL, setBaseURL] = useState(initial.baseURL);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [model, setModel] = useState(initial.model);
  const [options, setOptions] = useState(initial.options);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "cleared" | "error">("idle");
  const [error, setError] = useState("");
  const definition = getResearchProviderPreset(preset);
  const selectedModel = definition.models.some((item) => item.id === model) ? model : "__custom__";

  function choosePreset(next: ResearchProviderPreset) {
    const nextDefinition = getResearchProviderPreset(next);
    setPreset(next);
    setProtocol(nextDefinition.protocol);
    setProviderName(nextDefinition.providerName);
    setBaseURL(nextDefinition.baseURL);
    setModel(nextDefinition.defaultModel ?? "");
    setOptions(nextDefinition.options ?? {});
    setStatus("idle");
    setError("");
  }

  async function save() {
    if (!apiKey.trim() || !baseURL.trim()) {
      setStatus("error");
      setError("请填写联网接口的 Base URL 和 API Key。");
      return;
    }
    try {
      const parsed = new URL(baseURL.trim());
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    } catch {
      setStatus("error");
      setError("联网 API Base URL 需要是有效的 http 或 https 地址。");
      return;
    }
    if ((protocol === "responses-web-search" || protocol === "zhipu-web-search") && !model.trim()) {
      setStatus("error");
      setError("当前联网协议需要填写模型或搜索引擎名称。");
      return;
    }
    const candidate = { preset, protocol, providerName, apiKey, baseURL, model, options };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setTesting(true);
    setStatus("idle");
    setError("");
    try {
      await testResearchProviderConnection(
        candidate,
        providerRequestHeadersForSettings(textSettings),
        controller.signal,
      );
      const saved = saveResearchProviderSettings(candidate);
      setApiKey(saved.apiKey);
      setBaseURL(saved.baseURL);
      setModel(saved.model);
      setStatus("saved");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error && cause.name === "AbortError"
        ? "联网测试超时，请检查接口地址和服务状态。"
        : cause instanceof Error ? cause.message : "联网连接测试失败。");
    } finally {
      window.clearTimeout(timeout);
      setTesting(false);
    }
  }

  function clear() {
    clearResearchProviderSettings();
    const empty = readResearchProviderSettings();
    setPreset(empty.preset);
    setProtocol(empty.protocol);
    setProviderName(empty.providerName);
    setApiKey(empty.apiKey);
    setBaseURL(empty.baseURL);
    setModel(empty.model);
    setOptions(empty.options);
    setStatus("cleared");
    setError("");
  }

  return (
    <section className="provider-settings-card" aria-labelledby="research-provider-settings-title">
      <div className="provider-settings-heading">
        <span className="provider-settings-icon"><Globe2 size={18} /></span>
        <div>
          <p className="eyebrow">联网创作 · 独立连接</p>
          <h2 id="research-provider-settings-title">联网检索服务</h2>
          <p>搜索协议、Key、地址和模型与文本 Provider 完全分离。Studio 仅在开启联网创作时使用这里的连接。</p>
        </div>
      </div>
      <label className="provider-settings-field">
        <span>联网服务预设</span>
        <select value={preset} disabled={testing} onChange={(event) => choosePreset(event.target.value as ResearchProviderPreset)}>
          {RESEARCH_PROVIDER_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <small className="provider-settings-hint">{definition.note}</small>
        {(definition.websiteURL || definition.apiKeyURL) && <small className="provider-settings-hint provider-settings-links">
          {definition.websiteURL && <a href={definition.websiteURL} target="_blank" rel="noreferrer">服务主页</a>}
          {definition.apiKeyURL && <a href={definition.apiKeyURL} target="_blank" rel="noreferrer">获取 API Key</a>}
        </small>}
      </label>
      {preset === "custom" && <label className="provider-settings-field">
        <span>联网协议</span>
        <select value={protocol} disabled={testing} onChange={(event) => setProtocol(event.target.value as WebResearchProtocol)}>
          <option value="responses-web-search">Responses 内置 Web Search</option>
          <option value="tavily-search">Tavily Search API</option>
          <option value="zhipu-web-search">智谱 Web Search API</option>
        </select>
      </label>}
      <label className="provider-settings-field">
        <span>显示名称</span>
        <input value={providerName} disabled={testing} onChange={(event) => setProviderName(event.target.value)} />
      </label>
      <label className="provider-settings-field">
        <span>联网 API Base URL</span>
        <input value={baseURL} disabled={testing} onChange={(event) => setBaseURL(event.target.value)} spellCheck={false} />
      </label>
      {protocol !== "tavily-search" && <label className="provider-settings-field">
        <span>{protocol === "zhipu-web-search" ? "搜索引擎" : "联网模型"}</span>
        {definition.models.length > 0 && <select value={selectedModel} disabled={testing} onChange={(event) => setModel(event.target.value === "__custom__" ? "" : event.target.value)}>
          {definition.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          <option value="__custom__">自定义...</option>
        </select>}
        {(!model || selectedModel === "__custom__") && <input value={model} disabled={testing} onChange={(event) => setModel(event.target.value)} placeholder={protocol === "zhipu-web-search" ? "search_std" : "模型 ID"} />}
      </label>}
      <label className="provider-settings-field">
        <span>联网 API Key</span>
        <input type="password" value={apiKey} disabled={testing} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="仅保存于本机浏览器" />
      </label>
      <div className="provider-settings-actions">
        <button className="button button-primary" type="button" onClick={() => void save()} disabled={testing}><ShieldCheck size={15} />{testing ? "测试搜索中..." : "测试并保存联网连接"}</button>
        <button className="button button-quiet" type="button" onClick={clear} disabled={testing}><Trash2 size={15} />清除联网配置</button>
        {status === "saved" && <span className="provider-settings-status">联网搜索测试成功，已独立保存</span>}
        {status === "cleared" && <span className="provider-settings-status">联网配置已清除</span>}
        {status === "error" && <span className="provider-settings-error">{error}</span>}
      </div>
    </section>
  );
}

function formatModelMetadata(model: {
  contextWindow?: number;
  reasoningLevels?: readonly string[];
  inputModalities?: readonly ("text" | "image")[];
}, profile?: ProviderModelProfile): string {
  const parts: string[] = [];
  if (model.contextWindow ?? profile?.contextWindow) {
    parts.push(`上下文 ${formatContextWindow(model.contextWindow ?? profile?.contextWindow ?? 0)}`);
  }
  if (model.reasoningLevels?.length) {
    parts.push(`推理档位 ${model.reasoningLevels.join(" / ")}`);
  } else if (profile?.reasoning) {
    parts.push("支持推理");
  } else {
    parts.push("不发送推理扩展");
  }
  if (model.inputModalities?.includes("image") || profile?.input.includes("image")) {
    parts.push("支持图像输入");
  }
  if (profile?.maxTokens) parts.push(`输出上限 ${formatContextWindow(profile.maxTokens)}`);
  if (profile?.compatibility?.supportsFullJsonSchema === false) parts.push("简化工具 Schema");
  return parts.join(" · ") || "OpenAI-compatible 模型";
}

function formatProtocol(protocol: ProviderProtocol): string {
  switch (protocol) {
    case "openai-chat": return "OpenAI Chat Completions";
    case "openai-responses": return "OpenAI Responses";
    case "anthropic-messages": return "Anthropic Messages";
  }
}

function formatCapabilities(capabilities: ReturnType<typeof providerCapabilities>): string {
  const labels: string[] = [];
  if (capabilities.stream) labels.push("流式");
  if (capabilities.tools) labels.push("工具调用");
  if (capabilities.json !== "none") labels.push(`JSON ${capabilities.json === "native" ? "原生" : "Prompt"}`);
  if (capabilities.reasoning !== "none") labels.push("推理");
  if (capabilities.webSearch) labels.push("联网搜索");
  if (capabilities.vision) labels.push("图像输入");
  return labels.join(" · ") || "未声明能力，以连接测试结果为准";
}

function formatContextWindow(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  return `${Math.round(value / 1_000)}K`;
}
