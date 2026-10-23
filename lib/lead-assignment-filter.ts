const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A single PostgREST `or` expression for assignment state and batch exclusion. */
export function assignmentOrExpression(
  includeAssigned: boolean,
  excludeBatchId = "",
): string | null {
  const excludedBatch = UUID_PATTERN.test(excludeBatchId) ? excludeBatchId : "";
  if (includeAssigned) {
    return excludedBatch
      ? `assignment_batch_id.is.null,assignment_batch_id.neq.${excludedBatch}`
      : null;
  }

  const unassigned = ["assigned_to.is.null", 'assigned_to.eq.""', "assigned_to.eq.-", "assigned_to.eq.Unassigned"];
  if (!excludedBatch) return unassigned.join(",");

  // Keep both predicates in the same `or` query parameter. PostgREST's second
  // `.or()` call overwrites the first, so chaining them silently loses a filter.
  return unassigned.flatMap((condition) => [
    `and(${condition},assignment_batch_id.is.null)`,
    `and(${condition},assignment_batch_id.neq.${excludedBatch})`,
  ]).join(",");
}
