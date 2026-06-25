import { createRoot } from "react-dom/client";
import { Component, ReactNode } from "react";
import App from "./App";
import "./index.css";

interface EBState { error: Error | null }
class RootErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null };
  static getDerivedStateFromError(error: Error): EBState { return { error }; }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const isFirebaseConfig = error.message?.includes("invalid-api-key") ||
      error.message?.includes("Firebase") ||
      error.message?.includes("api-key");
    return (
      <div style={{
        minHeight: "100vh", background: "#0f172a", display: "flex",
        alignItems: "center", justifyContent: "center", padding: "24px",
        fontFamily: "system-ui, sans-serif", color: "#e2e8f0"
      }}>
        <div style={{ maxWidth: "480px", textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "12px", color: "#f1f5f9" }}>
            {isFirebaseConfig ? "Firebase not configured" : "Something went wrong"}
          </h1>
          <p style={{ fontSize: "14px", color: "#94a3b8", lineHeight: "1.6", marginBottom: "16px" }}>
            {isFirebaseConfig
              ? "The Firebase API key is missing or invalid. Add the VITE_FIREBASE_* secrets to Replit Secrets and restart the server."
              : error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#3b82f6", color: "white", border: "none",
              padding: "8px 20px", borderRadius: "8px", cursor: "pointer", fontSize: "14px"
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
