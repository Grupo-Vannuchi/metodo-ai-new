import { LoadingBar } from "@/components/ui/loading-bar";
import { Spinner } from "@/components/ui/spinner";

/** Fallback for public/auth routes while they load. */
export default function LocaleLoading() {
  return (
    <>
      <LoadingBar />
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-7 text-brand" />
      </div>
    </>
  );
}
