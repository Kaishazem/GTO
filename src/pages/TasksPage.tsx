import { useState, useEffect } from "react";
import { useTask, Task } from "@/contexts/TaskContext";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate, userReward } from "@/lib/utils";
import { getSettings } from "@/lib/settings";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ExternalLink,
  CheckCircle,
  Loader2,
  Zap,
  Star,
  History,
  Info,
  Building2,
  Globe,
  Monitor,
  Tag,
  AlertTriangle,
  Clock,
  ShieldCheck,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

type MainTab = "all" | "simple" | "premium" | "history";
type ActivityFilter = "all" | "pending" | "approved" | "rejected";

// ── Canonical status helpers ───────────────────────────────────────────────────

type CompletionStatus = "pending" | "platform_pending" | "platform_approved" | "approved" | "rejected";

function statusBadgeProps(status: CompletionStatus): { label: string; className: string; icon: React.ReactNode } {
  switch (status) {
    case "platform_pending":
      return {
        label: "Pending Platform Verification",
        className: "bg-amber-500/20 text-amber-300 border-amber-500/30",
        icon: <Clock className="w-3 h-3 mr-1" />,
      };
    case "platform_approved":
      return {
        label: "Waiting Admin Review",
        className: "bg-blue-500/20 text-blue-300 border-blue-500/30",
        icon: <RefreshCw className="w-3 h-3 mr-1" />,
      };
    case "pending":
      return {
        label: "Pending Review",
        className: "bg-amber-500/20 text-amber-300 border-amber-500/30",
        icon: <Clock className="w-3 h-3 mr-1" />,
      };
    case "approved":
      return {
        label: "Approved",
        className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
        icon: <ShieldCheck className="w-3 h-3 mr-1" />,
      };
    case "rejected":
      return {
        label: "Rejected",
        className: "bg-red-500/20 text-red-300 border-red-500/30",
        icon: <XCircle className="w-3 h-3 mr-1" />,
      };
  }
}

