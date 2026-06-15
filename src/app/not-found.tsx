import Link from "next/link";

/**
 * Global fallback for requests that don't match any locale segment. Renders its
 * own document because it lives above the locale root layout.
 */
export default function GlobalNotFound() {
  return (
    <html lang="pt">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <h1 style={{ fontSize: "2rem", fontWeight: 700 }}>404 — Não encontrado</h1>
        <p style={{ color: "#666" }}>Esta página não pôde ser encontrada.</p>
        <Link href="/" style={{ color: "#4f46e5", fontWeight: 600 }}>
          Voltar ao início
        </Link>
      </body>
    </html>
  );
}
