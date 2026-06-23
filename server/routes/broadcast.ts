import { Router, Request, Response } from "express";
import { db } from "../firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  if (!db) {
    res.status(503).json({ ok: false, error: "Server database not configured." });
    return;
  }

  const { title, message, sentBy } = req.body as {
    title?: string;
    message?: string;
    sentBy?: string;
  };

  if (!title?.trim() || !message?.trim()) {
    res.status(400).json({ ok: false, error: "title and message are required" });
    return;
  }

  try {
    // Write ONE systemMessages document. Every logged-in user's NotificationContext
    // subscribes to this collection via onSnapshot and calls createNotification()
    // for themselves — creating a personalised notification in their own local cache
    // and in the notifications collection. This avoids any Admin-SDK vs client-SDK
    // race condition and works for users who log in after the broadcast was sent.
    const msgRef = await db.collection("systemMessages").add({
      title: title.trim(),
      message: message.trim(),
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      sentBy: sentBy || "admin",
    });

    console.log(`[broadcast] ✅ systemMessages doc created — msgId=${msgRef.id}`);
    res.json({ ok: true, msgId: msgRef.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[broadcast] Error:", message);
    res.status(500).json({ ok: false, error: message });
  }
});

export default router;
