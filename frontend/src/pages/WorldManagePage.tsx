import { useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  GitBranch,
  ImagePlus,
  LayoutDashboard,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Settings2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useWorldRoomContext } from "../world/WorldRoomContext";
import type { WorldView } from "../world/types";
import RuntimeVisualAssetsDialog from "../components/RuntimeVisualAssetsDialog";
import { WorldManageContent, WorldManageState, WorldStatusActions, type ManageSection } from "../world/world-manage-panels";


const manageNavigation: Array<{ id: ManageSection; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "contexts", label: "聊天空间", icon: MessageCircle },
  { id: "actors", label: "角色", icon: Users },
  { id: "story", label: "剧情", icon: GitBranch },
  { id: "runtime", label: "运行策略", icon: Settings2 },
];

const pageCopy: Record<ManageSection, { title: string; detail: string }> = {
  overview: {
    title: "世界总览",
    detail: "从一个页面看见这段世界正在发生什么，并快速进入最常用的控制。",
  },
  contexts: {
    title: "聊天空间",
    detail: "世界现场、群聊和私聊共享世界记忆，但各自保留独立的对话现场。",
  },
  actors: {
    title: "角色与参与",
    detail: "调整角色是否在线、是否参与当前空间，以及导演可以介入到什么程度。",
  },
  story: {
    title: "剧情脉络",
    detail: "只查看已经发生的剧情节点和章节，不提前锁定未来。",
  },
  runtime: {
    title: "运行策略",
    detail: "控制这次世界实例如何启动、暂停和继续推进。",
  },
};

export default function WorldManagePage() {
  const { worldId = "", section: sectionParam } = useParams();
  const [searchParams] = useSearchParams();
  const requestedContextId = searchParams.get("context") || undefined;
  const section = isManageSection(sectionParam) ? sectionParam : "overview";
  const room = useWorldRoomContext();
  const query = searchParams.toString();
  const chatPath = `/worlds/${encodeURIComponent(worldId)}${query ? `?${query}` : ""}`;
  const contextChatPath = (contextId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("context", contextId);
    const nextQuery = next.toString();
    return `/worlds/${encodeURIComponent(worldId)}${nextQuery ? `?${nextQuery}` : ""}`;
  };
  const [notice, setNotice] = useState<string>();
  const [visualAssetsOpen, setVisualAssetsOpen] = useState(false);
  const view = room.state.view;

  if (room.state.phase === "loading") {
    return <WorldManageState icon={<LoaderCircle className="is-spinning" size={24} />} title="正在打开管理台" detail="读取这个世界的当前运行状态。" />;
  }

  if (room.state.phase === "error" || !view) {
    return (
      <WorldManageState
        icon={<CircleAlert size={24} />}
        title="世界暂时不可用"
        detail={room.state.error ?? "没有读到这个世界的运行状态。"}
        action={<button className="button button-primary" onClick={() => void room.retry()}><RefreshCw size={15} />重试</button>}
      />
    );
  }

  const activeContextId = view.contexts.find((candidate) => candidate.id === requestedContextId)?.id
    ?? view.contexts[0]?.id;
  const context = view.contexts.find((candidate) => candidate.id === activeContextId) ?? view.contexts[0];
  const isBusy = Boolean(room.pendingAction);

  async function runChange(change: () => Promise<boolean> | Promise<void>, success: string) {
    const result = await change();
    if (result !== false) setNotice(success);
  }

  return (
    <div className="world-management-page page-enter">
        <header className="world-management-header">
          <div className="world-management-leading">
            <Link className="world-back-link" to={chatPath}>
              <ArrowLeft size={16} />
              <span>回到世界</span>
            </Link>
            <div className="world-management-title">
              <p className="eyebrow">世界管理</p>
              <h1>{pageCopy[section].title}</h1>
            </div>
          </div>
          <div className="world-management-actions">
            <span className={`runtime-status runtime-${view.world.status}`}>{worldStatusLabel(view.world.status)}</span>
            {context && <button className="button button-quiet world-management-visual-button" type="button" onClick={() => setVisualAssetsOpen(true)}><ImagePlus size={15} /><span>视觉素材</span></button>}
            <Link className="button button-quiet" to={chatPath}><MessageCircle size={15} />进入世界</Link>
          </div>
        </header>

        <main className={`world-management-main is-${section}`}>
          <section className="world-management-intro">
            <div>
              <p className="eyebrow">{view.world.name}</p>
              <h2>{pageCopy[section].title}</h2>
              <p>{pageCopy[section].detail}</p>
            </div>
            {(section === "overview" || section === "runtime") && (
              <WorldStatusActions view={view} room={room} disabled={isBusy} runChange={runChange} />
            )}
          </section>

          {notice && <p className="notice notice-success world-management-notice" role="status"><Check size={15} />{notice}</p>}
          {room.state.error && <p className="notice notice-danger world-management-notice" role="alert"><CircleAlert size={15} />{room.state.error}</p>}

          <WorldManageContent
            section={section}
            view={view}
            context={context}
            activeContextId={activeContextId}
            contextChatPath={contextChatPath}
            chatPath={chatPath}
            room={room}
            isBusy={isBusy}
            runChange={runChange}
          />
        </main>
        {visualAssetsOpen && context && <RuntimeVisualAssetsDialog view={view} context={context} onClose={() => setVisualAssetsOpen(false)} />}
    </div>
  );
}

function isManageSection(value: string | undefined): value is ManageSection {
  return manageNavigation.some((item) => item.id === value);
}

function worldStatusLabel(status: WorldView["world"]["status"]): string {
  return { idle: "等待开始", running: "正在运行", paused: "已暂停", stopped: "已停止" }[status];
}
