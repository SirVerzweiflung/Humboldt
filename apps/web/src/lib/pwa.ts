import { useEffect, useState } from "react";

// TypeScript's DOM lib has no BeforeInstallPromptEvent — it is Chromium-only and
// unstandardised, so declare exactly the shape we use.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Registers the installability service worker (public/sw.js), production only.
// In dev a worker would sit between Vite's HMR and the page for no benefit.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is a nice-to-have; the quiz works fine without it.
    });
  });
}

function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS predates display-mode and exposes its own flag instead.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export type InstallPrompt = {
  canInstall: boolean;
  promptInstall: () => Promise<void>;
  isIOS: boolean;
  isStandalone: boolean;
};

// Install affordance state for the landing page. Chromium fires
// `beforeinstallprompt`, which we capture and replay on a user gesture; iOS
// fires nothing at all and needs a written instruction instead.
export function useInstallPrompt(): InstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(standalone);

  const isIOS =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // suppress Chrome's mini-infobar; we place our own button
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return {
    canInstall: deferred !== null && !isStandalone,
    isIOS,
    isStandalone,
    promptInstall: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      // The captured event is single-use, whatever the user chose.
      setDeferred(null);
    },
  };
}
