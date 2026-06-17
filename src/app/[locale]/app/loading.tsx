import { LoadingBar } from "@/components/ui/loading-bar";
import { Skeleton } from "@/components/ui/skeleton";

/** Shown in the app content area while a screen loads (sidebar stays put). */
export default function AppLoading() {
  return (
    <>
      <LoadingBar />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>

        <Skeleton className="h-72 w-full" />
      </div>
    </>
  );
}
