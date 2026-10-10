import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getProductBySlug, getTrackedSources, listProductNames } from "@/lib/queries";
import { channelSetup, navNeedingSetup } from "@/lib/setup";
import { AppFrame } from "@/components/app-frame";
import { currentUser } from "@/lib/auth/server";
import { SIDEBAR_COOKIE } from "@/components/nav";

/** Product-scoped frame: top bar + sidebar persist while pages under it change. */
export default async function ProductLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [products, product, jar, user] = await Promise.all([listProductNames(), getProductBySlug(slug), cookies(), currentUser()]);
  if (!product) notFound();
  const needsSetup = navNeedingSetup(channelSetup(product.slug, await getTrackedSources(product.id)));
  return (
    <AppFrame products={products} current={{ slug: product.slug, name: product.name }} defaultCollapsed={jar.get(SIDEBAR_COOKIE)?.value === "1"} user={user} needsSetup={needsSetup}>
      {children}
    </AppFrame>
  );
}
