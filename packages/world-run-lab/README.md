# ChatVerse CVWB adapter

`@chatverse/world-run-lab` is the ChatVerse-specific execution adapter for
[ChatVerse WorldBench (CVWB)](../world-benchmark/README.md). It owns the
black-box World driver, prompt tracing and report projection; scenario
definitions, budgets, assertions and live entry points live in CVWB.

The adapter deliberately does not publish its own benchmark catalog. To run a
deterministic contract test, use:

```bash
npm run cvwb:test
```

To run a real-provider scenario, use the central CVWB entry point:

```bash
npm run cvwb:live -- --profile=world --scenario=cvwb-001
npm run cvwb:live -- --profile=studio
```

The adapter can still be embedded by another runner through
`createChatVerseWorldBenchAdapter()` and
`createChatVerseStudioBenchAdapter()`. It returns only the normalized
`BenchmarkObservation` consumed by CVWB scoring.
