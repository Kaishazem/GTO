import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "./components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TaskProvider } from "@/contexts/TaskContext";
import { WalletProvider } from "@/contexts/WalletContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Layout from "@/components/Layout";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import DashboardPage from "@/pages/DashboardPage";
import TasksPage from "@/pages/TasksPage";
import WalletPage from "@/pages/WalletPage";
import AdminPage from "@/pages/AdminPage";
import AdminUsersPage from "@/pages/AdminUsersPage";
import ProfilePage from "@/pages/ProfilePage";
import NotFound from "@/pages/not-found";
import { Loader2, ShieldX } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Prevent unhandled promise rejections from surfacing as WSOD
      throwOnError: false,
      retry: 1,
    },
  },
});

function BannedScreen() {
  const { banReason } = useAuth();
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-5">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-red-500/15 border border-red-500/30 flex items-center justify-center">
          <ShieldX className="w-10 h-10 text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Account Banned</h1>
          <p className="text-white/70 text-sm mt-3 leading-relaxed font-medium">
            {banReason ||
              "This account has been permanently banned from Green Task Orbit due to a violation of our terms of service."}
          </p>
          <p className="text-white/30 text-xs mt-4">
            If you believe this is an error, contact support.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute({
  component: Component,
  adminOnly = false,
}: {
  component: React.ComponentType;
  adminOnly?: boolean;
}) {
  const { user, profile, loading, deviceBanned } = useAuth();

  if (deviceBanned) return <BannedScreen />;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (!user || !user.emailVerified) return <Redirect to="/login" />;
  if (adminOnly && profile?.role !== "admin") return <Redirect to="/dashboard" />;

  return (
    <Layout>
      <ErrorBoundary section={Component.displayName ?? Component.name}>
        <Component />
      </ErrorBoundary>
    </Layout>
  );
}

function PublicRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, profile, loading, deviceBanned } = useAuth();

  if (deviceBanned) return <BannedScreen />;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (user) return <Redirect to={profile?.role === "admin" ? "/admin" : "/dashboard"} />;
  return (
    <ErrorBoundary section={Component.displayName ?? Component.name}>
      <Component />
    </ErrorBoundary>
  );
}

function UserOnlyRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, profile, loading, deviceBanned } = useAuth();

  if (deviceBanned) return <BannedScreen />;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (!user || !user.emailVerified) return <Redirect to="/login" />;
  if (profile?.role === "admin") return <Redirect to="/admin" />;

  return (
    <Layout>
      <ErrorBoundary section={Component.displayName ?? Component.name}>
        <Component />
      </ErrorBoundary>
    </Layout>
  );
}

function AppRoutes() {
  const { loading, deviceBanned } = useAuth();

  // ── Global auth gate ──────────────────────────────────────────────────────
  // Block ALL route rendering until Firebase Auth has fired onAuthStateChanged
  // AND the Firestore profile has been fetched. This is the single source of
  // truth that eliminates every flicker: no route guard ever runs with a
  // partially-resolved auth state.
  if (deviceBanned) return <BannedScreen />;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/login" />} />
      <Route path="/login" component={() => <PublicRoute component={LoginPage} />} />
      <Route path="/register" component={() => <PublicRoute component={RegisterPage} />} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/tasks" component={() => <ProtectedRoute component={TasksPage} />} />
      <Route path="/wallet" component={() => <UserOnlyRoute component={WalletPage} />} />
      <Route path="/profile" component={() => <ProtectedRoute component={ProfilePage} />} />
      <Route path="/admin" component={() => <ProtectedRoute component={AdminPage} adminOnly />} />
      <Route
        path="/admin/users"
        component={() => <ProtectedRoute component={AdminUsersPage} adminOnly />}
      />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary section="Auth">
          <AuthProvider>
            <ErrorBoundary section="Tasks">
              <TaskProvider>
                <ErrorBoundary section="Wallet">
                  <WalletProvider>
                    <ErrorBoundary section="Notifications">
                      <NotificationProvider>
                        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                          <AppRoutes />
                        </WouterRouter>
                        <Toaster />
                      </NotificationProvider>
                    </ErrorBoundary>
                  </WalletProvider>
                </ErrorBoundary>
              </TaskProvider>
            </ErrorBoundary>
          </AuthProvider>
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
