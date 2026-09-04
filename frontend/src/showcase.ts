export type ShowcaseStepKind = "input" | "director" | "narration" | "actor" | "memory" | "commit";

export interface ShowcaseStep {
  id: string;
  phase: string;
  kind: ShowcaseStepKind;
  title: string;
  actor?: string;
  text: string;
  meta: string;
  accent: string;
}

export const SHOWCASE_PRESET = {
  id: "night-archive",
  name: "夜班档案室",
  description: "用一条异常档案，演示 ChatVerse 如何把世界事实交给剧情推进和角色自主反应。",
  note: "原创静态预设 · 不连接实时模型",
  scene: "凌晨 01:17 · 城北档案室",
  steps: [
    {
      id: "input",
      phase: "01 · 事实进入",
      kind: "input",
      title: "收到一条外部事件",
      actor: "观察者",
      text: "有人把一张没有寄件人的档案放在前台。封面日期，是明天。",
      meta: "player.event · context: archive-room",
      accent: "signal",
    },
    {
      id: "director",
      phase: "02 · 宏观编排",
      kind: "director",
      title: "Director 读取世界状态",
      actor: "世界编排器",
      text: "确认门禁异常与当前剧情章节相关，唤醒正在值班的角色。只分配注意力，不替角色写台词。",
      meta: "wake → 2 actors · no forced dialogue",
      accent: "amber",
    },
    {
      id: "narration",
      phase: "03 · 事实落地",
      kind: "narration",
      title: "旁白提交可观察变化",
      actor: "旁白",
      text: "门禁灯在 01:17 短暂熄灭。档案室里没有人走动，前台却多了一层尚未干透的雨水。",
      meta: "narrative.narration.committed",
      accent: "violet",
    },
    {
      id: "actor-lin",
      phase: "04 · 角色自主反应",
      kind: "actor",
      title: "角色从自己的认知出发",
      actor: "林岑 · 夜班整理员",
      text: "这不是今天的归档。先别碰封面，我去调门禁记录。",
      meta: "actor.message · focus: Lin Cen",
      accent: "blue",
    },
    {
      id: "actor-zhou",
      phase: "04 · 角色自主反应",
      kind: "actor",
      title: "另一名角色补充现场信息",
      actor: "周遥 · 设备管理员",
      text: "门禁没有开过。林岑，你看档案右下角，那里的编号像是被人改过。",
      meta: "actor.message · focus: Zhou Yao",
      accent: "blue",
    },
    {
      id: "memory",
      phase: "05 · 连续性整理",
      kind: "memory",
      title: "把关键变化并入当前剧情",
      actor: "Context Continuity",
      text: "将“无寄件人档案”“门禁异常”“编号被改动”整理为当前场景事实，供下一次剧情推进继续使用。",
      meta: "context update · 3 facts",
      accent: "green",
    },
    {
      id: "commit",
      phase: "06 · 形成下一步",
      kind: "commit",
      title: "剧情节点可被继续追踪",
      actor: "事件流",
      text: "异常档案已成为当前剧情章节的新节点。下一次推进会读取这个节点，而不是重新解释整段历史。",
      meta: "beat#04 → chapter: tomorrow-file",
      accent: "signal",
    },
  ] satisfies ShowcaseStep[],
} as const;
