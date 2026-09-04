import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImage, testImageProvider, type ImageProviderConfig } from "./image-provider.js";
import { assertSafeRemoteUrl } from "./image-providers/shared.js";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const PNG_BASE64 = PNG.toString("base64");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("image provider adapters", () => {
  it("translates OpenAI and Ark requests to their native image payloads", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: PNG_BASE64 }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await generateImage(config("openai"), { prompt: "scene", size: "1536x1024" });
    await generateImage(config("ark"), { prompt: "scene", size: "2048x1152" });

    const openAIRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const arkRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://images.example.test/v1/images/generations");
    expect(openAIRequest).toMatchObject({ prompt: "scene", size: "1536x1024", n: 1 });
    expect(openAIRequest).not.toHaveProperty("response_format");
    expect(arkRequest).toMatchObject({ stream: false, watermark: false, sequential_image_generation: "disabled" });
  });

  it("uses OpenAI image edits when a reference image is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await generateImage(config("openai"), {
      prompt: "keep the character, change the coat",
      size: "1024x1536",
      referenceImage: { bytes: PNG, mimeType: "image/png" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(url).toBe("https://images.example.test/v1/images/edits");
    expect(form.get("prompt")).toBe("keep the character, change the coat");
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  it("uses OpenRouter's dedicated Images API instead of OpenAI's generations path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: PNG_BASE64 }] }));
    vi.stubGlobal("fetch", fetchMock);

    await generateImage({ ...config("openrouter"), model: "openai/gpt-image-2" }, {
      prompt: "scene",
      size: "2048x1152",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://images.example.test/v1/images");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "openai/gpt-image-2",
      prompt: "scene",
      size: "2048x1152",
      n: 1,
    });
  });

  it("uses the Gemini Interactions schema and reads image content from steps", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: PNG_BASE64 }] }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const image = await generateImage(config("gemini"), { prompt: "mountain", size: "2048x1152" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));

    expect(init.headers).toMatchObject({ "x-goog-api-key": "secret", "Api-Revision": "2026-05-20" });
    expect(body.response_format).toMatchObject({ type: "image", aspect_ratio: "16:9", image_size: "2K" });
    expect(image.mimeType).toBe("image/png");
  });

  it("uses multipart output for Stability AI", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(PNG, {
      status: 200,
      headers: { "Content-Type": "image/png" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await generateImage({ ...config("stability"), model: "core" }, { prompt: "city", size: "1024x1536" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    expect(url).toBe("https://images.example.test/v1/v2beta/stable-image/generate/core");
    expect(form.get("prompt")).toBe("city");
    expect(form.get("aspect_ratio")).toBe("2:3");
  });

  it("polls BFL once and downloads the signed result", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "task-1", polling_url: "https://poll.example.test/result" }))
      .mockResolvedValueOnce(jsonResponse({ status: "Ready", result: { sample: "https://cdn.example.test/image.png" } }))
      .mockResolvedValueOnce(new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = generateImage({ ...config("bfl"), model: "flux-2-pro" }, { prompt: "harbor", size: "1440x810" });
    await vi.advanceTimersByTimeAsync(500);
    const image = await pending;

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://images.example.test/v1/v1/flux-2-pro",
      "https://poll.example.test/result",
      "https://cdn.example.test/image.png",
    ]);
    expect(image.bytes.equals(PNG)).toBe(true);
  });

  it("translates DashScope and SiliconFlow payloads and downloads their result URLs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ output: { choices: [{ message: { content: [{ image: "https://cdn.example.test/wan.png" }] } }] } }))
      .mockResolvedValueOnce(new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(jsonResponse({ images: [{ url: "https://cdn.example.test/qwen.png" }] }))
      .mockResolvedValueOnce(new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);

    await generateImage({ ...config("dashscope"), model: "wan2.6-t2i" }, { prompt: "river", size: "1696x960" });
    await generateImage({ ...config("siliconflow"), model: "Qwen/Qwen-Image" }, { prompt: "river", size: "1664x928" });

    const dashScopeBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const siliconFlowBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(dashScopeBody.parameters.size).toBe("1696*960");
    expect(siliconFlowBody).toMatchObject({ image_size: "1664x928", batch_size: 1 });
  });

  it("runs a no-generation credential check through the selected adapter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testImageProvider(config("gemini"));

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://images.example.test/v1/models/test-model");
    expect(result.verification).toBe("credentials");
  });

  it("rejects loopback and private image endpoints", () => {
    expect(() => assertSafeRemoteUrl("http://127.0.0.1:11434/v1")).toThrow(/HTTPS/);
    expect(() => assertSafeRemoteUrl("https://192.168.1.8/v1")).toThrow(/内网/);
  });
});

function config(protocol: ImageProviderConfig["protocol"]): ImageProviderConfig {
  return {
    protocol,
    apiKey: "secret",
    baseURL: "https://images.example.test/v1",
    model: "test-model",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
