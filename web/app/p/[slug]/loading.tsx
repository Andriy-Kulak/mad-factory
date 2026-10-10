import { PageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <PageSkeleton title="Overview" stats={4} body="table" />;
}
