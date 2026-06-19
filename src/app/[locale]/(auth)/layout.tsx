import { ThemeToggle } from "@/components/theme-toggle";
import { BackgroundImage } from "@/components/layout/background-image";

export const metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <BackgroundImage src="/backgrounds/office-1.jpg" />
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/90 p-8 shadow-xl backdrop-blur-md animate-fade-in-up">
        {children}
      </div>
    </div>
  );
}
