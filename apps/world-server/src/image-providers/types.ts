export type ImageProviderProtocol =
  | "openai"
  | "gemini"
  | "stability"
  | "bfl"
  | "dashscope"
  | "ark"
  | "siliconflow"
  | "openrouter";

export interface ImageProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  protocol: ImageProviderProtocol;
}

export interface ImageGenerationInput {
  prompt: string;
  size: string;
  referenceImage?: {
    bytes: Buffer;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  };
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  model: string;
  revisedPrompt?: string;
}

export interface ImageProviderTestResult {
  verification: "credentials" | "endpoint";
}

export interface ImageProviderAdapter {
  generate(config: ImageProviderConfig, input: ImageGenerationInput): Promise<GeneratedImage>;
  edit?(config: ImageProviderConfig, input: ImageGenerationInput): Promise<GeneratedImage>;
  test(config: ImageProviderConfig): Promise<ImageProviderTestResult>;
}

export class ImageProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ImageProviderError";
  }
}
