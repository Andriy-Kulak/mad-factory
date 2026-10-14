import { Shell } from "@/components/shell";
import { Empty } from "@/components/ui";

export function TabLoadError({ title, retry }: { title: string; retry: () => void }) {
  return (
    <Shell title={title}>
      <Empty>
        Couldn&apos;t load this tab.{" "}
        <button type="button" onClick={retry} className="btn ml-2">
          Retry
        </button>
      </Empty>
    </Shell>
  );
}
