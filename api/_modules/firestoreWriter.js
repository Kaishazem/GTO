// modules/firestoreWriter.js — Firestore document writer (v2)
// Single responsibility: persist canonical Task objects to the Firestore tasks
// collection via the REST API, with deduplication (externalId) and upsert logic.

/**
 * Encode a JS value to a Firestore REST API field value object.
 */
function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean')        return { booleanValue: v };
  if (typeof v === 'number')         return { doubleValue: v };
  if (Array.isArray(v))              return { arrayValue: { values: v.map(fsValue) } };
  return { stringValue: String(v) };
}

/**
 * Write an array of canonical Task objects to Firestore.
 * Skips tasks whose externalId already exists in the tasks collection.
 *
 * @param {Array}  tasks      - Canonical Task objects from normalizer.js
 * @param {string} projectId  - Firebase project ID
 * @param {string} apiKey     - Firebase web API key
 * @param {Object} [logger]   - Optional logger (from logger.js)
 * @returns {{ imported: number, skipped: number, errors: number }}
 */
export async function writeOffers(tasks, projectId, apiKey, logger) {
  const fsBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const key    = `?key=${apiKey}`;

  let imported = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const task of tasks) {
    try {
      // ── Deduplication: check for existing externalId ─────────────────────
      const queryRes = await fetch(`${fsBase}:runQuery${key}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from:  [{ collectionId: 'tasks' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'externalId' },
                op:    'EQUAL',
                value: { stringValue: task.externalId },
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

      // ── Insert canonical Task document ────────────────────────────────────
      const taskDoc = {
        fields: {
          externalId:     fsValue(task.externalId),
          platform:       fsValue(task.platform),
          platformId:     fsValue(task.platformId),
          title:          fsValue(task.title),
          description:    fsValue(task.description),
          payout:         fsValue(task.payout),
          url:            fsValue(task.url),
          image:          fsValue(task.image),
          category:       fsValue(task.category),
          countries:      fsValue(task.countries),
          devices:        fsValue(task.devices),
          requirements:   fsValue(task.requirements),
          trackingUrl:    fsValue(task.trackingUrl),
          previewUrl:     fsValue(task.previewUrl),
          conversionType: fsValue(task.conversionType),
          status:         fsValue(task.status || 'active'),
          createdAt:      fsValue(task.createdAt || new Date().toISOString()),
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
        logger?.warn(`Failed to insert task ${task.externalId}: HTTP ${insertRes.status}`);
      }
    } catch (err) {
      errors++;
      logger?.warn(`Error writing task ${task.externalId}: ${err.message}`);
    }
  }

  return { imported, skipped, errors };
}
