// modules/firestoreWriter.js — Firestore document writer
// Single responsibility: persist normalised offers to the Firestore tasks
// collection via the REST API, handling deduplication and upsert logic.
// Uses the same REST approach as the existing postback.js handler.

/**
 * Write an array of normalised offers to Firestore.
 * Skips offers whose externalId already exists in the tasks collection.
 *
 * @param {Array}  offers         - Normalised offer objects from normalizer.js
 * @param {string} projectId      - Firebase project ID
 * @param {string} apiKey         - Firebase web API key
 * @param {Object} [logger]       - Optional logger (from logger.js)
 * @returns {{ imported: number, skipped: number, errors: number }}
 */
export async function writeOffers(offers, projectId, apiKey, logger) {
  const fsBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const key    = `?key=${apiKey}`;

  let imported = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const offer of offers) {
    try {
      // Deduplication: check if a task with this externalId already exists
      const queryRes = await fetch(`${fsBase}:runQuery${key}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          structuredQuery: {
            from:  [{ collectionId: 'tasks' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'externalId' },
                op:    'EQUAL',
                value: { stringValue: offer.externalId },
              },
            },
            limit: 1,
          },
        }),
      });

      const queryData = await queryRes.json();
      if (Array.isArray(queryData) && queryData[0]?.document?.name) {
        skipped++;
        continue;
      }

      // Insert new task document
      const taskDoc = {
        fields: {
          externalId:  { stringValue: offer.externalId },
          platform:    { stringValue: offer.platform },
          platformId:  { stringValue: offer.platformId },
          title:       { stringValue: offer.title },
          description: { stringValue: offer.description },
          payout:      { doubleValue: offer.payout },
          url:         { stringValue: offer.url },
          status:      { stringValue: 'active' },
          createdAt:   { stringValue: new Date().toISOString() },
        },
      };

      const insertRes = await fetch(`${fsBase}/tasks${key}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(taskDoc),
      });

      if (insertRes.ok) {
        imported++;
      } else {
        errors++;
        logger?.warn(`Failed to insert offer ${offer.externalId}: HTTP ${insertRes.status}`);
      }
    } catch (err) {
      errors++;
      logger?.warn(`Error writing offer ${offer.externalId}: ${err.message}`);
    }
  }

  return { imported, skipped, errors };
}
