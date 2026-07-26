import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

// Fixed embed base URL (PART 2 fixed facts)
const IFRAME_BASE = "https://clickanlook.space/iframe";

interface LockerDoc {
  embedId?: string;
  name?: string;
  integrationMode?: string;
}

export default function LockerEmbedPage() {
  const { lockerId } = useParams<{ lockerId: string }>();
  const [, navigate] = useLocation();
  const { profile } = useAuth();

  const [lockerDoc, setLockerDoc] = useState<LockerDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const uid = profile?.uid ?? "";

  useEffect(() => {
    if (!lockerId) {
      setError("Missing locker ID.");
      setLoading(false);
      return;
    }

    getDoc(doc(db, "lockers", lockerId))
      .then((snap) => {
        if (!snap.exists()) {
          setError("Locker not found.");
          return;
        }
        const data = snap.data();
        setLockerDoc({
          embedId: data.embedId ?? undefined,
          name: data.name ?? undefined,
          integrationMode: data.integrationMode ?? undefined,
        });
      })
      .catch(() => setError("Failed to load locker."))
      .finally(() => setLoading(false));
  }, [lockerId]);

  function handleBack() {
    navigate("/tasks");
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error || !lockerDoc?.embedId) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-red-400 text-sm text-center">
          {error ?? "This locker is not configured for embed mode."}
        </p>
        <Button variant="outline" onClick={handleBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Tasks
        </Button>
      </div>
    );
  }

  // ── Build iframe URL ──────────────────────────────────────────────────────
  // ml_sub1 = uid (identifies the user)
  // ml_sub2 = embedId (= taskId stored on the started completion doc, so the
  //           part-1 MyLead adapter can resolve it back to the right completion)
  const embedId = lockerDoc.embedId;
  const iframeSrc = `${IFRAME_BASE}/${embedId}?ml_sub1=${encodeURIComponent(uid)}&ml_sub2=${encodeURIComponent(embedId)}`;

  // ── Embed render ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-slate-950">
      {/* Header bar with back affordance */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-white/10 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="gap-2 text-white/70 hover:text-white hover:bg-white/10"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tasks
        </Button>
        {lockerDoc.name && (
          <span className="text-white/60 text-sm truncate">{lockerDoc.name}</span>
        )}
      </div>

      {/* Full-cover responsive iframe */}
      <div className="flex-1 min-h-0 w-full">
        <iframe
          src={iframeSrc}
          title={lockerDoc.name ?? "Content Locker"}
          className="w-full h-full border-0"
          allow="clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </div>
  );
}
