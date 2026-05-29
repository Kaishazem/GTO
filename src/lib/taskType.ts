export type TaskTypeValue = "manual" | "platform";

/** Infer task type from task document fields (backward compatible). */
export function inferTaskType(taskData: Record<string, unknown>): TaskTypeValue {
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
