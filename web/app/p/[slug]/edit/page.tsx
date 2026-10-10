import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { Shell } from "@/components/shell";
import { ButtonLink, Card } from "@/components/ui";
import { updateProduct } from "./actions";

export const dynamic = "force-dynamic";

const input = "control w-full h-auto py-2 leading-relaxed";

function Text({ name, label, value, rows = 3 }: { name: string; label: string; value: string | null; rows?: number }) {
  return (
    <label className="block">
      <span className="label block mb-1.5">{label}</span>
      <textarea name={name} defaultValue={value ?? ""} rows={rows} className={input} />
    </label>
  );
}

export default async function EditProduct({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getProductBySlug(slug);
  if (!p) notFound();
  const action = updateProduct.bind(null, p.id, p.slug);
  return (
    <Shell title="Edit profile" subtitle="One item per line for list fields" action={<ButtonLink href={`/p/${slug}/brand?doc=profile`}>Cancel</ButtonLink>}>
      <Card className="p-6 max-w-3xl">
        <form action={action} className="grid gap-5">
          <label className="block">
            <span className="label block mb-1.5">Name</span>
            <input name="name" defaultValue={p.name} required className="control w-full" />
          </label>
          <Text name="description" label="Description" value={p.description} />
          <Text name="target_audience" label="Target audience" value={p.target_audience} />
          <Text name="positioning" label="Positioning" value={p.positioning} />
          <Text name="tone" label="Tone" value={p.tone} rows={2} />
          <Text name="customer_desires" label="Customer desires (one per line)" value={p.customer_desires.join("\n")} rows={5} />
          <Text name="pain_points" label="Pain points (one per line)" value={p.pain_points.join("\n")} rows={5} />
          <Text name="competitors" label="Competitors (one per line)" value={p.competitors.join("\n")} rows={4} />
          <div><button className="btn btn-primary">Save</button></div>
        </form>
      </Card>
    </Shell>
  );
}
