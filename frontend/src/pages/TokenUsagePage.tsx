import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChartNoAxesCombined,
  Database,
  Download,
  Eraser,
  Gauge,
  RefreshCw,
} from "lucide-react";
import {
  buildTokenUsageAnalytics,
  localDateKey,
  purposeLabel,
  startOfLocalDay,
  type TokenUsageBreakdown,
} from "../tokenUsageAnalytics";
import {
  clearTokenUsageRecords,
  listTokenUsageRecords,
  readTokenUsagePreferences,
  saveTokenUsagePreferences,
  type TokenUsagePreferences,
} from "../tokenUsageLibrary";
import type { TokenUsageRecord } from "../world/types";

type RangeDays = 7 | 30 | 90 | 365 | 0;

const SEGMENTS = [
  { key: "cacheHitInputTokens", label: "缓存命中输入", className: "is-cache" },
  { key: "cacheMissInputTokens", label: "未缓存输入", className: "is-miss" },
  { key: "unknownCacheInputTokens", label: "缓存状态未知", className: "is-unknown" },
  { key: "visibleOutputTokens", label: "可见输出", className: "is-output" },
  { key: "reasoningTokens", label: "Reasoning", className: "is-reasoning" },
] as const;

const WORLD_COLORS = ["#087f6a", "#ca7a22", "#327c9b", "#695f8f", "#b65757", "#66766e"];

