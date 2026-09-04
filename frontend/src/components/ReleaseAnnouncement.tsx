import { Megaphone, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

export interface ReleaseAnnouncementSection {
  title: string;
  items: string[];
}

export interface ReleaseAnnouncementContent {
  id: string;
  version: string;
  eyebrow: string;
  title: string;
  summary: string;
  sections: ReleaseAnnouncementSection[];
  note: string;
}

export const CURRENT_RELEASE_ANNOUNCEMENT: ReleaseAnnouncementContent = {
  id: "2026-09-01-preview-notice",
  version: "Preview · 2026.09",
  eyebrow: "ChatVerse · 预览版公告",
  title: "欢迎进入 ChatVerse 预览版",
  summary: "这是一个仍在持续迭代的预览版本。世界创建、角色对话、演出模式和视觉素材正在快速完善，部分功能可能出现卡顿、重复内容、空白状态或显示异常。",
  sections: [
    {
      title: "使用前请留意",
      items: [
        "预览版不代表所有运行结果都稳定，遇到异常时可以先点击重试、刷新页面或重新进入世界。",
        "如果问题持续出现，请记录世界名称、发生步骤和 Debug 日志，再反馈给我们。",
      ],
    },
    {
      title: "更丰富的世界入口",
      items: [
        "新增海棠诗社、校园祭、档案室和索尔维大会等不同气质的示例世界。",
        "五行山与赤壁场景继续保留，适合从经典叙事直接开始体验。",
      ],
    },
    {
      title: "视觉舞台就绪",
      items: [
        "示例世界补齐了对应的场景背景和角色立绘，进入演出即可使用。",
        "本机上传或生成的视觉素材会优先复用，不会因重复进入世界反复消耗额度。",
      ],
    },
    {
      title: "运行体验更连贯",
      items: [
        "普通世界和演出视图共享同一条剧情进度，切换视图不会另起一个世界。",
        "消息、动作和旁白按真实发生顺序呈现，世界运行时也能随时回到当前现场。",
      ],
    },
  ],
  note: "确认后会记住已读状态，下一次版本更新会再次提醒。感谢你参与预览。",
};

const RELEASE_ANNOUNCEMENT_STORAGE_KEY = "chatverse:release-announcement:seen";

export function hasSeenReleaseAnnouncement(
  storage: Pick<Storage, "getItem"> | undefined = typeof window === "undefined" ? undefined : window.localStorage,
): boolean {
  try {
    return storage?.getItem(RELEASE_ANNOUNCEMENT_STORAGE_KEY) === CURRENT_RELEASE_ANNOUNCEMENT.id;
  } catch {
    return false;
  }
}

export function markReleaseAnnouncementSeen(
  storage: Pick<Storage, "setItem"> | undefined = typeof window === "undefined" ? undefined : window.localStorage,
): void {
  try {
    storage?.setItem(RELEASE_ANNOUNCEMENT_STORAGE_KEY, CURRENT_RELEASE_ANNOUNCEMENT.id);
  } catch {
    // Private browsing or a disabled storage backend should not block the app.
  }
}

export default function ReleaseAnnouncement() {
  const [open, setOpen] = useState(() => !hasSeenReleaseAnnouncement());

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!open) return null;

  const dismiss = () => {
    markReleaseAnnouncementSeen();
    setOpen(false);
  };

  return createPortal(
    <div className="release-announcement-backdrop">
      <section
        className="release-announcement"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-announcement-title"
        aria-describedby="release-announcement-summary"
      >
        <header className="release-announcement-header">
          <div className="release-announcement-mark" aria-hidden="true"><Megaphone size={18} /></div>
          <div className="release-announcement-meta">
            <span>{CURRENT_RELEASE_ANNOUNCEMENT.eyebrow}</span>
            <b>{CURRENT_RELEASE_ANNOUNCEMENT.version}</b>
          </div>
          <button className="release-announcement-close" type="button" onClick={dismiss} aria-label="关闭公告" title="关闭公告">
            <X size={18} />
          </button>
        </header>

        <div className="release-announcement-body">
          <p className="eyebrow">{CURRENT_RELEASE_ANNOUNCEMENT.eyebrow}</p>
          <h2 id="release-announcement-title">{CURRENT_RELEASE_ANNOUNCEMENT.title}</h2>
          <p className="release-announcement-summary" id="release-announcement-summary">{CURRENT_RELEASE_ANNOUNCEMENT.summary}</p>
          <div className="release-announcement-sections">
            {CURRENT_RELEASE_ANNOUNCEMENT.sections.map((section) => (
              <section key={section.title}>
                <h3>{section.title}</h3>
                <ul>
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <footer className="release-announcement-footer">
          <span>{CURRENT_RELEASE_ANNOUNCEMENT.note}</span>
          <button className="button button-primary" type="button" onClick={dismiss}>知道了</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
