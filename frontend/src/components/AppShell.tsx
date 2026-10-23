"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { ChatSidebar } from "@/components/ChatSidebar";

type SessionState = "checking" | "signedOut" | "signedIn";

export const AppShell = () => {
  const [session, setSession] = useState<SessionState>("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [boardRefresh, setBoardRefresh] = useState(0);
  const sessionExpired = useCallback(() => {
    setSession("signedOut");
    setError("Session expired. Sign in again.");
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/session")
      .then((response) => {
        if (!response.ok) throw new Error("Session check failed");
        return response.json() as Promise<{ authenticated: boolean }>;
      })
      .then(({ authenticated }) => {
        if (active) setSession(authenticated ? "signedIn" : "signedOut");
      })
      .catch(() => {
        if (active) {
          setError("Could not check your session. Try signing in.");
          setSession("signedOut");
        }
      });
    return () => { active = false; };
  }, []);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError(response.status === 401 ? "Invalid username or password." : "Could not sign in.");
        return;
      }
      setPassword("");
      setSession("signedIn");
    } catch {
      setError("Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setError("");
    try {
      const response = await fetch("/api/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign out failed");
      setSession("signedOut");
    } catch {
      setError("Could not sign out. Try again.");
    }
  };

  if (session === "checking") {
    return <main className="flex min-h-screen items-center justify-center" role="status">Checking session...</main>;
  }

  if (session === "signedOut") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <form onSubmit={signIn} className="w-full max-w-md space-y-5 rounded-3xl border border-[var(--stroke)] bg-white p-8 shadow-[var(--shadow)]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--primary-blue)]">Kanban Studio</p>
            <h1 className="mt-3 font-display text-3xl font-semibold text-[var(--navy-dark)]">Sign in</h1>
          </div>
          <label className="block text-sm font-semibold text-[var(--navy-dark)]">
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required className="mt-2 w-full rounded-xl border border-[var(--stroke)] px-4 py-3 font-normal" />
          </label>
          <label className="block text-sm font-semibold text-[var(--navy-dark)]">
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="mt-2 w-full rounded-xl border border-[var(--stroke)] px-4 py-3 font-normal" />
          </label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-full bg-[var(--secondary-purple)] px-5 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Signing in..." : "Sign in"}</button>
        </form>
      </main>
    );
  }

  return (
    <>
      <div className="mx-auto flex max-w-[1500px] items-center justify-end gap-4 px-6 pt-4 text-sm text-[var(--gray-text)]">
        {error && <span role="alert" className="text-red-700">{error}</span>}
        <span>Signed in as user</span>
        <button type="button" onClick={signOut} className="rounded-full border border-[var(--stroke)] bg-white px-4 py-2 font-semibold text-[var(--navy-dark)]">Sign out</button>
      </div>
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-6 pb-16 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <KanbanBoard onSessionExpired={sessionExpired} refreshSignal={boardRefresh} />
        </div>
        <ChatSidebar onBoardChanged={() => setBoardRefresh((value) => value + 1)} />
      </div>
    </>
  );
};
