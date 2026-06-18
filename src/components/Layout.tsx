import { useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, ListTodo, Wallet, LogOut, ShieldCheck, Menu, X, UserCircle, Fingerprint } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import NotificationCenter from "@/components/NotificationCenter";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className="w-5 h-5" /> },
  { label: "Tasks", href: "/tasks", icon: <ListTodo className="w-5 h-5" /> },
  { label: "Wallet", href: "/wallet", icon: <Wallet className="w-5 h-5" /> },
  { label: "Profile", href: "/profile", icon: <UserCircle className="w-5 h-5" /> },
  { label: "Admin", href: "/admin", icon: <ShieldCheck className="w-5 h-5" />, adminOnly: true },
  { label: "Devices", href: "/admin/users", icon: <Fingerprint className="w-5 h-5" />, adminOnly: true },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { profile, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleNav = navItems.filter((n) => {
    if (n.adminOnly && profile?.role !== "admin") return false;
    if (n.href === "/wallet" && profile?.role === "admin") return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Top bar */}
      <header className="fixed top-0 inset-x-0 z-50 bg-slate-900/80 backdrop-blur-xl border-b border-white/10 h-16 flex items-center px-4 md:px-6">
        <div className="flex items-center gap-3 flex-1">
          <span className="text-xl">🎯</span>
          <div className="flex flex-col leading-tight">
            <span className="text-lg font-bold text-red-500 tracking-widest leading-none">GTO</span>
            <span className="text-xs font-normal text-white/60 tracking-wide leading-none">Green Task Orbit</span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-1">
          {visibleNav.map((n) => (
            <Link key={n.href} href={n.href}>
              <button
                data-testid={`nav-${n.href.slice(1)}`}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                  location === n.href
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                )}
              >
                {n.icon}
                {n.label}
              </button>
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-4">
          <NotificationCenter />
          <div className="hidden md:flex flex-col items-end">
            <span className="text-sm font-medium text-white">{profile?.name}</span>
            {profile && (
              <span className="text-xs text-emerald-400">
                {profile.role === "admin" ? "Admin" : "Member"}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            data-testid="button-logout"
            className="hidden md:flex items-center gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
          <button
            className="md:hidden text-white/70 hover:text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
            data-testid="button-mobile-menu"
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/95 backdrop-blur-xl pt-16 flex flex-col p-6 md:hidden">
          <div className="text-center mb-6">
            <p className="font-semibold text-white">{profile?.name}</p>
            <p className="text-sm text-emerald-400">{profile?.email}</p>
          </div>
          <nav className="flex flex-col gap-2">
            {visibleNav.map((n) => (
              <Link key={n.href} href={n.href}>
                <button
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "w-full flex items-center gap-3 px-5 py-4 rounded-xl text-base font-medium transition-all",
                    location === n.href
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  )}
                >
                  {n.icon}
                  {n.label}
                </button>
              </Link>
            ))}
          </nav>
          <div className="mt-auto">
            <Button
              variant="ghost"
              onClick={() => { logout(); setMobileOpen(false); }}
              className="w-full flex items-center gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 py-4"
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </Button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="pt-16 min-h-screen">
        <div className="max-w-5xl mx-auto p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
