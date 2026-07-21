import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
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
      "Add them to Replit Secrets and restart the server.",
  );
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use the modern localCache API (replaces deprecated enableIndexedDbPersistence).
// persistentMultipleTabManager keeps offline support working across tabs.
// In restricted environments (Replit preview iframes, private browsing) the SDK
// automatically falls back to memory-only cache — no throw, no WSOD.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export default app;
