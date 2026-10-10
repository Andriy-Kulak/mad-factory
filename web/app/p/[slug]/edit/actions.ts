"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/server";
import { getDb } from "@/lib/db";

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const text = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
};

export async function updateProduct(id: string, slug: string, form: FormData): Promise<void> {
  await requireOwner();
  const res = await getDb()
    .from("products")
    .update({
      name: String(form.get("name") ?? "").trim() || undefined,
      description: text(form.get("description")),
      target_audience: text(form.get("target_audience")),
      positioning: text(form.get("positioning")),
      tone: text(form.get("tone")),
      customer_desires: lines(form.get("customer_desires")),
      pain_points: lines(form.get("pain_points")),
      competitors: lines(form.get("competitors")),
    })
    .eq("id", id);
  if (res.error) throw new Error(res.error.message);
  revalidatePath(`/p/${slug}`);
  redirect(`/p/${slug}/brand?doc=profile`);
}
