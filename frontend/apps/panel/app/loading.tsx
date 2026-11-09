import { Skeleton } from "@repo/design-system/components/ui/skeleton";

const Loading = () => (
  <div className="flex flex-1 flex-col gap-4 p-4">
    <Skeleton className="h-12 w-full" />
    <Skeleton className="h-10 w-full" />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
    <Skeleton className="h-72 w-full" />
  </div>
);

export default Loading;
