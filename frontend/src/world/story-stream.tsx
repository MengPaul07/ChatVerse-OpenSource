import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, LoaderCircle, WandSparkles } from "lucide-react";
import { Link } from "react-router-dom";
import WorldRecoveryCard from "../components/WorldRecoveryCard";
import MarkdownContent from "../components/MarkdownContent";
import type { WorldView, WorldViewEntry } from "./types";
import { buildStoryTimeline, orderPresentationEntries, selectPresentationTurnEntries, streamedTextLength } from "./presentation";

export type PendingWorldEntry = {
  kind: "human";
  text: string;
  createdAt: number;
};
function StoryMessageRow({ entry, streaming, pacingMultiplier, precedingCharacters }: {
  entry: WorldViewEntry;
  streaming: boolean;
  pacingMultiplier: number;
  precedingCharacters: number;
}) {
  const text = <StreamingMarkdownText text={entry.text} active={streaming} pacingMultiplier={pacingMultiplier} precedingCharacters={precedingCharacters} />;
  if (entry.kind === "action") {
    return (
      <article className="story-action">
        <div className="story-action-line">（{entry.actorName}{text}）</div>
        <time>{formatTime(entry.occurredAt)}</time>
      </article>
    );
  }
  if (entry.kind === "narration") {
    return (
      <article className="story-narration">
        <span>旁白</span>
        {text}
        <time>{formatTime(entry.occurredAt)}</time>
      </article>
    );
  }
  if (entry.kind === "directive") {
    return (
      <article className="story-director">
        <WandSparkles size={15} />
        <div className="story-director-copy"><strong>旁白介入：</strong>{text}</div>
        <time>{formatTime(entry.occurredAt)}</time>
      </article>
    );
  }
  return (
    <article className={`story-dialogue ${entry.kind === "human" ? "is-human" : ""}`}>
      <div className="story-speaker">{entry.actorName?.slice(0, 1) ?? "?"}</div>
      <div>
        <header><strong>{entry.actorName ?? "未知角色"}</strong><time>{formatTime(entry.occurredAt)}</time></header>
        {text}
      </div>
    </article>
  );
}

