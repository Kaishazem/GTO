import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

export default function NotFound() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white" dir="rtl">
      <div className="text-center">
        <div className="text-8xl font-bold text-white/10 mb-4">404</div>
        <h1 className="text-2xl font-bold mb-2">الصفحة غير موجودة</h1>
        <p className="text-white/50 mb-6">الصفحة التي تبحث عنها غير موجودة</p>
        <Button onClick={() => setLocation("/")} className="bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl">
          <Home className="w-4 h-4 ml-2" />
          العودة للرئيسية
        </Button>
      </div>
    </div>
  );
}
