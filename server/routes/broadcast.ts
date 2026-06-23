import { Router, Request, Response } from "express";
import { db } from "../firebase-admin";
import * as admin from "firebase-admin";

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
    const msgRef = await db.collection("systemMessages").add({
      title: title.trim(),
      message: message.trim(),
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sentBy: sentBy || "admin",
    });

    const usersSnap = await db.collection("users").select("uid").get();
    const userIds = usersSnap.docs.map((d) => d.id);

    const BATCH_SIZE = 500;
    let delivered = 0;

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = userIds.slice(i, i + BATCH_SIZE);

      for (const uid of chunk) {
        const dedupeKey = `sysmsg_${msgRef.id}`;
        const safeKey = dedupeKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
        const uidPrefix = uid.slice(0, 12);
        const docId = `${uidPrefix}_${safeKey}`;
        const notifRef = db.collection("notifications").doc(docId);

        batch.set(
          notifRef,
          {
            userId: uid,
            type: "system_message",
            title: title.trim(),
            message: message.trim(),
            icon: "📢",
            taskId: null,
            completionId: null,
            dedupeKey,
            read: false,
            deletedForUser: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: false }
        );
        delivered++;
      }

      await batch.commit();
    }

    console.log(`[broadcast] ✅ Message sent to ${delivered} users — msgId=${msgRef.id}`);
    res.json({ ok: true, msgId: msgRef.id, delivered });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[broadcast] Error:", message);
    res.status(500).json({ ok: false, error: message });
  }
});

export default router;