export default function TokenUsagePage() {
  const [records, setRecords] = useState<TokenUsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [worldId, setWorldId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [purpose, setPurpose] = useState("");
  const [selectedDay, setSelectedDay] = useState<string>();
  const [preferences, setPreferences] = useState<TokenUsagePreferences>(readTokenUsagePreferences);

  const rangeFrom = useMemo(() => rangeDays === 0
    ? undefined
    : startOfLocalDay(Date.now() - (rangeDays - 1) * 86_400_000), [rangeDays]);
  const dayFrom = selectedDay ? new Date(`${selectedDay}T00:00:00`).getTime() : undefined;
  const dayTo = dayFrom === undefined ? undefined : dayFrom + 86_400_000 - 1;
  const analytics = useMemo(() => buildTokenUsageAnalytics(records, {
    from: dayFrom ?? rangeFrom,
    to: dayTo,
    worldId: worldId || undefined,
    modelKey: selectedModel || undefined,
    purpose: purpose || undefined,
  }), [dayFrom, dayTo, purpose, rangeFrom, records, selectedModel, worldId]);
  const heatmapAnalytics = useMemo(() => buildTokenUsageAnalytics(records, {
    from: startOfLocalDay(Date.now() - 83 * 86_400_000),
    worldId: worldId || undefined,
    modelKey: selectedModel || undefined,
    purpose: purpose || undefined,
  }), [purpose, records, selectedModel, worldId]);
  const unscoped = useMemo(() => buildTokenUsageAnalytics(records), [records]);
  const worldOptions = unscoped.byWorld;
  const modelOptions = unscoped.byModel;
  const purposeOptions = unscoped.byPurpose;
  const cacheHitRate = analytics.totals.measuredInputTokens > 0
    ? analytics.totals.cacheHitInputTokens / analytics.totals.measuredInputTokens
    : undefined;
  const cacheCoverage = analytics.totals.inputTokens > 0
    ? analytics.totals.measuredInputTokens / analytics.totals.inputTokens
    : undefined;

  async function refresh() {
    setLoading(true);
    setError(undefined);
    try {
      setRecords(await listTokenUsageRecords());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取本地 Token 账本。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function clearUsage() {
    if (!window.confirm("确定清空当前设备上的全部 Token 统计吗？这不会删除世界和聊天记录。")) return;
    await clearTokenUsageRecords();
    setRecords([]);
  }

  function updatePreferences(next: TokenUsagePreferences) {
    const saved = saveTokenUsagePreferences(next);
    setPreferences(saved);
  }

  function exportCsv() {
    const rows = [
      ["时间", "世界", "Provider", "模型", "用途", "输入", "缓存命中", "输出", "Reasoning", "总量"],
      ...analytics.records.map((record) => [
        new Date(record.occurredAt).toISOString(), record.worldName, record.provider ?? "", record.model ?? "",
        purposeLabel(record.purpose), record.inputTokens, record.cacheHitInputTokens ?? "", record.outputTokens,
        record.reasoningTokens ?? "", record.totalTokens,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `chatverse-token-usage-${localDateKey(Date.now())}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="usage-page page-enter">
      <header className="usage-header">
        <div>
          <p className="eyebrow">LOCAL TOKEN LEDGER</p>
          <h1>Token 用量</h1>
          <p>查看模型调用如何分布在日期、模型和世界之间。数据只保存在当前设备。</p>
        </div>
        <div className="usage-header-actions">
          <span className="usage-latest-record">{records.length ? `最新记录 ${formatDateTime(records[0].occurredAt)}` : "暂无记录"}</span>
          <button className="button button-quiet" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />刷新</button>
          <button className="button button-quiet" onClick={exportCsv} disabled={!analytics.records.length}><Download size={15} />导出 CSV</button>
        </div>
      </header>

      <section className="usage-filter-bar" aria-label="Token 用量筛选">
        <label><span>时间范围</span><select value={rangeDays} onChange={(event) => { setRangeDays(Number(event.target.value) as RangeDays); setSelectedDay(undefined); }}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option><option value={365}>最近一年</option><option value={0}>全部记录</option></select></label>
        <label><span>世界</span><select value={worldId} onChange={(event) => setWorldId(event.target.value)}><option value="">全部世界</option>{worldOptions.map((row) => <option value={row.key} key={row.key}>{row.label}</option>)}</select></label>
        <label><span>模型</span><select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}><option value="">全部模型</option>{modelOptions.map((row) => <option value={row.key} key={row.key}>{row.label}</option>)}</select></label>
        <label><span>用途</span><select value={purpose} onChange={(event) => setPurpose(event.target.value)}><option value="">全部用途</option>{purposeOptions.map((row) => <option value={row.key} key={row.key}>{row.label}</option>)}</select></label>
        {selectedDay && <button className="usage-day-filter" onClick={() => setSelectedDay(undefined)}><CalendarDays size={14} />{selectedDay}<span>×</span></button>}
      </section>

      {error && <div className="notice notice-danger" role="alert">{error}</div>}
      {!preferences.enabled && (
        <div className="notice notice-muted" role="status">
          记录已停止:下方「记录 Token 用量」开关已关闭,新的模型调用不会再写入。开启后,新数据才会继续出现在这里。
        </div>
      )}

      <section className="usage-metric-strip" aria-label="用量摘要">
        <Metric label="总 Token" value={formatTokens(analytics.totals.totalTokens)} detail={`${analytics.totals.requestCount} 次模型调用`} prominent />
        <Metric label="输入 / 输出" value={`${formatTokens(analytics.totals.inputTokens)} / ${formatTokens(analytics.totals.outputTokens)}`} detail={`Reasoning ${formatTokens(analytics.totals.reasoningTokens)}`} />
        <Metric label="缓存命中率" value={cacheHitRate === undefined ? "暂无数据" : formatPercent(cacheHitRate)} detail={cacheCoverage === undefined ? "模型未上报缓存指标" : `覆盖 ${formatPercent(cacheCoverage)} 输入`} />
        <Metric label="统计范围" value={selectedDay ?? rangeLabel(rangeDays)} detail={analytics.records.length ? `统计自 ${formatDate(analytics.records.at(-1)?.occurredAt)}` : records.length ? "当前筛选范围内无记录" : "等待首次模型调用"} />
      </section>

      {loading ? <div className="usage-empty"><RefreshCw className="spin" /><strong>正在整理本地账本</strong></div> : analytics.records.length === 0 ? (
        <div className="usage-empty"><ChartNoAxesCombined /><strong>{records.length === 0 ? "还没有 Token 记录" : "这个范围内没有 Token 记录"}</strong><p>{records.length === 0 ? "进入世界并完成一次模型调用后，日期、模型和世界统计会出现在这里。" : "当前筛选没有匹配任何记录，调整上方时间范围或筛选条件后再试。"}</p></div>
      ) : (
        <>
          <section className="usage-panel usage-heatmap-panel">
            <PanelHeading icon={<CalendarDays size={17} />} title="日期消耗" detail="最近 12 周 · 点击日期筛选整页" />
            <UsageHeatmap values={heatmapAnalytics.byDay} selectedDay={selectedDay} onSelect={setSelectedDay} />
          </section>

          <div className="usage-chart-grid">
            <section className="usage-panel usage-model-panel">
              <PanelHeading icon={<Gauge size={17} />} title="模型分层" detail="输入、缓存与输出采用同一 Token 口径" />
              <TokenLegend />
              <ModelBars rows={analytics.byModel} selected={selectedModel} onSelect={setSelectedModel} />
            </section>
            <section className="usage-panel usage-world-panel">
              <PanelHeading icon={<Database size={17} />} title="世界占比" detail="前五个世界与其他" />
              <WorldDonut rows={analytics.byWorld} total={analytics.totals.totalTokens} selected={worldId} onSelect={setWorldId} />
            </section>
          </div>

          <section className="usage-panel usage-table-panel">
            <PanelHeading icon={<ChartNoAxesCombined size={17} />} title="世界明细" detail="按当前筛选范围汇总" />
            <UsageTable rows={analytics.byWorld} total={analytics.totals.totalTokens} onSelect={setWorldId} />
          </section>
        </>
      )}

      <section className="usage-local-settings">
        <div><strong>本地统计</strong><p>不记录提示词、回复正文或 API Key。关闭后不再写入新的调用记录。</p></div>
        <label className="usage-toggle"><input type="checkbox" checked={preferences.enabled} onChange={(event) => updatePreferences({ ...preferences, enabled: event.target.checked })} /><span>记录 Token 用量</span></label>
        <label><span>保留时间</span><select value={preferences.retentionDays} onChange={(event) => updatePreferences({ ...preferences, retentionDays: Number(event.target.value) as TokenUsagePreferences["retentionDays"] })}><option value={90}>90 天</option><option value={180}>180 天</option><option value={365}>一年</option><option value={0}>永久</option></select></label>
        <button className="button button-danger" onClick={() => void clearUsage()}><Eraser size={15} />清空统计</button>
      </section>
    </div>
  );
}

function Metric({ label, value, detail, prominent }: { label: string; value: string; detail: string; prominent?: boolean }) {
  return <div className={prominent ? "is-prominent" : ""}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function PanelHeading({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <header className="usage-panel-heading"><span>{icon}</span><div><h2>{title}</h2><p>{detail}</p></div></header>;
}

function UsageHeatmap({ values, selectedDay, onSelect }: { values: Array<{ key: string; totalTokens: number }>; selectedDay?: string; onSelect: (day?: string) => void }) {
  const totals = new Map(values.map((value) => [value.key, value.totalTokens]));
  const weeks = heatmapWeeks(Date.now());
  const max = Math.max(1, ...values.map((value) => value.totalTokens));
  return (
    <div className="usage-heatmap-wrap">
      <div className="usage-weekdays"><span>一</span><span>三</span><span>五</span><span>日</span></div>
      <div className="usage-heatmap">
        {weeks.map((week, index) => <div className="usage-heatmap-week" key={week[0]?.key ?? index}>
          <small>{week[0] && (index === 0 || new Date(week[0].timestamp).getDate() <= 7) ? `${new Date(week[0].timestamp).getMonth() + 1}月` : ""}</small>
          {week.map((day) => {
            const total = totals.get(day.key) ?? 0;
            const level = total === 0 ? 0 : Math.max(1, Math.ceil(Math.sqrt(total / max) * 5));
            return <button key={day.key} className={`usage-heat-cell level-${level}${selectedDay === day.key ? " is-selected" : ""}${day.future ? " is-future" : ""}`} disabled={day.future} title={`${day.key} · ${formatTokens(total)} Token`} aria-label={`${day.key}，${total} Token`} onClick={() => onSelect(selectedDay === day.key ? undefined : day.key)} />;
          })}
        </div>)}
      </div>
      <div className="usage-heat-scale"><span>少</span>{[0, 1, 2, 3, 4, 5].map((level) => <i className={`level-${level}`} key={level} />)}<span>多</span></div>
    </div>
  );
}

function TokenLegend() {
  return <div className="usage-token-legend">{SEGMENTS.map((segment) => <span key={segment.key}><i className={segment.className} />{segment.label}</span>)}</div>;
}

function ModelBars({ rows, selected, onSelect }: { rows: TokenUsageBreakdown[]; selected: string; onSelect: (key: string) => void }) {
  const visible = rows.slice(0, 8);
  const max = Math.max(1, ...visible.map((row) => row.totalTokens));
  return <div className="usage-model-bars">{visible.map((row) => <button className={selected === row.key ? "is-selected" : ""} onClick={() => onSelect(selected === row.key ? "" : row.key)} key={row.key}>
    <span className="usage-bar-label"><strong>{row.label}</strong><small>{formatTokens(row.totalTokens)}</small></span>
    <span className="usage-bar-track">{SEGMENTS.map((segment) => <i key={segment.key} className={segment.className} style={{ width: `${(row[segment.key] / max) * 100}%` }} title={`${segment.label} ${formatTokens(row[segment.key])}`} />)}</span>
    <span className="usage-bar-meta">{row.requestCount} 次 · 缓存 {row.measuredInputTokens ? formatPercent(row.cacheHitInputTokens / row.measuredInputTokens) : "未知"}</span>
  </button>)}</div>;
}

function WorldDonut({ rows, total, selected, onSelect }: { rows: TokenUsageBreakdown[]; total: number; selected: string; onSelect: (key: string) => void }) {
  const slices = donutRows(rows);
  let offset = 0;
  return <div className="usage-donut-layout">
    <div className="usage-donut"><svg viewBox="0 0 120 120" aria-label="世界 Token 占比图"><circle cx="60" cy="60" r="43" className="usage-donut-base" />{slices.map((slice, index) => {
      const share = total ? slice.totalTokens / total : 0;
      const dash = `${share * 270.18} ${270.18 - share * 270.18}`;
      const interactive = slice.key !== "__other";
      const selectSlice = () => { if (interactive) onSelect(selected === slice.key ? "" : slice.key); };
      const element = <circle key={slice.key} cx="60" cy="60" r="43" className={selected === slice.key ? "is-selected" : ""} stroke={WORLD_COLORS[index % WORLD_COLORS.length]} strokeDasharray={dash} strokeDashoffset={-offset * 270.18} onClick={selectSlice} onKeyDown={interactive ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectSlice(); } } : undefined} tabIndex={interactive ? 0 : undefined} role={interactive ? "button" : undefined} aria-label={interactive ? `${slice.label} ${formatPercent(share)}` : undefined} />;
      offset += share;
      return element;
    })}</svg><div><strong>{formatTokens(total)}</strong><span>Token</span></div></div>
    <div className="usage-world-legend">{slices.map((slice, index) => <button key={slice.key} onClick={() => slice.key !== "__other" && onSelect(selected === slice.key ? "" : slice.key)}><i style={{ background: WORLD_COLORS[index % WORLD_COLORS.length] }} /><span><strong>{slice.label}</strong><small>{formatPercent(total ? slice.totalTokens / total : 0)}</small></span></button>)}</div>
  </div>;
}

function UsageTable({ rows, total, onSelect }: { rows: TokenUsageBreakdown[]; total: number; onSelect: (key: string) => void }) {
  return <div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>世界</th><th>调用</th><th>输入</th><th>缓存命中率</th><th>输出</th><th>Reasoning</th><th>总量</th><th>占比</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} tabIndex={0} role="button" aria-label={`按世界筛选:${row.label}`} onClick={() => onSelect(row.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.key); } }}><td><strong>{row.label}</strong></td><td>{row.requestCount}</td><td>{formatTokens(row.inputTokens)}</td><td>{row.measuredInputTokens ? formatPercent(row.cacheHitInputTokens / row.measuredInputTokens) : "未知"}</td><td>{formatTokens(row.outputTokens)}</td><td>{formatTokens(row.reasoningTokens)}</td><td><strong>{formatTokens(row.totalTokens)}</strong></td><td>{formatPercent(total ? row.totalTokens / total : 0)}</td></tr>)}</tbody></table></div>;
}

function heatmapWeeks(now: number) {
  const today = startOfLocalDay(now);
  const day = new Date(today).getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const currentMonday = today + mondayOffset * 86_400_000;
  const start = currentMonday - 11 * 7 * 86_400_000;
  return Array.from({ length: 12 }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const timestamp = start + (week * 7 + weekday) * 86_400_000;
    return { key: localDateKey(timestamp), timestamp, future: timestamp > today };
  }));
}

function donutRows(rows: TokenUsageBreakdown[]): TokenUsageBreakdown[] {
  if (rows.length <= 6) return rows;
  const rest = rows.slice(5);
  const aggregate = rest.reduce<TokenUsageBreakdown>((sum, row) => ({
    ...sum,
    requestCount: sum.requestCount + row.requestCount,
    inputTokens: sum.inputTokens + row.inputTokens,
    outputTokens: sum.outputTokens + row.outputTokens,
    totalTokens: sum.totalTokens + row.totalTokens,
    reasoningTokens: sum.reasoningTokens + row.reasoningTokens,
    cacheHitInputTokens: sum.cacheHitInputTokens + row.cacheHitInputTokens,
    cacheMissInputTokens: sum.cacheMissInputTokens + row.cacheMissInputTokens,
    unknownCacheInputTokens: sum.unknownCacheInputTokens + row.unknownCacheInputTokens,
    measuredInputTokens: sum.measuredInputTokens + row.measuredInputTokens,
    visibleOutputTokens: sum.visibleOutputTokens + row.visibleOutputTokens,
  }), { ...rest[0]!, key: "__other", label: "其他", requestCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, cacheHitInputTokens: 0, cacheMissInputTokens: 0, unknownCacheInputTokens: 0, measuredInputTokens: 0, visibleOutputTokens: 0 });
  return [...rows.slice(0, 5), {
    ...aggregate,
  }];
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return String(value);
}

function formatPercent(value: number): string { return `${(value * 100).toFixed(value >= .1 ? 1 : 2)}%`; }
function formatDate(value?: number): string { return value ? new Date(value).toLocaleDateString("zh-CN") : "暂无"; }
function formatDateTime(value: number): string { return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function rangeLabel(days: RangeDays): string { return days === 0 ? "全部记录" : `最近 ${days} 天`; }
function csvCell(value: string | number): string { return `"${String(value).replaceAll('"', '""')}"`; }
