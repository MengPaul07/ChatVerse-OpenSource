import { useState } from "react";
import { Bot, Clock3, Gauge, PauseCircle } from "lucide-react";
import {
  readRuntimePreferences,
  saveRuntimePreferences,
  syncRoomRuntimePreferences,
} from "../runtimePreferences";
import { listWorldArchives } from "../worldArchiveLibrary";
import { usePlayerAutoPerformance } from "../playerAutomation";

const MINUTE_OPTIONS = [2, 5, 10, 30, 60] as const;

export default function RuntimeSettingsPage() {
  const [preferences, setPreferences] = useState(readRuntimePreferences);
  const [autoPlayer, setAutoPlayer] = usePlayerAutoPerformance();
  const [saved, setSaved] = useState(false);

  function commit(next: typeof preferences) {
    const normalized = saveRuntimePreferences(next);
    setPreferences(normalized);
    setSaved(true);
    void listWorldArchives()
      .then((records) => Promise.all(
        records.flatMap((record) => record.lastRoomId
          ? [syncRoomRuntimePreferences(record.lastRoomId, normalized).catch(() => undefined)]
          : []),
      ))
      .catch(() => undefined);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="workspace-page runtime-settings-page page-enter">
      <header className="page-header">
        <div><p className="eyebrow">应用设置</p><h1>运行与节省</h1><p>世界离开视线后及时休息，避免后台继续调用模型。</p></div>
      </header>

      <section className="runtime-preference-panel">
        <div className="runtime-preference-heading">
          <span><PauseCircle size={20} /></span>
          <div><h2>无人查看时自动暂停</h2><p>从最后一个世界页面断开后开始计时，返回页面不会自动恢复。</p></div>
          <label className="runtime-preference-switch">
            <input
              type="checkbox"
              checked={preferences.autoPauseEnabled}
              onChange={(event) => commit({ ...preferences, autoPauseEnabled: event.target.checked })}
            />
            <span />
          </label>
        </div>

        <div className={`runtime-preference-control${preferences.autoPauseEnabled ? "" : " is-disabled"}`}>
          <label htmlFor="auto-pause-minutes"><Clock3 size={17} /><span><strong>等待时间</strong><small>短暂切页不会打断世界生成</small></span></label>
          <select
            id="auto-pause-minutes"
            disabled={!preferences.autoPauseEnabled}
            value={preferences.autoPauseAfterMinutes}
            onChange={(event) => commit({ ...preferences, autoPauseAfterMinutes: Number(event.target.value) })}
          >
            {MINUTE_OPTIONS.map((minutes) => <option value={minutes} key={minutes}>{minutes} 分钟</option>)}
          </select>
        </div>

        <div className="runtime-preference-note">
          <Gauge size={17} />
          <p>设置会同步到当前浏览器创建或打开的世界。私聊采用问答模式，不会在后台主动运行。</p>
        </div>

        <div className="runtime-preference-heading runtime-player-preference">
          <span><Bot size={20} /></span>
          <div><h2>玩家自动代演</h2><p>世界或演出模式轮到玩家时，自动提交当前提案，不会替其他角色发言。</p></div>
          <label className="runtime-preference-switch">
            <input type="checkbox" checked={autoPlayer} onChange={(event) => setAutoPlayer(event.target.checked)} />
            <span />
          </label>
        </div>
      </section>
      {saved && <div className="notice notice-success" role="status">运行策略已保存，并正在同步到现有世界。</div>}
    </div>
  );
}
