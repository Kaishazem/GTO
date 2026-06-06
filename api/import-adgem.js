// api/import-adgem.js

const ADGEM_API_URL = "https://api.adgem.com/v1/offers";

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { platformName, firebaseProjectId, firebaseApiKey } = req.body;

    if (!platformName || !firebaseProjectId || !firebaseApiKey) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // 1. جلب بيانات المنصة من Firestore
    const platformDoc = await fetch(
      `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/platforms/${platformName}?key=${firebaseApiKey}`,
    ).then((r) => r.json());

    if (!platformDoc.fields) {
      return res.status(404).json({ error: "Platform not found in database" });
    }

    // 2. استخراج المفاتيح
    const adgemApiKey = platformDoc.fields.adgemApiKey?.stringValue;
    const appId = platformDoc.fields.adgemAppId?.stringValue;
    const postbackKey = platformDoc.fields.adgemPostbackKey?.stringValue;

    if (!adgemApiKey || !appId) {
      return res
        .status(400)
        .json({ error: "Missing AdGem credentials in platform document" });
    }

    // 3. جلب العروض من AdGem
    const adgemResponse = await fetch(`${ADGEM_API_URL}?app_id=${appId}`, {
      headers: {
        Authorization: `Bearer ${adgemApiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!adgemResponse.ok) {
      throw new Error(`AdGem API error: ${adgemResponse.status}`);
    }

    const adgemData = await adgemResponse.json();
    const offers = adgemData.offers || adgemData.data || [];

    // 4. حفظ العروض في Firestore
    let imported = 0;
    let skipped = 0;

    for (const offer of offers) {
      const externalId = String(offer.id || offer.offer_id || "");

      // التحقق مما إذا كانت المهمة موجودة مسبقاً
      const existingTask = await fetch(
        `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/tasks?key=${firebaseApiKey}&where={"fieldPath":{"fieldId":"externalId"},"op":"EQUAL","value":{"stringValue":externalId}}`,
      ).then((r) => r.json());

      if (existingTask.documents && existingTask.documents.length > 0) {
        skipped++;
        continue;
      }

      const task = {
        fields: {
          platform: { stringValue: "AdGem" },
          title: { stringValue: offer.name || offer.title || "Unknown Offer" },
          description: { stringValue: offer.description || "" },
          payout: { doubleValue: parseFloat(offer.payout) || 0 },
          url: { stringValue: offer.url || offer.link || "" },
          externalId: { stringValue: externalId },
          network: { stringValue: "AdGem" },
          status: { stringValue: "active" },
          postbackKey: { stringValue: postbackKey || "" },
          createdAt: { stringValue: new Date().toISOString() },
        },
      };

      const firestoreRes = await fetch(
        `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/tasks?key=${firebaseApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(task),
        },
      );

      if (firestoreRes.ok) {
        imported++;
      }
    }

    return res.status(200).json({
      success: true,
      totalOffers: offers.length,
      imported,
      skipped,
      message: `Imported ${imported} offers, skipped ${skipped} duplicates`,
    });
  } catch (error) {
    console.error("AdGem import error:", error);
    return res.status(500).json({ error: error.message });
  }
}
