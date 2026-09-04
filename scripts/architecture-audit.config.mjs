export default {
  lineLimits: {
    default: 800,
    aggregateRoot: 1500,
    reactPage: 500,
  },
  aggregateRoots: [
    "packages/core/src/engine/world/world.ts",
    "apps/world-server/src/server.ts",
  ],
  lineWaivers: {},
  deepImportWaivers: {},
  cycleWaivers: {},
  unreachableWaivers: {},
};
