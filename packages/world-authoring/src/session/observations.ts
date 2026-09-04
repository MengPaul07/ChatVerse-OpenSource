export function summarizeToolObservation(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of ["revision", "operationCount", "valid", "error", "summary", "sourceCount"]) {
    const value = payload[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      summary[key] = typeof value === "string" && value.length > 240
        ? `${value.slice(0, 237)}...`
        : value;
    }
  }
  if (Array.isArray(payload.issues)) summary.issueCount = payload.issues.length;
  if (Array.isArray(payload.operations)) summary.operationCount = payload.operations.length;
  if (Object.keys(summary).length === 0) summary.keys = Object.keys(payload).slice(0, 8);
  return summary;
}
