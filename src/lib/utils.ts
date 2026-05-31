import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const USER_COMMISSION_RATE = 0.65;
export const PLATFORM_ADMIN_REVENUE_RATE = 0.35;
export const DEFAULT_PLATFORM_USER_SHARE_PERCENT = 65;
export const DEFAULT_MANUAL_ADMIN_REVENUE_RATE = 1;

export type RevenueTaskType = "manual" | "platform";

export type UserRewardInput =
  | number
  | {
      manualUserSharePercent?: number;
      manualAdminRate?: number;
      platformUserSharePercent?: number;
    };

export function normalizeManualAdminRate(rate?: number): number {
  if (typeof rate !== "number" || Number.isNaN(rate)) return DEFAULT_MANUAL_ADMIN_REVENUE_RATE;
  return Math.max(0, Math.min(1, rate));
}

export function normalizePlatformUserSharePercent(percent?: number): number {
  if (typeof percent !== "number" || Number.isNaN(percent)) return DEFAULT_PLATFORM_USER_SHARE_PERCENT;
  return Math.max(0, Math.min(100, percent));
}

export function resolveManualUserSharePercent(task: {
  manualUserSharePercent?: number;
  manualAdminRate?: number;
}): number {
  if (typeof task.manualUserSharePercent === "number") {
    return normalizePlatformUserSharePercent(task.manualUserSharePercent);
  }
  if (typeof task.manualAdminRate === "number") {
    return normalizePlatformUserSharePercent((1 - normalizeManualAdminRate(task.manualAdminRate)) * 100);
  }
  return 100;
}

export function adminRevenueRate(
  taskType: RevenueTaskType = "platform",
  manualAdminRate?: number,
  platformUserSharePercent?: number,
  manualUserSharePercent?: number
): number {
  if (taskType === "manual") {
    if (typeof manualUserSharePercent === "number") {
      return 1 - normalizePlatformUserSharePercent(manualUserSharePercent) / 100;
    }
    return normalizeManualAdminRate(manualAdminRate);
  }
  return 1 - normalizePlatformUserSharePercent(platformUserSharePercent) / 100;
}

export function userRevenueRate(
  taskType: RevenueTaskType = "platform",
  input?: UserRewardInput
): number {
  const opts = typeof input === "number" ? { manualAdminRate: input } : input ?? {};
  if (taskType === "manual") {
    return resolveManualUserSharePercent(opts) / 100;
  }
  return normalizePlatformUserSharePercent(opts.platformUserSharePercent) / 100;
}

export function userReward(
  adminPrice: number,
  taskType: RevenueTaskType = "platform",
  input?: UserRewardInput
): number {
  return adminPrice * userRevenueRate(taskType, input);
}

export function formatCurrency(amount: number): string {
  return amount.toFixed(5) + " USDT";
}

export function getDayNumber(registeredAt: Date): number {
  const now = new Date();
  const diff = now.getTime() - registeredAt.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  return days + 1;
}

export function getDailyTaskLimit(dayNumber: number): number {
  return dayNumber * 100;
}

export function isValidTRC20Address(address: string): boolean {
  return /^T[A-Za-z1-9]{33}$/.test(address);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
