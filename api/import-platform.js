// api/import-platform.js

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { platformName, firebaseProjectId, firebaseApiKey } = req.body;

    if (!platformName || !firebaseProjectId || !firebaseApiKey) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // 1. جلب بيانات المنصة من Firestore
    const platformDoc = await fetch(
      `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/platforms/${platformName}?key=${firebaseApiKey}`
    ).then(r => r.json());

    if (!platformDoc.fields) {
      return res.status(404).json({ error: 'Platform not found in database' });
    }

    // 2. استخراج المفاتيح والـ API URL
    const apiKey = platformDoc.fields.apiKey?.stringValue || 
                   platformDoc.fields.adgemApiKey?.stringValue ||
                   platformDoc.fields.lootablyKey?.stringValue;
    const appId = platformDoc.fields.appId?.stringValue || 
                  platformDoc.fields.adgemAppId?.stringValue;
    const apiBase = platformDoc.fields.apiBase?.stringValue;
    const postbackKey = platformDoc.fields.postbackKey?.stringValue || 
                       platformDoc.fields.adgemPostbackKey?.stringValue;

    if (!apiKey) {
      return res.status(400).json({ error: 'Missing API key in platform document' });
    }

    // 3. الاتصال بـ API المنصة
    let apiUrl = '';
    if (platformName.toLowerCase() === 'adgem') {
      apiUrl = `https://api.adgem.com/v1/offers?app_id=${appId}`;
    } else if (apiBase) {
      apiUrl = `${apiBase}?api_key=${apiKey}&limit=50`;
    } else {
      return res.status(400).json({ error: 'Missing API base URL' });
    }

    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const offers = data.offers || data.data || [];

    // 4. حفظ العروض في Firestore
    let imported = 0;
    let skipped = 0;

    for (const offer of offers) {
      const externalId = String(offer.id || offer.offer_id || '');

      // التحقق من عدم التكرار
      const existingTask = await fetch(
        `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/tasks?key=${firebaseApiKey}&where={"fieldPath":{"fieldId":"externalId"},"op":"EQUAL","value":{"stringValue":externalId}}`
      ).then(r => r.json());

      if (existingTask.documents && existingTask.documents.length > 0) {
        skipped++;
        continue;
      }

      const task = {
        fields: {
          platform: { stringValue: platformName },
          title: { stringValue: offer.name || offer.title || 'Unknown Offer' },
          description: { stringValue: offer.description || '' },
          payout: { doubleValue: parseFloat(offer.payout) || 0 },
          url: { stringValue: offer.url || offer.link || '' },
          externalId: { stringValue: externalId },
          network: { stringValue: platformName },
          status: { stringValue: 'active' },
          postbackKey: { stringValue: postbackKey || '' },
          createdAt: { stringValue: new Date().toISOString() },
        }
      };

      const firestoreRes = await fetch(
        `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/tasks?key=${firebaseApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(task),
        }
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
      offers
    });

  } catch (error) {
    console.error('Import error:', error);
    return res.status(500).json({ error: error.message });
  }
}