export function StoryStream({
  entries,
  beats,
  directorStatus,
  pendingEntry,
  providerIssue,
  recovery,
  recoveryPending,
  worldRunning,
  streamingEntryIds = [],
  pacingMultiplier = 1,
  onRetryRecovery,
  onDismissRecovery,
}: {
  entries: WorldViewEntry[];
  beats: WorldView["narrative"]["beats"];
  directorStatus: WorldView["director"]["status"];
  pendingEntry?: PendingWorldEntry;
  providerIssue?: WorldView["runtime"]["providerIssue"];
  recovery?: WorldView["contexts"][number]["recovery"];
  recoveryPending: boolean;
  worldRunning: boolean;
  streamingEntryIds?: string[];
  pacingMultiplier?: number;
  onRetryRecovery: (failureId: string) => void;
  onDismissRecovery: (failureId: string) => void;
}) {
  const streamRef = useRef<HTMLElement>(null);
  const stickToBottomRef = useRef(true);
  const lastTimelineItemIdRef = useRef<string | undefined>(undefined);
  const timeline = useMemo(() => {
    const currentTurnEntries = selectPresentationTurnEntries(entries, streamingEntryIds);
    const turnReady = streamingEntryIds.length === 0 || currentTurnEntries.length === streamingEntryIds.length;
    const visibleEntries = turnReady
      ? orderPresentationEntries(entries, streamingEntryIds)
      : entries.filter((entry) => !streamingEntryIds.includes(entry.id));
    return buildStoryTimeline(visibleEntries, beats);
  }, [beats, entries, streamingEntryIds]);
  const activeBeat = beats.find((beat) => beat.status === "running");
  const streamingIds = useMemo(() => new Set(streamingEntryIds), [streamingEntryIds]);
  const precedingCharacters = useMemo(() => {
    let total = 0;
    const offsets = new Map<string, number>();
    for (const entry of entries) {
      if (!streamingIds.has(entry.id)) continue;
      offsets.set(entry.id, total);
      total += [...entry.text].length;
    }
    return offsets;
  }, [entries, streamingIds]);

  useEffect(() => {
    const stream = streamRef.current;
    const lastItem = timeline[timeline.length - 1];
    const latestVisibleId = recovery?.status === "failed"
      ? `recovery:${recovery.id}`
      : pendingEntry
        ? `pending:${pendingEntry.createdAt}`
        : lastItem?.id;
    if (!stream || !latestVisibleId || latestVisibleId === lastTimelineItemIdRef.current) return;

    const shouldFollow = stickToBottomRef.current || lastItem?.type === "beat" || lastItem?.entry.kind === "human" || Boolean(pendingEntry) || recovery?.status === "failed";
    lastTimelineItemIdRef.current = latestVisibleId;
    if (shouldFollow) stream.scrollTop = stream.scrollHeight;
  }, [pendingEntry, recovery, timeline]);

  function handleScroll() {
    const stream = streamRef.current;
    if (!stream) return;
    stickToBottomRef.current =
      stream.scrollHeight - stream.scrollTop - stream.clientHeight < 96;
  }

  return (
    <section
      ref={streamRef}
      className="story-stream"
      data-guide="world-stream"
      aria-label="世界时间流"
      aria-live="polite"
      onScroll={handleScroll}
    >
      {providerIssue && (
        <article className="story-provider-issue" role="alert">
          <AlertCircle size={18} />
          <div>
            <strong>{providerIssue.kind === "billing" ? "模型额度不足" : "模型连接需要处理"}</strong>
            <p>{providerIssue.userMessage}</p>
          </div>
          <Link to="/settings/models">检查模型设置</Link>
        </article>
      )}
      {activeBeat && <CurrentBeatContract beat={activeBeat} />}
      {timeline.length === 0 && !pendingEntry && recovery?.status !== "failed" ? (
        <EmptyWorld directorStatus={directorStatus} />
      ) : (
        <>
          {timeline.map((item) => item.type === "entry"
            ? <StoryMessageRow key={item.id} entry={item.entry} streaming={streamingIds.has(item.entry.id)} pacingMultiplier={pacingMultiplier} precedingCharacters={precedingCharacters.get(item.entry.id) ?? 0} />
            : <StoryBeatMarker key={item.id} beat={item.beat} sequence={item.beatNumber} />)}
          {pendingEntry && <PendingWorldEntryRow entry={pendingEntry} />}
          <WorldRecoveryCard
            recovery={recovery}
            pending={recoveryPending}
            worldRunning={worldRunning}
            onRetry={onRetryRecovery}
            onDismiss={onDismissRecovery}
          />
          {(directorStatus === "running" || directorStatus === "scheduled") && (
            <div className="story-presence" role="status">
              <LoaderCircle className="is-spinning" size={14} />
              <span>{directorStatus === "running" ? "世界正在回应……" : "故事正在酝酿下一步……"}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StreamingMarkdownText({ text, active, pacingMultiplier, precedingCharacters, className }: {
  text: string;
  active: boolean;
  pacingMultiplier: number;
  precedingCharacters: number;
  className?: string;
}) {
  const { visibleText, isPending, isTyping } = useStreamingText({ text, active, pacingMultiplier, precedingCharacters });
  return (
    <MarkdownContent
      content={visibleText}
      className={className}
      trailing={<span className={`story-stream-text${isPending ? " is-pending" : ""}`}>{isTyping && <span className="story-stream-caret" />}</span>}
    />
  );
}

function useStreamingText({ text, active, pacingMultiplier, precedingCharacters }: {
  text: string;
  active: boolean;
  pacingMultiplier: number;
  precedingCharacters: number;
}) {
  const characters = useMemo(() => [...text], [text]);
  const [visibleLength, setVisibleLength] = useState(active ? 0 : characters.length);
  const startedAtRef = useRef(performance.now());
  const streamKeyRef = useRef(`${active}:${text}:${precedingCharacters}`);

  useEffect(() => {
    const streamKey = `${active}:${text}:${precedingCharacters}`;
    if (streamKeyRef.current !== streamKey) {
      streamKeyRef.current = streamKey;
      startedAtRef.current = performance.now();
      setVisibleLength(active ? 0 : characters.length);
    }
    if (!active || pacingMultiplier <= 0) {
      setVisibleLength(characters.length);
      return;
    }
    let frame = 0;
    const tick = (now: number) => {
      const next = streamedTextLength(text, now - startedAtRef.current, pacingMultiplier, precedingCharacters);
      setVisibleLength((current) => current === next ? current : Math.max(current, next));
      if (next < characters.length) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [active, characters, pacingMultiplier, precedingCharacters, text]);

  return {
    visibleText: characters.slice(0, visibleLength).join(""),
    isPending: active && visibleLength === 0,
    isTyping: active && visibleLength < characters.length,
  };
}

function CurrentBeatContract({ beat }: { beat: WorldView["narrative"]["beats"][number] }) {
  return (
    <details className="story-current-beat">
      <summary>
        <span>当前幕剧本</span>
        <strong>{beat.title}</strong>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className="story-current-beat-body">
        <p className="story-current-beat-brief">{beat.brief}</p>
        <dl>
          <div><dt>时间</dt><dd>{beat.script.time}</dd></div>
          <div><dt>地点</dt><dd>{beat.script.location}</dd></div>
          <div><dt>起因</dt><dd>{beat.script.cause}</dd></div>
          <div><dt>转折</dt><dd>{beat.script.turningPoint}</dd></div>
          <div><dt>结果</dt><dd>{beat.script.result}</dd></div>
        </dl>
        <div className="story-current-beat-progress">
          <span>人物职责</span>
          <ol>{beat.script.cast.map((item) => <li key={`${beat.id}:${item.actorId}`}><code>{item.actorId}</code>：{item.roleInScene}</li>)}</ol>
        </div>
        <div className="story-current-beat-progress">
          <span>剧情经过</span>
          <ol>{beat.script.development.map((step, index) => <li key={`${beat.id}:development:${index}`}>{step}</li>)}</ol>
        </div>
        <div className="story-current-beat-progress">
          <span>因果链</span>
          <ol>{beat.script.causalChain.map((step, index) => <li key={`${beat.id}:causal:${index}`}>{step}</li>)}</ol>
        </div>
      </div>
    </details>
  );
}

function StoryBeatMarker({ beat, sequence }: { beat: WorldView["narrative"]["beats"][number]; sequence: number }) {
  return (
    <article className={`story-beat-marker${beat.status === "running" ? " is-current" : ""}`}>
      <span>第 {sequence} 幕</span>
      <div><strong>{beat.title}</strong><p>{beat.brief}</p></div>
      <time>{formatTime(beat.occurredAt)}</time>
    </article>
  );
}

function PendingWorldEntryRow({ entry }: { entry: PendingWorldEntry }) {
  return (
    <article className="story-dialogue is-human story-pending-entry">
      <div className="story-speaker">你</div>
      <div>
        <header><strong>你</strong><time>正在发送</time></header>
        <MarkdownContent content={entry.text} />
      </div>
    </article>
  );
}

export function NarrativeGraph({ view }: { view: WorldView }) {
  const graph = useMemo(() => buildNarrativeLayers(view.narrative), [view.narrative]);
  const [selectedBeatId, setSelectedBeatId] = useState<string>();
  const [collapsedChapterIds, setCollapsedChapterIds] = useState<Set<string>>(
    () => new Set(graph.layers
      .filter((layer) => layer.beats.length > 3)
      .map((layer) => layer.id)),
  );
  const chapterBeatCountsRef = useRef(new Map<string, number>());
  const selectedBeat = view.narrative.beats.find((beat) => beat.id === selectedBeatId);
  useEffect(() => {
    const newlyLongChapters = graph.layers.filter((layer) => {
      const previousCount = chapterBeatCountsRef.current.get(layer.id) ?? 0;
      chapterBeatCountsRef.current.set(layer.id, layer.beats.length);
      return previousCount <= 3 && layer.beats.length > 3;
    });
    if (newlyLongChapters.length === 0) return;
    setCollapsedChapterIds((current) => {
      const next = new Set(current);
      for (const layer of newlyLongChapters) next.add(layer.id);
      return next;
    });
  }, [graph.layers]);
  const toggleChapter = (chapterId: string) => {
    setCollapsedChapterIds((current) => {
      const next = new Set(current);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };
  if (view.narrative.beats.length === 0) {
    const chapter = view.narrative.chapters.find(
      (candidate) => candidate.id === view.narrative.foregroundChapterId,
    ) ?? view.narrative.chapters.find((candidate) => candidate.status === "active");
    return (
      <div className="narrative-empty">
        <span />
        <p>{chapter?.targetOutcome ?? "世界发生真正变化后，剧情节点会在这里留下来。"}</p>
      </div>
    );
  }
  return (
    <div className="narrative-map">
      {graph.layers.map((layer, layerIndex) => (
        <section
          className={`narrative-layer is-${layer.status}${layer.id === view.narrative.foregroundChapterId ? " is-foreground" : ""}`}
          key={layer.id}
        >
          <button
            className={`narrative-parent-node ${collapsedChapterIds.has(layer.id) ? "is-collapsed" : "is-expanded"}`}
            type="button"
            aria-expanded={!collapsedChapterIds.has(layer.id)}
            aria-controls={!collapsedChapterIds.has(layer.id) ? `narrative-chapter-${layerIndex}` : undefined}
            onClick={() => toggleChapter(layer.id)}
          >
            <span className="narrative-parent-marker">{layerIndex + 1}</span>
            <div>
              <div className="narrative-parent-meta">
                <small>{chapterStatusLabel(layer.status)}</small>
                {layer.id === view.narrative.foregroundChapterId && <b>当前剧情</b>}
                <span>{layer.beats.length} 个节点</span>
              </div>
              <strong>{layer.title}</strong>
              <p>{layer.targetOutcome}</p>
            </div>
            {collapsedChapterIds.has(layer.id) ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>

          {!collapsedChapterIds.has(layer.id) && layer.beats.length > 0 ? (
            <ol className="narrative-child-list" id={`narrative-chapter-${layerIndex}`}>
              {layer.beats.map(({ beat, incomingEdges, sequence }) => {
                const active = beat.id === graph.activeBeatId;
                return (
                  <button
                    className={`narrative-child-node ${active ? "is-active" : ""} ${beat.id === selectedBeatId ? "is-selected" : ""}`}
                    key={beat.id}
                    type="button"
                    aria-pressed={beat.id === selectedBeatId}
                    onClick={() => setSelectedBeatId(beat.id)}
                  >
                    <span className="narrative-child-marker" aria-hidden="true" />
                    <div>
                      <div className="narrative-child-meta">
                        <span>节点 {sequence}</span>
                        {incomingEdges.map((edge) => (
                          <span className="narrative-edge-label" key={edge.id}>{edgeTypeLabel(edge.type)}</span>
                        ))}
                      </div>
                      <strong>{beat.title}</strong>
                      <p>{beat.outcome ?? beat.brief}</p>
                    </div>
                  </button>
                );
              })}
            </ol>
          ) : !collapsedChapterIds.has(layer.id) ? (
            <p className="narrative-layer-empty">这一章还没有落下具体节点。</p>
          ) : null}
        </section>
      ))}
      {selectedBeat && (
        <div className="narrative-selected" role="status">
          <div>
            <small>已选中的剧情节点</small>
            <strong>{selectedBeat.title}</strong>
            <p>{selectedBeat.outcome ?? selectedBeat.brief}</p>
          </div>
          <span>{selectedBeat.sourceEventIds.length} 个世界事件 · {formatTime(selectedBeat.occurredAt)}</span>
        </div>
      )}
    </div>
  );
}

type NarrativeLayerStatus = WorldView["narrative"]["chapters"][number]["status"];
type NarrativeLayer = {
  id: string;
  title: string;
  targetOutcome: string;
  status: NarrativeLayerStatus;
  beats: Array<{
    beat: WorldView["narrative"]["beats"][number];
    incomingEdges: WorldView["narrative"]["edges"];
    sequence: number;
  }>;
};
type WorldNarrative = WorldView["narrative"];

function buildNarrativeLayers(narrative: WorldNarrative): {
  layers: NarrativeLayer[];
  activeBeatId?: string;
} {
  const beats = [...narrative.beats].sort((left, right) => left.occurredAt - right.occurredAt);
  const beatById = new Map(beats.map((beat) => [beat.id, beat]));
  const beatSequence = new Map(beats.map((beat, index) => [beat.id, index + 1]));
  const incomingByBeat = new Map<string, WorldView["narrative"]["edges"]>();

  for (const edge of narrative.edges) {
    const incoming = incomingByBeat.get(edge.toBeatId) ?? [];
    incoming.push(edge);
    incomingByBeat.set(edge.toBeatId, incoming);
  }

  const layers = narrative.chapters.map<NarrativeLayer>((chapter) => {
    const chapterBeats = chapter.beatIds.flatMap((beatId) => {
      const beat = beatById.get(beatId);
      if (!beat) return [];
      return [{
        beat,
        incomingEdges: incomingByBeat.get(beat.id) ?? [],
        sequence: beatSequence.get(beat.id) ?? 0,
      }];
    });
    return {
      id: chapter.id,
      title: chapter.title,
      targetOutcome: chapter.targetOutcome,
      status: chapter.status,
      beats: chapterBeats,
    };
  });

  return {
    layers,
    activeBeatId: beats.at(-1)?.id,
  };
}

function chapterStatusLabel(status: NarrativeLayerStatus): string {
  if (status === "active") return "进行中";
  if (status === "queued") return "待开始";
  if (status === "abandoned") return "已放弃";
  return "已收束";
}

function edgeTypeLabel(type: WorldView["narrative"]["edges"][number]["type"]): string {
  const labels = {
    causes: "因果",
    enables: "解锁",
    contradicts: "冲突",
    escalates: "升级",
    resolves: "收束",
    returns_to: "回响",
  } satisfies Record<WorldView["narrative"]["edges"][number]["type"], string>;
  return labels[type];
}

function EmptyWorld({ directorStatus }: { directorStatus: WorldView["director"]["status"] }) {
  return (
    <div className="world-empty-state">
      <LoaderCircle className={directorStatus === "running" || directorStatus === "scheduled" ? "is-spinning" : ""} size={21} />
       <strong>{directorStatus === "running" ? "世界正在观察此刻" : "世界正在等待第一幕"}</strong>
      <span>开场旁白和角色回应会由服务端事件流送到这里。</span>
    </div>
  );
}


export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}
