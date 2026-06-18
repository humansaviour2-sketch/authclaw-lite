"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Cpu,
  ShieldAlert,
  Bot,
  Award,
  ScrollText,
  Settings,
  Menu,
  X,
  ChevronDown,
  LogOut,
  User,
  Building,
  ShieldCheck,
  Cloud,
} from "lucide-react";

interface ConsoleShellProps {
  children: React.ReactNode;
  userEmail: string;
  tenantId: string;
  tenantName: string;
}

export default function ConsoleShell({ children, userEmail, tenantId, tenantName }: ConsoleShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  const navigation = [
    { name: "Overview", href: "/overview", icon: LayoutDashboard },
    { name: "Gateway", href: "/gateway", icon: Cpu },
    { name: "Policies", href: "/policies", icon: ShieldAlert },
    { name: "Compliance Agent", href: "/agent", icon: Bot },
    { name: "Frameworks", href: "/frameworks", icon: Award },
    { name: "Audit", href: "/audit", icon: ScrollText },
    // Phase 14: AWS Connector
    { name: "AWS Connectors", href: "/aws", icon: Cloud },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error("Failed to log out:", error);
    }
  };

  return (
    <div className="min-h-screen bg-[#07070a] text-slate-100 flex flex-col font-sans">
      {/* Top Mobile Header */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-[#0d0d13] border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm text-white">AuthClaw</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="text-slate-400 hover:text-white focus:outline-none"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </header>

      <div className="flex flex-1 relative">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex flex-col w-64 bg-[#09090d] border-r border-slate-800/80">
          <div className="h-16 flex items-center gap-2.5 px-6 border-b border-slate-800/60">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <ShieldCheck className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="font-bold text-base text-white tracking-wide">AuthClaw Console</span>
          </div>

          <nav className="flex-1 px-4 py-6 space-y-1.5">
            {navigation.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                    active
                      ? "bg-indigo-600/15 text-indigo-400 border-l-2 border-indigo-500"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <item.icon className={`w-4.5 h-4.5 ${active ? "text-indigo-400" : "text-slate-500"}`} />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Tenant Indicator in Sidebar Footer */}
          <div className="p-4 border-t border-slate-800/60 bg-[#07070a]/40">
            <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-[#0e0e15] border border-slate-800/60">
              <Building className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <div className="overflow-hidden">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Active Tenant</p>
                <p className="text-xs font-medium text-slate-300 truncate">{tenantName || tenantId}</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
            <aside className="relative flex flex-col w-64 max-w-xs bg-[#09090d] h-full border-r border-slate-800 shadow-2xl">
              <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center">
                    <ShieldCheck className="w-4.5 h-4.5 text-white" />
                  </div>
                  <span className="font-bold text-white">AuthClaw</span>
                </div>
                <button onClick={() => setMobileMenuOpen(false)} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="flex-1 px-4 py-6 space-y-1">
                {navigation.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        active
                          ? "bg-indigo-600/15 text-indigo-400 border-l-2 border-indigo-500"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                      }`}
                    >
                      <item.icon className="w-4.5 h-4.5" />
                      {item.name}
                    </Link>
                  );
                })}
              </nav>

              <div className="p-4 border-t border-slate-800">
                <div className="flex items-center gap-2.5 px-2 py-1.5 rounded bg-[#0d0d13] mb-4">
                  <Building className="w-4 h-4 text-slate-500" />
                  <div className="overflow-hidden">
                    <p className="text-[10px] uppercase font-semibold text-slate-500">Tenant</p>
                    <p className="text-xs font-medium text-slate-300 truncate">{tenantName || tenantId}</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 text-sm font-medium transition"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </aside>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#07070a]">
          {/* Desktop Top Header */}
          <header className="hidden md:flex h-16 items-center justify-between px-8 bg-[#09090d]/60 border-b border-slate-800/40 backdrop-blur-md sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <span className="text-slate-500 text-sm">Dashboard</span>
              <span className="text-slate-700">/</span>
              <span className="text-slate-200 text-sm font-medium capitalize">
                {pathname?.replace("/", "") || "Overview"}
              </span>
            </div>

            {/* Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-[#0e0e15]/40 hover:bg-[#0e0e15]/80 hover:border-slate-700/80 transition-all duration-150"
              >
                <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 flex items-center justify-center text-[10px] font-bold text-indigo-400">
                  {userEmail.slice(0, 2).toUpperCase()}
                </div>
                <span className="text-xs font-medium text-slate-300">{userEmail}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {profileDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setProfileDropdownOpen(false)} />
                  <div className="absolute right-0 mt-2 w-48 rounded-lg bg-[#0e0e15] border border-slate-800 shadow-2xl py-1 z-40 transform origin-top-right transition-all duration-100">
                    <div className="px-4 py-2 border-b border-slate-800/60">
                      <p className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">Signed In As</p>
                      <p className="text-xs text-slate-300 truncate font-medium mt-0.5">{userEmail}</p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/5 hover:text-red-300 transition-colors duration-150"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </header>

          {/* Child Page Rendering */}
          <main className="flex-1 overflow-auto p-6 md:p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
