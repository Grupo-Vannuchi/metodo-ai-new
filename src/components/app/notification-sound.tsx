"use client";

import { useEffect, useRef } from "react";
import { useRealtime } from "@/components/app/realtime-provider";

export const SOUND_MUTED_KEY = "notif_sound_muted";

type AudioCtor = typeof AudioContext;

/**
 * Plays a gentle chime when the unread-notification count *increases* — even
 * when the tab is in the background (WhatsApp-style). Mounted once in the shell.
 *
 * "Intelligent": only fires on a genuine increase (not on mark-as-read or
 * reconnect resyncs), throttled, never on first load, and respects the mute
 * toggle. The sound is synthesized via the Web Audio API (no asset), and the
 * AudioContext is unlocked on the first user gesture so it can play from a
 * backgrounded tab.
 */
export function NotificationSound() {
  const prevTotal = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const lastPlayed = useRef(0);

  // Unlock audio on the first user gesture (browsers block audio until then).
  useEffect(() => {
    const unlock = () => {
      if (!ctxRef.current) {
        const Ctor: AudioCtor | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
        if (Ctor) ctxRef.current = new Ctor();
      }
      void ctxRef.current?.resume();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  function playChime() {
    if (localStorage.getItem(SOUND_MUTED_KEY) === "1") return;
    const now = Date.now();
    if (now - lastPlayed.current < 1500) return; // throttle bursts
    lastPlayed.current = now;

    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== "running") return;

    // Two soft sine notes (A5 → D6) with a quick decay — a pleasant "ding".
    const t0 = ctx.currentTime;
    for (const note of [{ f: 880, at: 0 }, { f: 1174.66, at: 0.11 }]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = note.f;
      gain.gain.setValueAtTime(0.0001, t0 + note.at);
      gain.gain.linearRampToValueAtTime(0.16, t0 + note.at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + note.at);
      osc.stop(t0 + note.at + 0.4);
    }
  }

  // Refs only (no setState), so this is safe to call directly from effects.
  function check() {
    void (async () => {
      try {
        const r = await fetch("/api/notifications", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as { total?: number };
        const total = data.total ?? 0;
        if (prevTotal.current !== null && total > prevTotal.current) playChime();
        prevTotal.current = total;
      } catch {
        /* ignore */
      }
    })();
  }

  // Establish the baseline once; subsequent increases ring.
  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtime("notifications", check);

  return null;
}
