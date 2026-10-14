import { PageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <PageSkeleton title="Favorites" stats={0} body="cards" />;
}
