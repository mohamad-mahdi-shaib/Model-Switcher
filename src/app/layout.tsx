import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Workspace",
  description: "Creative Model-Switcher AI Interface",
};

// Responsive UI refinement: without this, some mobile browsers overlay the
// on-screen keyboard on top of the page instead of shrinking the viewport
// for it, which -- combined with `h-dvh` on the workspace root -- could
// leave the composer hidden behind the keyboard rather than pushed above
// it. `resizes-content` is the current CSS Viewport spec's explicit way to
// ask for the shrink-to-fit behavior; unsupported browsers simply ignore it
// and keep their own default, so this is a strict improvement, never a
// regression, where it is not recognized.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  // Required for `env(safe-area-inset-*)` to resolve to anything other than
  // 0 (the mobile drawer and composer use it to clear a device's notch/home
  // indicator) -- without `cover`, the browser never extends layout under
  // those areas in the first place, so the env() variables stay zero and
  // the CSS using them would silently do nothing.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