export default function TasksPage() {
  const { tasks, completions, completeTask, hasMore, loadMoreTasks, loadingMore, loading } = useTask();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<MainTab>("all");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [completing, setCompleting] = useState<string | null>(null);
  const [pendingConfirmTask, setPendingConfirmTask] = useState<{ id: string } | null>(null);
  const [detailsTask, setDetailsTask] = useState<Task | null>(null);
  const [platformUserSharePercent, setPlatformUserSharePercent] = useState(65);

  useEffect(() => {
    getSettings().then((s) => setPlatformUserSharePercent(s.platformTaskUserSharePercent ?? 65));
  }, []);

  const completedIds = new Set(completions.map((c) => c.taskId));

  const filtered = tasks.filter((t) => {
    if (completedIds.has(t.id)) return false;
    if (tab === "simple") return t.type === "simple";
    if (tab === "premium") return t.type === "premium";
    return true;
  });

  function matchesActivityFilter(status: CompletionStatus, filter: ActivityFilter): boolean {
    if (filter === "all") return true;
    if (filter === "pending") return status === "pending" || status === "platform_pending" || status === "platform_approved";
    return status === filter;
  }

  const activityItems = completions
    .filter((c) => matchesActivityFilter(c.status as CompletionStatus, activityFilter))
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

  function handleStart(taskId: string, url: string) {
    window.open(url, "_blank");
    setPendingConfirmTask({ id: taskId });
  }

  async function handleConfirm(taskId: string) {
    setCompleting(taskId);
    setPendingConfirmTask(null);
    try {
      await completeTask(taskId);
      toast({ title: "✅ Done!", description: "Task submitted — pending verification" });
    } catch (e: unknown) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Something went wrong", variant: "destructive" });
    } finally {
      setCompleting(null);
    }
  }

  function handleDidNotComplete() {
    setPendingConfirmTask(null);
  }

  const availableTasks = tasks.filter((t) => !completedIds.has(t.id));

  const tabs: { id: MainTab; label: string; icon?: React.ReactNode; count?: number }[] = [
    { id: "all", label: "All", count: availableTasks.length },
    { id: "simple", label: "Simple", icon: <Zap className="w-3.5 h-3.5" />, count: availableTasks.filter((t) => t.type === "simple").length },
    { id: "premium", label: "Premium", icon: <Star className="w-3.5 h-3.5" />, count: availableTasks.filter((t) => t.type === "premium").length },
    { id: "history", label: "Task History", icon: <History className="w-3.5 h-3.5" />, count: completions.length },
  ];

  function getDisplayReward(task: Task) {
    return (task.taskType || "platform") === "manual"
      ? userReward(task.reward, "manual", {
          manualUserSharePercent: task.manualUserSharePercent,
          manualAdminRate: task.manualAdminRate,
        })
      : userReward(task.reward, "platform", { platformUserSharePercent });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tasks</h1>
          <p className="text-white/50 text-sm mt-1">Complete tasks and earn USDT</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-emerald-400">{completions.length}</div>
          <div className="text-xs text-white/40">total completed</div>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-testid={`filter-${t.id}`}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all",
              tab === t.id
                ? "bg-emerald-500 text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
            )}
          >
            {t.icon}
            {t.label}
            <span className={cn(
              "text-xs px-1.5 py-0.5 rounded-full font-normal",
              tab === t.id ? "bg-white/20 text-white" : "bg-white/10 text-white/40"
            )}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── TASKS LIST (All / Simple / Premium) ── */}
      {tab !== "history" && (
        <>
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-white/40">
              <div className="w-16 h-16 mx-auto mb-2 rounded-2xl bg-white/5 flex items-center justify-center">
                <span className="text-3xl">📋</span>
              </div>
              <p className="mt-3">No tasks available right now</p>
              <p className="text-xs mt-1">Check back soon — tasks are added regularly</p>
            </div>
          ) : (
            <>
              <div className="grid gap-4">
                {filtered.map((task) => {
                  const done = completedIds.has(task.id);
                  const isLoading = completing === task.id;
                  const displayReward = getDisplayReward(task);
                  const completion = completions.find((c) => c.taskId === task.id);
                  const statusProps = completion ? statusBadgeProps(completion.status as CompletionStatus) : null;
                  return (
                    <div
                      key={task.id}
                      data-testid={`card-task-${task.id}`}
                      className={cn(
                        "border rounded-2xl p-5 transition-all",
                        done
                          ? "border-emerald-500/30 bg-emerald-500/5 opacity-80"
                          : "border-white/10 bg-white/5 hover:border-white/20"
                      )}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <Badge className={cn("text-xs", task.type === "premium"
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                              : "bg-blue-500/20 text-blue-300 border-blue-500/30"
                            )}>
                              {task.type === "premium" ? <><Star className="w-3 h-3 mr-1" />Premium</> : <><Zap className="w-3 h-3 mr-1" />Simple</>}
                            </Badge>
                            <Badge className="bg-white/10 text-white/60 border-white/10 text-xs">{task.platform}</Badge>
                            {task.category && (
                              <Badge className="bg-white/5 text-white/40 border-white/10 text-xs">
                                <Tag className="w-2.5 h-2.5 mr-1" />{task.category}
                              </Badge>
                            )}
                            {done && completion && statusProps && (
                              <Badge className={cn("text-xs border flex items-center", statusProps.className)}>
                                {statusProps.icon}{statusProps.label}
                              </Badge>
                            )}
                          </div>
                          <h3 className="font-semibold text-white text-base mb-1">{task.title}</h3>
                          <p className="text-sm text-white/50 line-clamp-2">{task.description}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-lg font-bold text-emerald-400">+{formatCurrency(displayReward)}</div>
                          <div className="text-xs text-white/30 mt-0.5">per task</div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                        {done ? (
                          <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                            <CheckCircle className="w-4 h-4" />
                            Completed
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              disabled={isLoading}
                              data-testid={`button-start-${task.id}`}
                              onClick={() => handleStart(task.id, task.url)}
                              className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl"
                            >
                              {isLoading ? (
                                <><Loader2 className="w-4 h-4 animate-spin mr-1" />Submitting...</>
                              ) : (
                                <><ExternalLink className="w-4 h-4 mr-1" />Start Task</>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-details-${task.id}`}
                              onClick={() => setDetailsTask(task)}
                              className="border-white/20 text-white/60 hover:text-white hover:bg-white/10 rounded-xl"
                            >
                              <Info className="w-4 h-4 mr-1" />
                              View Details
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {hasMore && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={loadMoreTasks}
                    disabled={loadingMore}
                    className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                  >
                    {loadingMore ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Load More Tasks
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── TASK DETAILS DIALOG ── */}
      {detailsTask && (() => {
        const dt = detailsTask;
        const dtReward = getDisplayReward(dt);
        const instructions = dt.description?.trim() || dt.requirements?.trim() || "";
        const hasInstructions = !!instructions;
        const hasRequirements = !!dt.requirements?.trim() && dt.requirements !== dt.description;
        const hasCountries = (dt.countries?.length ?? 0) > 0;
        const hasDevices = (dt.devices?.length ?? 0) > 0;
        const hasCategory = !!dt.category?.trim();
        const hasConversionType = !!dt.conversionType?.trim();
        const fallbackInstructions = "Please carefully follow the instructions shown on the offer page.\n\nUsing duplicate accounts, fake information, VPNs (when prohibited), or failing to complete all requirements may result in your reward being rejected.";

        return (
          <Dialog open={!!detailsTask} onOpenChange={(open) => { if (!open) setDetailsTask(null); }}>
            <DialogContent
              className="bg-slate-900 border border-white/10 text-white max-w-md p-0 overflow-hidden"
              data-testid="dialog-task-details"
            >
              {/* ── Header ── */}
              <div className="p-5 pb-4 border-b border-white/10">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <Badge className={cn("text-xs", dt.type === "premium"
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                        : "bg-blue-500/20 text-blue-300 border-blue-500/30"
                      )}>
                        {dt.type === "premium" ? <><Star className="w-3 h-3 mr-1" />Premium</> : <><Zap className="w-3 h-3 mr-1" />Simple</>}
                      </Badge>
                      {hasCategory && (
                        <Badge className="bg-white/5 text-white/50 border-white/10 text-xs">
                          <Tag className="w-2.5 h-2.5 mr-1" />{dt.category}
                        </Badge>
                      )}
                    </div>
                    <DialogTitle className="text-white text-base leading-snug font-semibold">{dt.title}</DialogTitle>
                    <DialogDescription className="sr-only">Task details for {dt.title}</DialogDescription>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xl font-bold text-emerald-400">+{formatCurrency(dtReward)}</div>
                    <div className="text-xs text-white/30">reward</div>
                  </div>
                </div>

                {/* Platform row */}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                  <Building2 className="w-3.5 h-3.5 text-white/30 shrink-0" />
                  <span className="text-xs text-white/40">Provided by</span>
                  <span className="text-xs text-white/70 font-medium">{dt.platform}</span>
                  {hasConversionType && (
                    <>
                      <span className="text-white/20">•</span>
                      <span className="text-xs text-white/40 capitalize">{dt.conversionType}</span>
                    </>
                  )}
                </div>
              </div>

              {/* ── Scrollable body ── */}
              <ScrollArea className="max-h-72">
                <div className="px-5 py-4 space-y-4">

                  {/* Instructions */}
                  <div>
                    <p className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-1.5">Instructions</p>
                    <p className="text-sm text-white/80 leading-relaxed whitespace-pre-line">
                      {hasInstructions ? instructions : fallbackInstructions}
                    </p>
                    {hasInstructions && (
                      <p className="text-xs text-white/30 mt-2 italic leading-relaxed">
                        Always follow the instructions shown on the offer page after clicking Start Task. Platform instructions may be updated by the offer provider.
                      </p>
                    )}
                  </div>

                  {/* Requirements (if different from description) */}
                  {hasRequirements && (
                    <div className="pt-1 border-t border-white/5">
                      <p className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-1.5">Requirements</p>
                      <p className="text-sm text-white/70 leading-relaxed whitespace-pre-line">{dt.requirements}</p>
                    </div>
                  )}

                  {/* Countries */}
                  {hasCountries && (
                    <div className="pt-1 border-t border-white/5">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Globe className="w-3 h-3 text-white/30" />
                        <p className="text-xs font-semibold text-white/40 uppercase tracking-wide">Country Restrictions</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {dt.countries!.map((c) => (
                          <span key={c} className="text-xs bg-white/5 text-white/60 border border-white/10 px-2 py-0.5 rounded-md">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Devices */}
                  {hasDevices && (
                    <div className="pt-1 border-t border-white/5">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Monitor className="w-3 h-3 text-white/30" />
                        <p className="text-xs font-semibold text-white/40 uppercase tracking-wide">Device Requirements</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {dt.devices!.map((d) => (
                          <span key={d} className="text-xs bg-white/5 text-white/60 border border-white/10 px-2 py-0.5 rounded-md capitalize">{d}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reward warning */}
                  <div className="pt-1 border-t border-white/5">
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <p className="text-xs font-semibold text-amber-300">Before you start</p>
                      </div>
                      <ul className="space-y-1 pl-5 list-disc">
                        <li className="text-xs text-white/50">Reward is pending until both platform and admin verification complete.</li>
                        <li className="text-xs text-white/50">Completing the task does not guarantee approval.</li>
                        <li className="text-xs text-white/50">Platform review and admin review are both required before rewards become available.</li>
                      </ul>
                    </div>
                  </div>

                </div>
              </ScrollArea>

              {/* ── Footer ── */}
              <div className="px-5 py-4 border-t border-white/10">
                <Button
                  data-testid={`button-details-start-${dt.id}`}
                  onClick={() => { setDetailsTask(null); handleStart(dt.id, dt.url); }}
                  className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl w-full"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Start Task
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ── TASK COMPLETION CONFIRMATION DIALOG ── */}
      <Dialog
        open={!!pendingConfirmTask}
        onOpenChange={(open) => { if (!open) handleDidNotComplete(); }}
      >
        <DialogContent
          className="bg-slate-900 border border-white/10 text-white max-w-sm"
          data-testid="dialog-task-confirm"
        >
          <DialogHeader>
            <DialogTitle className="text-white text-lg">Did you complete this task?</DialogTitle>
            <DialogDescription className="text-white/50 text-sm">
              Only confirm if you fully completed the offer in the new tab.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 mt-2">
            <Button
              data-testid="button-confirm-completed"
              onClick={() => pendingConfirmTask && handleConfirm(pendingConfirmTask.id)}
              className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl w-full"
            >
              ✅ I completed this task
            </Button>
            <Button
              data-testid="button-confirm-not-completed"
              variant="outline"
              onClick={handleDidNotComplete}
              className="border-white/20 text-white/70 hover:text-white hover:bg-white/10 rounded-xl w-full"
            >
              ❌ I did not complete this task
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── TASK HISTORY TAB ── */}
      {tab === "history" && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="text-xl font-bold text-white mb-1">Task History</h2>
          <p className="text-sm text-white/50 mb-4">Your task completion history</p>

          <div className="flex gap-2 flex-wrap mb-4">
            {(["all", "pending", "approved", "rejected"] as const).map((f) => {
              const count = f === "all"
                ? completions.length
                : completions.filter((c) => matchesActivityFilter(c.status as CompletionStatus, f)).length;
              return (
                <button
                  key={f}
                  onClick={() => setActivityFilter(f)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize",
                    activityFilter === f
                      ? "bg-emerald-500 text-white"
                      : "bg-white/5 text-white/50 hover:bg-white/10"
                  )}
                >
                  {f === "all" ? `All (${count})` : f === "pending" ? `In Progress (${count})` : `${f} (${count})`}
                </button>
              );
            })}
          </div>

          {activityItems.length === 0 ? (
            <p className="text-center text-white/40 py-8 text-sm">No activity yet</p>
          ) : (
            <div className="space-y-3">
              {activityItems.map((c) => {
                const sp = statusBadgeProps(c.status as CompletionStatus);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 py-3 border-b border-white/5 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">
                        {c.taskTitle || `Task ${c.taskId.slice(0, 8)}`}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge className={cn("text-xs border flex items-center", sp.className)}>
                          {sp.icon}{sp.label}
                        </Badge>
                        <Badge className={cn(
                          "text-xs border",
                          c.taskType === "manual"
                            ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
                            : "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                        )}>
                          {c.taskType === "manual" ? "Manual" : "Platform"}
                        </Badge>
                        <span className="text-xs text-white/30">{formatDate(c.completedAt)}</span>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-emerald-400 shrink-0">+{formatCurrency(c.reward)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
