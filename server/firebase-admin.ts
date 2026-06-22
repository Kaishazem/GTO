import admin from "firebase-admin";

let db: admin.firestore.Firestore | null = null;
let adminInitialized = false;

function initFirebaseAdmin() {
  if (adminInitialized) return;
  adminInitialized = true;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID;

  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!projectId) {
    console.warn("[Firebase Admin] FIREBASE_PROJECT_ID is not set. Firestore will be unavailable.");
    return;
  }

  if (!clientEmail || !rawKey) {
    console.warn(
      "[Firebase Admin] FIREBASE_ADMIN_CLIENT_EMAIL or FIREBASE_ADMIN_PRIVATE_KEY not set. " +
      "Firestore will be unavailable until credentials are provided."
    );
    return;
  }

  // Normalize the private key.
  // Step 1 — unescape any escaped newline variants and strip surrounding quotes.
  let privateKey = rawKey
    .replace(/^["']|["']$/g, "")   // strip surrounding quotes if present
    .replace(/\\\\n/g, "\n")       // double-escaped \\n → real newline
    .replace(/\\n/g, "\n")         // single-escaped \n → real newline
    .replace(/\r\n/g, "\n")        // CRLF → LF
    .trim();

  // Step 2 — if the key is still a single line (no real newlines), the secret was
  // stored with spaces instead of newlines (common when pasting a JSON key value
  // directly into Replit Secrets). Reconstruct proper PEM format from it.
  if (!privateKey.includes("\n")) {
    const match = privateKey.match(/-----BEGIN ([^-]+)-----\s*([\s\S]+?)\s*-----END \1-----/);
    if (match) {
      const keyType = match[1];
      const base64 = match[2].replace(/\s+/g, "");      // strip all whitespace from body
      const lines = base64.match(/.{1,64}/g) ?? [];     // reformat into 64-char lines
      privateKey = `-----BEGIN ${keyType}-----\n${lines.join("\n")}\n-----END ${keyType}-----\n`;
      console.log("[Firebase Admin] ℹ️ Private key was single-line — reformatted into proper PEM.");
    }
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        projectId,
      });
    }
    db = admin.firestore();
    console.log("[Firebase Admin] ✅ Initialized — project:", projectId);
  } catch (err) {
    console.error("[Firebase Admin] ❌ Initialization failed:", err);
  }
}

initFirebaseAdmin();

export { db, admin };
export default admin;
