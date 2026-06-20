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

  const privateKey = rawKey.replace(/\\n/g, "\n");

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
