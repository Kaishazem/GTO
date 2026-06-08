import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface NetworkKeys {
  postbackSecret?: string;
}

export interface AppSettings {
  withdrawalInstructionText: string;
  usdtEnabled: boolean;
  usdcEnabled: boolean;
  usdtMin: number;
  usdcMin: number;
  usdtGas: number;
  usdcTrc20Gas: number;
  usdcErc20Gas: number;
  withdrawalFeePercent: number;
  withdrawalSchedule: "instant" | "daily" | "weekly";
  networkKeys?: NetworkKeys;
  allowDuplicateWallets?: boolean;
  /** User share % for platform tasks only (default 65). Manual tasks ignore this. */
  platformTaskUserSharePercent?: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  withdrawalInstructionText: "Withdrawals are processed after advertiser approval and payment confirmation. Transfers are sent via TRC20 (TRON) network only.",
  usdtEnabled: true,
  usdcEnabled: true,
  usdtMin: 10,
  usdcMin: 10,
  usdtGas: 1.0,
  usdcTrc20Gas: 1.0,
  usdcErc20Gas: 5.0,
  withdrawalFeePercent: 5,
  withdrawalSchedule: "instant",
  networkKeys: {},
  allowDuplicateWallets: false,
  platformTaskUserSharePercent: 65,
};

export async function getSettings(): Promise<AppSettings> {
  try {
    const snap = await getDoc(doc(db, "settings", "general"));
    if (snap.exists()) {
      return { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<AppSettings>) };
    }
    return DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  await setDoc(doc(db, "settings", "general"), settings, { merge: true });
}
