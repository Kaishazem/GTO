import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useWallet } from "@/contexts/WalletContext";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wallet, ArrowDownToLine, Clock, CheckCircle, XCircle,
  Loader2, AlertCircle, Info, ChevronDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { updateDoc, doc, getDocs, query, collection, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getSettings, AppSettings } from "@/lib/settings";

type Currency = "USDT" | "USDC";
type Network = "TRC20" | "ERC20";

function isValidTRC20(addr: string) {
  return /^T[A-Za-z1-9]{33}$/.test(addr);
}
function isValidERC20(addr: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}
function validateAddress(addr: string, currency: Currency, network: Network): string | null {
  if (!addr) return "Wallet address is required";
  if (network === "TRC20") {
    if (!isValidTRC20(addr)) return "Invalid TRC20 address — must start with T and be 34 characters";
  } else {
    if (!isValidERC20(addr)) return "Invalid ERC20 address — must start with 0x and be 42 characters";
  }
  return null;
}

export default function WalletPage() {
  const { profile, refreshProfile } = useAuth();
  const { withdrawals, requestWithdrawal, loading } = useWallet();
  const { toast } = useToast();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [currency, setCurrency] = useState<Currency>("USDT");
  const [network, setNetwork] = useState<Network>("TRC20");
  const [walletAddress, setWalletAddress] = useState(profile?.trc20Address || "");
  const [amount, setAmount] = useState<number>(10);
  const [addrError, setAddrError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);

  useEffect(() => {
  setLoadingSettings(true);
  getSettings().then((s) => {
    setSettings(s);
    setAmount(s.usdtMin);
    setLoadingSettings(false);
  });
}, []);

  const minAmount = currency === "USDT"
    ? (settings?.usdtMin ?? 10)
    : (settings?.usdcMin ?? 10);

  const gasFee = currency === "USDT"
    ? (settings?.usdtGas ?? 1)
    : network === "TRC20"
    ? (settings?.usdcTrc20Gas ?? 1)
    : (settings?.usdcErc20Gas ?? 5);

  const feePercent = settings?.withdrawalFeePercent ?? 5;
  const commission = amount * (feePercent / 100);
  const netAmount = Math.max(0, amount - commission - gasFee);
  const balance = profile?.balance || 0;
  const canWithdraw = balance >= minAmount;
  const needMore = Math.max(0, minAmount - balance);

  const usdtEnabled = settings?.usdtEnabled !== false;
  const usdcEnabled = settings?.usdcEnabled !== false;

  // If selected currency becomes disabled, switch
  useEffect(() => {
    if (settings) {
      if (currency === "USDT" && !usdtEnabled && usdcEnabled) setCurrency("USDC");
      if (currency === "USDC" && !usdcEnabled && usdtEnabled) setCurrency("USDT");
    }
  }, [settings]);

  function handleCurrencyChange(c: Currency) {
    setCurrency(c);
    setNetwork("TRC20");
    setWalletAddress("");
    setAddrError(null);
  }

  function handleNetworkChange(n: Network) {
    setNetwork(n);
    setWalletAddress("");
    setAddrError(null);
  }

  function handleAddressChange(val: string) {
    setWalletAddress(val);
    const err = validateAddress(val, currency, network);
    setAddrError(err);
  }

  async function saveAddress() {
    const err = validateAddress(walletAddress, currency, network);
    if (err) { toast({ title: "Error", description: err, variant: "destructive" }); return; }
    setSavingAddress(true);
    try {
      if (!profile?.uid) return;

      // Check if this wallet is already linked to another account
      const addrLower = walletAddress.toLowerCase();
      const [exactSnap, lowerSnap, wSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("trc20Address", "==", walletAddress))),
        getDocs(query(collection(db, "users"), where("walletAddressLower", "==", addrLower))),
        getDocs(query(collection(db, "withdrawals"), where("walletAddress", "==", walletAddress))),
      ]);

      const s = settings?.allowDuplicateWallets !== true;
      const allDocs = [...exactSnap.docs, ...lowerSnap.docs, ...wSnap.docs];
      const takenByOther = allDocs.some((d) => {
        const uid = (d.data().userId as string) || d.id;
        return uid !== profile.uid;
      });

      if (takenByOther && s) {
        toast({
          title: "Wallet already in use",
          description: "This wallet is already linked to another account. Please use a different wallet address.",
          variant: "destructive",
        });
        return;
      }

      await updateDoc(doc(db, "users", profile.uid), {
        trc20Address: walletAddress,
        walletAddressLower: addrLower,
      });
      await refreshProfile();
      toast({ title: "✅ Saved", description: "Wallet address saved" });
    } finally { setSavingAddress(false); }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const addrErr = validateAddress(walletAddress, currency, network);
    if (addrErr) { toast({ title: "Invalid address", description: addrErr, variant: "destructive" }); return; }
    if (amount < minAmount) {
      toast({ title: "Below minimum", description: `Minimum withdrawal is $${minAmount}`, variant: "destructive" });
      return;
    }
    if (netAmount <= 0) {
      toast({ title: "Net amount too low", description: "The net amount after fees must be greater than zero", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await requestWithdrawal(amount, walletAddress, currency, network, gasFee, netAmount, feePercent);
      toast({ title: "✅ Submitted", description: "Your withdrawal request is under review" });
      setAmount(minAmount);
    } catch (e: unknown) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Something went wrong", variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  const statusConfig = {
    pending: { label: "Pending", icon: <Clock className="w-3 h-3" />, cls: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
    approved: { label: "Approved", icon: <CheckCircle className="w-3 h-3" />, cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
    rejected: { label: "Rejected", icon: <XCircle className="w-3 h-3" />, cls: "bg-red-500/20 text-red-300 border-red-500/30" },
  };

    if (loadingSettings) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-emerald-400 mx-auto mb-4" />
          <p className="text-white/60 text-sm">Loading wallet...</p>
        </div>
      </div>
    );
  }

  return (
    
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Wallet</h1>

      {/* Instruction notice */}
      {settings?.withdrawalInstructionText && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 flex gap-3">
          <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-blue-300 font-medium text-sm">How withdrawals work</p>
            <p className="text-blue-400/80 text-sm mt-0.5">{settings.withdrawalInstructionText}</p>
          </div>
        </div>
      )}

      {/* Balance cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5">
          <p className="text-sm text-emerald-300/70 mb-1">Available Balance</p>
          <p className="text-3xl font-bold text-white">{balance.toFixed(5)}</p>
          <p className="text-sm text-emerald-400 mt-1">USDT</p>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5">
          <p className="text-sm text-amber-300/70 mb-1">Pending Balance</p>
          <p className="text-3xl font-bold text-white">{(profile?.pendingBalance || 0).toFixed(5)}</p>
          <p className="text-sm text-amber-400 mt-1">USDT</p>
        </div>
      </div>

      {/* Not enough balance */}
      {!canWithdraw && settings && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 font-medium text-sm">Not enough to withdraw yet</p>
            <p className="text-amber-400/70 text-sm mt-0.5">
              You need <span className="font-bold text-amber-300">${needMore.toFixed(5)} more</span> to reach the ${minAmount} minimum.
            </p>
          </div>
        </div>
      )}

      {/* Withdrawal form */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <ArrowDownToLine className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white">Request Withdrawal</h2>
            <p className="text-xs text-white/40">Minimum ${minAmount} • Subject to fees</p>
          </div>
        </div>

        {/* Currency selector */}
        {(usdtEnabled || usdcEnabled) && (
          <div className="mb-5">
            <p className="text-sm font-medium text-white/80 mb-2">Currency</p>
            <div className="flex gap-2">
              {usdtEnabled && (
                <button
                  onClick={() => handleCurrencyChange("USDT")}
                  className={cn("flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all", currency === "USDT"
                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                    : "bg-white/5 border-white/10 text-white/50 hover:text-white")}
                >
                  USDT
                </button>
              )}
              {usdcEnabled && (
                <button
                  onClick={() => handleCurrencyChange("USDC")}
                  className={cn("flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all", currency === "USDC"
                    ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                    : "bg-white/5 border-white/10 text-white/50 hover:text-white")}
                >
                  USDC
                </button>
              )}
            </div>
          </div>
        )}

        {/* Network selector (USDC only) */}
        {currency === "USDC" && (
          <div className="mb-5">
            <p className="text-sm font-medium text-white/80 mb-2">Network</p>
            <div className="flex gap-2">
              {(["TRC20", "ERC20"] as Network[]).map((n) => (
                <button
                  key={n}
                  onClick={() => handleNetworkChange(n)}
                  className={cn("flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all", network === n
                    ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                    : "bg-white/5 border-white/10 text-white/50 hover:text-white")}
                >
                  {n} {n === "TRC20" ? `(Gas $${settings?.usdcTrc20Gas ?? 1})` : `(Gas $${settings?.usdcErc20Gas ?? 5})`}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-5 flex gap-2">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">
            Double-check your {network} wallet address. Incorrect addresses result in permanent loss of funds.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Wallet address */}
          <div>
            <label className="text-sm font-medium text-white/80 block mb-1.5">
              {network} Wallet Address {network === "TRC20" ? "(starts with T)" : "(starts with 0x)"}
            </label>
            <div className="flex gap-2">
              <Input
                value={walletAddress}
                onChange={(e) => handleAddressChange(e.target.value)}
                placeholder={network === "TRC20" ? "T..." : "0x..."}
                className={cn("bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-emerald-400 font-mono text-sm flex-1",
                  addrError && walletAddress && "border-red-500/50")}
              />
              <Button
                type="button"
                variant="outline"
                onClick={saveAddress}
                disabled={savingAddress}
                className="border-white/20 text-white/70 hover:text-white hover:bg-white/10 shrink-0"
              >
                {savingAddress ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </div>
            {addrError && walletAddress && <p className="text-xs text-red-400 mt-1">{addrError}</p>}
          </div>

          {/* Amount */}
          <div>
            <label className="text-sm font-medium text-white/80 block mb-1.5">Amount (USD)</label>
            <Input
              type="number"
              step="0.000001" 
              inputMode="decimal"
              lang="en"
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
              className="bg-white/10 border-white/20 text-white focus:border-emerald-400"
            />
            <p className="text-xs text-white/40 mt-1">Min: ${minAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} • Available: ${balance.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 5 })}</p>
          </div>

          {/* Fee breakdown */}
          {amount > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
              <p className="text-xs font-medium text-white/60 mb-3">Fee Breakdown</p>
              <div className="flex justify-between text-sm">
                <span className="text-white/60">Withdrawal amount</span>
                <span className="text-white">${amount.toFixed(5)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/60">Commission ({feePercent}%)</span>
                <span className="text-red-400">-${commission.toFixed(5)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/60">Network gas ({network})</span>
                <span className="text-red-400">-${gasFee.toFixed(2)}</span>
              </div>
              <div className="border-t border-white/10 pt-2 flex justify-between text-sm font-semibold">
                <span className="text-white">You receive</span>
                <span className={netAmount > 0 ? "text-emerald-400" : "text-red-400"}>${netAmount.toFixed(5)} {currency}</span>
              </div>
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting || !canWithdraw || !!addrError}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wallet className="w-4 h-4 mr-2" />}
            Submit Withdrawal Request
          </Button>
        </form>
      </div>

      {/* Withdrawal history */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <h2 className="font-semibold text-white mb-4">Withdrawal History</h2>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
        ) : withdrawals.length === 0 ? (
          <p className="text-center text-white/40 py-8 text-sm">No withdrawal requests yet</p>
        ) : (
          <div className="space-y-3">
            {withdrawals.map((w) => {
              const s = statusConfig[w.status];
              return (
                <div key={w.id} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge className={cn("text-xs gap-1", s.cls)}>
                        {s.icon}{s.label}
                      </Badge>
                      <Badge className="bg-white/10 text-white/50 border-white/10 text-xs">
                        {w.currency} • {w.network}
                      </Badge>
                    </div>
                    <p className="text-xs text-white/40 font-mono">{w.walletAddress.slice(0, 8)}...{w.walletAddress.slice(-6)}</p>
                    <p className="text-xs text-white/30 mt-0.5">{formatDate(w.createdAt)}</p>
                    {w.status === "pending" && (
                      <p className="text-xs text-amber-400/60 mt-0.5">Awaiting approval</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-emerald-400">${w.netAmount.toFixed(5)}</p>
                    <p className="text-xs text-white/30">{w.currency} net payout</p>
                    {w.netAmount !== w.amount && (
                      <p className="text-xs text-white/20">requested: ${w.amount.toFixed(5)}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
