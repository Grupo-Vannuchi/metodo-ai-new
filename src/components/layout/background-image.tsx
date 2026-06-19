"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const DEFAULT_IMAGES = [
  "/backgrounds/office-1.jpg",
  "/backgrounds/office-2.jpg",
  "/backgrounds/office-3.jpg",
  "/backgrounds/office-4.jpg",
  "/backgrounds/office-5.jpg",
  "/backgrounds/office-6.jpg",
];

const INTERVAL_MS = 8000;

/**
 * Decorative full-bleed background slideshow: corporate stock photos
 * (self-hosted, Unsplash License) heavily blurred and washed with a theme-tinted
 * overlay so they stay subtle and keep text readable. The images cross-fade
 * every few seconds; honors prefers-reduced-motion (stays on the first image).
 * Fixed behind the page content (`-z-10`).
 */
export function BackgroundImage({
  images = DEFAULT_IMAGES,
  className,
}: {
  images?: string[];
  className?: string;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (images.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % images.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, [images.length]);

  return (
    <div aria-hidden className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}>
      {images.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- decorative, self-hosted background
        <img
          key={src}
          src={src}
          alt=""
          className={cn(
            "absolute inset-0 size-full scale-110 object-cover blur-xl transition-opacity duration-[2000ms] ease-in-out",
            i === index ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
      <div className="absolute inset-0 bg-background/75" />
    </div>
  );
}
