import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createEnvironmentProviders } from "@chatverse/world-server/environment";
import {
  createCVWBSuiteRegistry,
  runBenchmarkScenario,
  runStudioBenchmarkScenario,
} from "@chatverse/world-benchmark";
import {
  createChatVerseStudioBenchAdapter,
  createChatVerseWorldBenchAdapter,
} from "@chatverse/world-run-lab";

const options = parseArgs(process.argv.slice(2));
const envFile = path.resolve(options.envFile);
if (existsSync(envFile)) loadEnvFile(envFile);
if (!process.env.PROVIDER_TIMEOUT_MS) process.env.PROVIDER_TIMEOUT_MS = String(options.requestTimeoutMs);
const providerConfig = options.providerConfigFile
  ? JSON.parse(await readFile(path.resolve(options.providerConfigFile), "utf8"))
  : undefined;
const providers = await createEnvironmentProviders(providerConfig);
const registry = createCVWBSuiteRegistry();

if (options.profile === "studio") {
  await runStudio(options, providers, registry);
} else {
  await runWorld(options, providers, registry);
}

function parseArgs(values) {
  const output = {
    profile: "world",
    scenario: undefined,
    envFile: "apps/world-server/.env",
    outputDirectory: ".artifacts/world-benchmark",
    requestTimeoutMs: 90_000,
    stepTimeoutMs: 120_000,
    minimumWaitMs: 15_000,
    traceAgentOutput: false,
    providerConfigFile: undefined,
  };
  for (const value of values) {
    if (value.startsWith("--profile=")) {
      const profile = value.slice("--profile=".length);
      if (profile !== "world" && profile !== "studio") throw new Error(`未知 profile：${profile}`);
      output.profile = profile;
    } else if (value.startsWith("--scenario=")) output.scenario = value.slice("--scenario=".length);
    else if (value.startsWith("--env=")) output.envFile = value.slice("--env=".length);
    else if (value.startsWith("--out=")) output.outputDirectory = value.slice("--out=".length);
    else if (value.startsWith("--request-timeout-ms=")) {
      output.requestTimeoutMs = positiveInteger(value.slice("--request-timeout-ms=".length), output.requestTimeoutMs);
    } else if (value.startsWith("--step-timeout-ms=")) {
      output.stepTimeoutMs = positiveInteger(value.slice("--step-timeout-ms=".length), output.stepTimeoutMs);
    } else if (value.startsWith("--min-wait-ms=")) {
      output.minimumWaitMs = positiveInteger(value.slice("--min-wait-ms=".length), output.minimumWaitMs);
    } else if (value === "--trace-agent-output") output.traceAgentOutput = true;
    else if (value.startsWith("--provider-config=")) output.providerConfigFile = value.slice("--provider-config=".length);
    else if (value === "--help" || value === "-h") {
      console.log("node scripts/cvwb-live.mjs [--profile=world|studio] [--scenario=cvwb-001] [--env=apps/world-server/.env] [--provider-config=provider.json] [--out=.artifacts/world-benchmark] [--min-wait-ms=15000] [--trace-agent-output]");
      process.exit(0);
    } else {
      throw new Error(`未知参数：${value}`);
    }
  }
  return output;
}

