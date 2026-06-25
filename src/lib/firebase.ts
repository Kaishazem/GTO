import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error(
    "[firebase] Missing VITE_FIREBASE_* environment variables. " +
    "Add them to Replit Secrets and restart the server."
  );
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// enableIndexedDbPersistence can fail in multi-tab or restricted environments
// (e.g. Replit preview iframes). Catch and ignore — app still works without it.
enableIndexedDbPersistence(db).catch((err: { code?: string }) => {
  if (err.code === "failed-precondition") {
    console.warn("[firebase] IndexedDB persistence disabled: multiple tabs open.");
  } else if (err.code === "unimplemented") {
    console.warn("[firebase] IndexedDB persistence not supported in this browser.");
  } else {
    console.warn("[firebase] IndexedDB persistence error:", err);
  }
});

export default app;
