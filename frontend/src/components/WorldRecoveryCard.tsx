import { AlertCircle, RefreshCw, Settings2, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { WorldForegroundRecoveryState } from "../world/types";

interface WorldRecoveryCardProps {
  recovery?: WorldForegroundRecoveryState;
  variant?: "world" | "stage";
  pending?: boolean;
  worldRunning?: boolean;
  onRetry: (failureId: string) => void;
  onDismiss: (failureId: string) => void;
}

const OPERATION_LABELS: Record<WorldForegroundRecoveryState["operation"], string> = {
  director: "规划下一幕",
  narrator: "衔接当前场景",
  actor: "生成角色回应",
  player: "准备玩家选项",
};

export default function WorldRecoveryCard({
  recovery,
  variant = "world",
  pending = false,
  worldRunning = true,
  onRetry,
  onDismiss,
}: WorldRecoveryCardProps) {
  const failure = recovery?.status === "failed" ? recovery.failure : undefined;
  if (!recovery || !failure) return null;

  return (
    <article
      className={`world-recovery-card is-${variant}`}
      role="alert"
      aria-label="世界运行需要处理"
      onClick={variant === "stage" ? (event) => event.stopPropagation() : undefined}
    >
      <span className="world-recovery-mark" aria-hidden="true"><AlertCircle size={18} /></span>
      <div className="world-recovery-copy">
        <small>{OPERATION_LABELS[recovery.operation]}未完成</small>
        <strong>世界在这里停住了</strong>
        <p>{failure.userMessage || failure.message || "本次生成没有完成，可以重新尝试。"}</p>
      </div>
      <div className="world-recovery-actions">
        {failure.retryable ? (
          <button
            className="world-recovery-primary"
            type="button"
            disabled={pending || !worldRunning}
            onClick={() => onRetry(failure.id)}
          >
            <RefreshCw className={pending ? "is-spinning" : undefined} size={15} />
            {pending ? "正在重试" : worldRunning ? "重试这一步" : "继续世界后重试"}
          </button>
        ) : (
          <Link className="world-recovery-primary" to="/settings/models">
            <Settings2 size={15} />检查模型设置
          </Link>
        )}
        <button
          className="world-recovery-dismiss"
          type="button"
          disabled={pending}
          onClick={() => onDismiss(failure.id)}
          title="关闭提示"
          aria-label="关闭恢复提示"
        >
          <X size={16} />
        </button>
      </div>
    </article>
  );
}
