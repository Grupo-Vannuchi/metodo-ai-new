/**
 * Indeterminate top progress bar. Rendered inside `loading.tsx` so it shows
 * while a route segment is loading, and disappears once the page is ready.
 */
export function LoadingBar() {
  return (
    <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-brand/15">
      <div className="h-full w-2/5 animate-progress rounded-full bg-brand" />
    </div>
  );
}
