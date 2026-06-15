import { Link } from "@/i18n/navigation";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-3xl font-bold tracking-tight">Página não encontrada</h1>
      <Link
        href="/"
        className="rounded-lg bg-brand px-5 py-3 font-medium text-brand-foreground transition-opacity hover:opacity-90"
      >
        Voltar ao início
      </Link>
    </main>
  );
}
