import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PRODUCT_COOKIE } from "@/components/nav";
import { listProductNames } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Landing: back to the last product viewed (else the first one), or explain how to create one. */
export default async function Home() {
  const [products, jar] = await Promise.all([listProductNames(), cookies()]);
  const last = jar.get(PRODUCT_COOKIE)?.value;
  const target = products.find((p) => p.slug === last) ?? products[0];
  if (target) redirect(`/p/${target.slug}`);
  return (
    <main className="min-h-screen grid place-items-center p-8">
      <div className="max-w-md text-center">
        <div className="text-lg font-semibold">No products yet</div>
        <p className="text-fg-2 mt-2">
          A product is what you market: an app, a store, a service. Create one from the CLI, then reload:
        </p>
        <pre className="num text-xs bg-bg-2 border border-line rounded-[3px] p-3 mt-4 text-left">pnpm product create --file examples/product.example.json</pre>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/" className="btn btn-primary">Reload</Link>
          <Link href="/setup" className="btn">Check setup</Link>
        </div>
      </div>
    </main>
  );
}
