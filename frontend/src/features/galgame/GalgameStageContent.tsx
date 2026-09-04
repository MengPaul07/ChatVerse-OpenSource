import { ChevronRight, LoaderCircle, Play } from "lucide-react";
import type { PlayerPerformanceOption, PlayerTurnProposal } from "@chatverse/core";
import MarkdownContent from "../../components/MarkdownContent";
import type { WorldView, WorldViewEntry } from "../../world/types";

type StageActor = WorldView["actors"][number];
type PresentationSegment = ReturnType<typeof import("../../world/presentation").buildPresentationSegments>[number];

export interface GalgameStageContentProps {
  view: WorldView;
  activeActor?: StageActor;
  presentationTurn?: WorldView["contexts"][number]["presentationTurn"];
  portraitUrl?: string;
  stageBetweenTurns: boolean;
  interludeCopy: { eyebrow: string; title: string; detail: string };
  canRequestNextBeat: boolean;
  playerTurnVisible: boolean;
  playerProposal?: PlayerTurnProposal;
  freeInput: string;
  playbackReady: boolean;
  bufferedTurnCount: number;
  dialogueEntry?: WorldViewEntry;
  presentationSegments: PresentationSegment[];
  displayedText: string;
  textComplete: boolean;
  onRequestNextBeat: () => void | Promise<void>;
  onFreeInputChange: (value: string) => void;
  onSubmitOption: (option: PlayerPerformanceOption) => void;
  onSkipPlayerTurn: () => void;
  onSubmitFreeInput: () => void;
}

export default function GalgameStageContent({
  view,
  activeActor,
  presentationTurn,
  portraitUrl,
  stageBetweenTurns,
  interludeCopy,
  canRequestNextBeat,
  playerTurnVisible,
  playerProposal,
  freeInput,
  playbackReady,
  bufferedTurnCount,
  dialogueEntry,
  presentationSegments,
  displayedText,
  textComplete,
  onRequestNextBeat,
  onFreeInputChange,
  onSubmitOption,
  onSkipPlayerTurn,
  onSubmitFreeInput,
}: GalgameStageContentProps) {
  return (
    <>
      {activeActor && (
        <section className="galgame-cast" aria-label={`当前说话者：${activeActor.name}`}>
          <div className={`galgame-portrait is-speaking ${activeActor.playerControlled ? "is-player" : ""}`} key={activeActor.id}>
            {portraitUrl
              ? <img src={portraitUrl} alt={activeActor.name} />
              : <div className="galgame-portrait-placeholder"><span>{activeActor.name.slice(0, 1)}</span></div>}
          </div>
        </section>
      )}

      {stageBetweenTurns ? (
        <section className="galgame-interlude" aria-live="polite">
          <span>{interludeCopy.eyebrow}</span>
          <div className="galgame-interlude-rule" aria-hidden="true"><i /></div>
          <h1>{interludeCopy.title}</h1>
          <p>{interludeCopy.detail}</p>
          {canRequestNextBeat ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); void onRequestNextBeat(); }}>
              <Play size={15} />继续下一幕
            </button>
          ) : view.world.status === "running" ? (
            <small><LoaderCircle size={14} />请稍候，完成后会自动进入开场</small>
          ) : null}
        </section>
      ) : playerTurnVisible ? (
        <section className="galgame-player-turn" onClick={(event) => event.stopPropagation()}>
          <div className="galgame-options">
            {(playerProposal?.suggestions ?? []).map((option, index) => (
              <button key={`${option.label}-${index}`} onClick={() => onSubmitOption(option)}>
                <span>{index + 1}</span><strong>{option.label}</strong><ChevronRight size={17} />
              </button>
            ))}
            <button className="is-skip" onClick={onSkipPlayerTurn}>
              <span>—</span><strong>跳过这次回应</strong><ChevronRight size={17} />
            </button>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); onSubmitFreeInput(); }}>
            <input value={freeInput} onChange={(event) => onFreeInputChange(event.target.value)} placeholder="按自己的方式回应..." />
            <button type="submit">回应</button>
          </form>
        </section>
      ) : (
        <section
          className={`galgame-dialogue ${dialogueEntry?.kind === "narration" ? "is-narration" : ""} ${textComplete ? "is-complete" : "is-typing"}`}
          aria-live="polite"
          aria-label="演出对白"
        >
          {dialogueEntry && <header>{dialogueEntry.kind === "narration" ? "旁白" : dialogueEntry.actorName ?? "世界"}</header>}
          {presentationSegments.map((segment, index) => {
            const visibleText = displayedText.slice(segment.start, segment.end);
            const isLast = index === presentationSegments.length - 1;
            return (
              <MarkdownContent
                className={segment.entry.kind === "action" ? "galgame-line galgame-action" : "galgame-line"}
                content={visibleText}
                key={segment.entry.id}
                trailing={isLast && !textComplete ? <i className="is-visible" /> : undefined}
              />
            );
          })}
          <footer>
            {playbackReady
              ? !textComplete
                ? "按空格显示全文"
                : bufferedTurnCount > 0 ? `点击继续 · 后台已准备 ${bufferedTurnCount} 段` : "点击舞台继续"
              : view.world.status !== "running"
                ? "后台已暂停"
                : presentationTurn?.status === "waiting_player"
                  ? "等待你的选择"
                  : "下一段生成中…"}
          </footer>
        </section>
      )}
    </>
  );
}
