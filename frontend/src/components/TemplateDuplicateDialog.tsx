import { CopyPlus, Play, X } from "lucide-react";
import type { WorldTemplatePack } from "../worldTemplateCatalog";

export interface TemplateDuplicateRequest {
  template: WorldTemplatePack;
  intent: "start" | "edit";
  existingCount: number;
}

export default function TemplateDuplicateDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request?: TemplateDuplicateRequest;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!request) return null;
  const action = request.intent === "start" ? "准备新世界" : "创建新草稿";
  return (
    <div className="template-duplicate-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="template-duplicate-dialog" role="dialog" aria-modal="true" aria-labelledby="template-duplicate-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span><CopyPlus size={18} /></span>
          <button type="button" onClick={onCancel} aria-label="关闭"><X size={18} /></button>
        </header>
        <div>
          <p className="eyebrow">重复模板</p>
          <h2 id="template-duplicate-title">再创建一个“{request.template.title}”？</h2>
          <p>本机已有 {request.existingCount} 份来自这个模板的世界或草稿。新建不会覆盖原有内容，故事进度、角色状态和素材都会彼此独立。</p>
        </div>
        <footer>
          <button className="button button-quiet" type="button" onClick={onCancel}>先不创建</button>
          <button className="button button-primary" type="button" onClick={onConfirm}>
            {request.intent === "start" ? <Play size={16} /> : <CopyPlus size={16} />}{action}
          </button>
        </footer>
      </section>
    </div>
  );
}
