import { ArrowLeft, ArrowRight, Check, CircleHelp, Route, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

export type GuidedTourStep = {
  target: string;
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function GuidedTour({
  label,
  steps,
  open,
  onOpenChange,
  onComplete,
  onDismiss,
}: {
  label: string;
  steps: GuidedTourStep[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  onDismiss: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const titleId = useId();
  const step = steps[stepIndex];

  useEffect(() => {
    if (!open) {
      document.querySelectorAll(".onboarding-target-active").forEach((element) => element.classList.remove("onboarding-target-active"));
      return;
    }
    setStepIndex((current) => Math.min(current, Math.max(0, steps.length - 1)));
  }, [open, steps.length]);

  useEffect(() => {
    if (!open || !step) return;
    const element = document.querySelector<HTMLElement>(step.target);
    if (!element) return;
    element.classList.add("onboarding-target-active");
    element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    return () => element.classList.remove("onboarding-target-active");
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      onDismiss();
      onOpenChange(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss, onOpenChange, open]);

  if (!open || !step) return null;
  const isLast = stepIndex === steps.length - 1;

  function finish() {
    onComplete();
    onOpenChange(false);
    setStepIndex(0);
  }

  function runAction() {
    finish();
    step.onAction?.();
  }

  return (
    <aside className="onboarding-guide" role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <header className="onboarding-guide-head">
        <span className="onboarding-guide-mark"><Route size={16} /></span>
        <div><small>{label}</small><strong>{String(stepIndex + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</strong></div>
        <button type="button" className="onboarding-guide-close" aria-label="跳过引导" onClick={() => { onDismiss(); onOpenChange(false); }}><X size={16} /></button>
      </header>
      <div className="onboarding-guide-route" aria-hidden="true">
        {steps.map((_, index) => <i key={index} className={index < stepIndex ? "is-done" : index === stepIndex ? "is-active" : undefined} />)}
      </div>
      <div className="onboarding-guide-copy">
        <p>{step.eyebrow}</p>
        <h2 id={titleId}>{step.title}</h2>
        <span>{step.description}</span>
      </div>
      <footer className="onboarding-guide-actions">
        <button type="button" className="onboarding-guide-back" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={14} />上一步</button>
        {step.actionLabel ? (
          <button type="button" className="onboarding-guide-next is-primary" onClick={runAction}>{step.actionLabel}<ArrowRight size={14} /></button>
        ) : isLast ? (
          <button type="button" className="onboarding-guide-next is-primary" onClick={finish}><Check size={14} />完成</button>
        ) : (
          <button type="button" className="onboarding-guide-next" onClick={() => setStepIndex((current) => Math.min(steps.length - 1, current + 1))}>下一步<ArrowRight size={14} /></button>
        )}
      </footer>
    </aside>
  );
}

export function GuideLauncher({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="button button-quiet onboarding-launcher" type="button" onClick={onClick}><CircleHelp size={15} />{label}</button>;
}
