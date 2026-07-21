export type TaskTypeValue = "manual" | "platform";

/** Infer task type from task document fields (backward compatible). */
export function inferTaskType(taskData: Record<string, unknown>): TaskTypeValue {
  // Locker offers must always be treated as platform tasks, regardless of whether
  // other metadata (taskType, importedFrom) is present. This is the safety net
  // for any offer where only sourceType was set correctly.
  if (taskData.sourceType === "locker") return "platform";

  const explicit = taskData.taskType;
  if (explicit === "manual" || explicit === "platform") return explicit;
  if (taskData.importedFrom) return "platform";
  return "manual";
}

/** Whether a pending completion should appear in Manual Task Reviews. */
export function isManualCompletion(
  completionData: Record<string, unknown>,
  taskData?: Record<string, unknown>
): boolean {
  const completionType = completionData.taskType;
  if (completionType === "manual") return true;
  if (completionType === "platform") return false;

  if (taskData) {
    return inferTaskType(taskData) === "manual";
  }

  return true;
}
