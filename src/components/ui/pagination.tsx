"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
  total,
  pageSize,
}: {
  total: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.ceil(total / pageSize);
  const currentPage = Number(searchParams.get("page")) || 1;

  if (totalPages <= 1) return null;

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(page));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3 sm:px-6">
      <div className="flex flex-1 justify-between sm:hidden">
        <Button
          type="button"
          variant="outline"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Anterior
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Próxima
        </Button>
      </div>
      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Mostrando <span className="font-medium">{(currentPage - 1) * pageSize + 1}</span> até{" "}
            <span className="font-medium">{Math.min(currentPage * pageSize, total)}</span> de{" "}
            <span className="font-medium">{total}</span> resultados
          </p>
        </div>
        <div>
          <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="relative inline-flex items-center rounded-l-md border border-border bg-card px-2 py-2 text-muted-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Anterior</span>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <span className="relative inline-flex items-center border border-border bg-card px-4 py-2 text-sm font-semibold">
              Página {currentPage} de {totalPages}
            </span>
            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="relative inline-flex items-center rounded-r-md border border-border bg-card px-2 py-2 text-muted-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="sr-only">Próxima</span>
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
}