async function runWorld(options, providers, registry) {
  const scenarioSelector = options.scenario ?? "cvwb-001";
  const selectedScenario = registry.world.find((candidate) => (
    candidate.id === scenarioSelector || candidate.id.startsWith(scenarioSelector)
  ));
  if (!selectedScenario) {
    throw new Error(`未知世界场景 ${scenarioSelector}。可选：${registry.world.map((item) => item.id).join(", ")}`);
  }
  const directorProvider = options.traceAgentOutput ? withAgentOutputTrace(providers.directorProvider) : providers.directorProvider;
  const characterProvider = options.traceAgentOutput ? withAgentOutputTrace(providers.characterProvider) : providers.characterProvider;
  const scenario = {
    ...selectedScenario,
    actions: selectedScenario.actions.map((action) => (
      action.type === "wait"
        ? { ...action, durationMs: Math.max(action.durationMs, options.minimumWaitMs) }
        : action
    )),
  };
  const adapter = createChatVerseWorldBenchAdapter({
    providers: { director: directorProvider, character: characterProvider, mode: "live" },
    timeMode: "realtime",
    debug: true,
    stepTimeoutMs: options.stepTimeoutMs,
  });
  const runId = `${scenario.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  console.log(`[CVWB] profile=world scenario=${scenario.id} provider=${directorProvider.profile?.providerName ?? "configured"}`);
  console.log(`[CVWB] directorModel=${directorProvider.profile?.model ?? "provider-default"} characterModel=${characterProvider.profile?.model ?? "provider-default"}`);
  const result = await runBenchmarkScenario(adapter, scenario, { runId });
  const artifactPath = await writeArtifact(options.outputDirectory, runId, result);
  console.log(`[CVWB] status=${result.score.status} score=${result.score.percentage.toFixed(2)}`);
  console.log(`[CVWB] calls=${result.observation.metrics.providerCalls} tokens=${result.observation.metrics.totalTokens} cacheHitRate=${(result.observation.metrics.cacheHitRate * 100).toFixed(1)}% stalls=${result.observation.metrics.stallCount}`);
  for (const criterion of result.score.criteria) {
    const state = criterion.pendingJudge ? "PENDING" : criterion.passed ? "PASS" : "FAIL";
    console.log(`[CVWB] ${state} ${criterion.id}: ${criterion.detail}`);
  }
  for (const failure of result.observation.failures) console.error(`[CVWB] ERROR ${failure}`);
  console.log(`[CVWB] artifact=${artifactPath}`);
  process.exitCode = result.score.hardGateTriggered || result.observation.failures.length > 0 ? 1 : 0;
}

async function runStudio(options, providers, registry) {
  const scenarioSelector = options.scenario ?? "cvwb-studio-001";
  const selectedScenario = registry.studio.find((candidate) => (
    candidate.id === scenarioSelector || candidate.id.startsWith(scenarioSelector)
  ));
  if (!selectedScenario) {
    throw new Error(`未知 Studio 场景 ${scenarioSelector}。可选：${registry.studio.map((item) => item.id).join(", ")}`);
  }
  const authoringProvider = providers.authoringProvider ?? providers.directorProvider;
  if (!providers.researchProvider) throw new Error("当前统一 Provider 配置没有可用的 Research Provider。");
  const adapter = createChatVerseStudioBenchAdapter({
    provider: authoringProvider,
    researchProvider: providers.researchProvider,
  });
  const runId = `${selectedScenario.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  console.log(`[CVWB] profile=studio scenario=${selectedScenario.id} provider=${authoringProvider.profile?.providerName ?? "configured"}`);
  console.log(`[CVWB] authoringModel=${authoringProvider.profile?.model ?? "provider-default"}`);
  const result = await runStudioBenchmarkScenario(adapter, selectedScenario, { runId });
  const artifactPath = await writeArtifact(options.outputDirectory, runId, result);
  console.log(`[CVWB] status=${result.passed ? "complete" : "failed"} score=${result.percentage.toFixed(2)} calls=${result.observation.providerCalls} tokens=${result.observation.totalTokens}`);
  for (const item of result.checks) console.log(`[CVWB] ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.detail}`);
  console.log(`[CVWB] artifact=${artifactPath}`);
  process.exitCode = result.passed ? 0 : 1;
}

async function writeArtifact(outputDirectory, runId, result) {
  const directory = path.resolve(outputDirectory, runId);
  await mkdir(directory, { recursive: true });
  const artifactPath = path.join(directory, "result.json");
  await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return artifactPath;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function withAgentOutputTrace(providerInstance) {
  return new Proxy(providerInstance, {
    get(target, property, receiver) {
      if (property !== "complete") {
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (request) => {
        const output = await target.complete(request);
        const purpose = request.requestContext?.purpose;
        if (purpose === "world_narrator" || purpose === "world_director") {
          console.log(`[CVWB][${purpose}] ${output}`);
        }
        return output;
      };
    },
  });
}
