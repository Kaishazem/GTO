import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const USER_COMMISSION_RATE = 0.65;

export function userReward(adminPrice: number): number {
  return adminPrice * USER_COMMISSION_RATE;
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
