/**
 * 粗略 token 估算。中英文混合场景下 1 token ≈ 3 字符。
 * 不绑定任何 provider tokenizer，后续可替换为精确实现。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}
