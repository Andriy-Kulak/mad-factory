import { PageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <PageSkeleton title="Competitor ads" stats={5} body="cards" sidebar />;
}
