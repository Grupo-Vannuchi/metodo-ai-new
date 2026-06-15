import { siteConfig, type ThemePalette } from "@/config/site";

function paletteVars(palette: ThemePalette): string {
  return [
    `--brand:${palette.brand}`,
    `--brand-foreground:${palette.brandForeground}`,
    `--accent:${palette.accent}`,
    `--background:${palette.background}`,
    `--foreground:${palette.foreground}`,
  ].join(";");
}

/**
 * Injects the brand palette from `siteConfig.theme` as CSS custom properties on
 * `:root`, with a `prefers-color-scheme` override for dark mode. Rendered in the
 * document <head> so the values are present before first paint (no flash).
 */
export function ThemeStyle() {
  const { light, dark } = siteConfig.theme;
  const css = `:root{${paletteVars(light)}}@media (prefers-color-scheme:dark){:root{${paletteVars(dark)}}}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
