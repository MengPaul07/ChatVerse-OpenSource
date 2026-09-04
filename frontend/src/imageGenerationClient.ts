import { imageProviderHeaders, type ImageProviderSettings } from "./imageProviderSettings";

export interface GeneratedImagePayload {
  blob: Blob;
  mimeType: string;
  model?: string;
  revisedPrompt?: string;
}

export interface ImageGenerationOptions {
  referenceImage?: Blob;
}

const requests = new Map<string, Promise<GeneratedImagePayload>>();

export function generateImageOnce(
  key: string,
  settings: ImageProviderSettings,
  prompt: string,
  size: string,
  options: ImageGenerationOptions = {},
): Promise<GeneratedImagePayload> {
  const existing = requests.get(key);
  if (existing) return existing;

  const request = (async () => {
    const reference = options.referenceImage
      ? await blobToBase64(options.referenceImage)
      : undefined;
    const response = await fetch("/api/v1/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...imageProviderHeaders(settings) },
      body: JSON.stringify({
        prompt,
        size,
        ...(reference ? {
          referenceImageBase64: reference,
          referenceMimeType: options.referenceImage!.type,
        } : {}),
      }),
    });
    const result = await response.json().catch(() => ({})) as {
      imageBase64?: string;
      mimeType?: string;
      model?: string;
      revisedPrompt?: string;
      message?: string;
    };
    if (!response.ok || !result.imageBase64 || !result.mimeType) {
      throw new Error(result.message || `图片生成失败（${response.status}）。`);
    }
    const bytes = Uint8Array.from(atob(result.imageBase64), (character) => character.charCodeAt(0));
    return {
      blob: new Blob([bytes], { type: result.mimeType }),
      mimeType: result.mimeType,
      model: result.model,
      revisedPrompt: result.revisedPrompt,
    };
  })().finally(() => requests.delete(key));

  requests.set(key, request);
  return request;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
