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
 * Injects the brand palette from `siteConfig.theme` as CSS custom properties:
 * the light palette on `:root`, the dark one under the `.dark` class toggled by
 * the theme switch. Rendered in <head> so values exist before first paint.
 */
export function ThemeStyle() {
  const { light, dark } = siteConfig.theme;
  const css = `:root{${paletteVars(light)}}.dark{${paletteVars(dark)}}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
