export function buildPortraitPrompt(input: {
  artDirection?: string;
  actorName: string;
  appearance?: string;
  refinement?: string;
}): string {
  return [
    input.artDirection || "统一、克制的视觉小说美术风格",
    `角色：${input.actorName}`,
    input.appearance || "根据角色身份与当前世界设计可信外观",
    "视觉小说固定角色立绘，单人全身，正面或轻微侧身站姿，人物完整且四周留白。",
    "背景为纯净浅色或透明友好底色，不要场景、投影、地面、边框、文字或 UI；主体轮廓清晰，便于抠图并跨场景复用。",
    input.refinement?.trim(),
  ].filter(Boolean).join("\n");
}

export function buildBeatBackgroundPrompt(input: {
  artDirection?: string;
  worldName: string;
  beatBrief?: string;
  sceneNow?: string;
  refinement?: string;
}): string {
  return [
    input.artDirection || "统一、克制的视觉小说背景美术风格",
    `世界：${input.worldName}`,
    input.beatBrief ? `本幕：${input.beatBrief}` : undefined,
    input.sceneNow ? `当前局面：${input.sceneNow}` : undefined,
    "视觉小说横向场景背景，构图稳定，保留前景角色站位空间。不要主要人物、对白框、文字、标志或 UI。",
    input.refinement?.trim(),
  ].filter(Boolean).join("\n");
}
