import { cookies } from "next/headers";
import { AppFrame } from "@/components/app-frame";
import { Shell } from "@/components/shell";
import { SIDEBAR_COOKIE } from "@/components/nav";
import { Button, Stat } from "@/components/ui";

export const metadata = { title: "App frame · Mad Factory" };

/** The product frame with placeholder content, so the sidebar and header can be tried without a product in the database. */
export default async function FramePreview() {
  const jar = await cookies();
  return (
    <AppFrame products={[{ slug: "demo", name: "Demo product" }]} current={{ slug: "demo", name: "Demo product" }} defaultCollapsed={jar.get(SIDEBAR_COOKIE)?.value === "1"}>
      <Shell title="App frame preview" subtitle="Placeholder content · collapse the sidebar with the button at the bottom or ⌘B" action={<Button variant="primary">Sync now</Button>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Spend" value="$4,812" hint="+12.4% vs prior" />
          <Stat label="Installs" value="1,284" tone="accent" meter={0.84} />
          <Stat label="Cost / install" value="$3.75" tone="accent" meter={0.46} />
          <Stat label="Cost / trial" value="$15.42" tone="warn" meter={0.66} hint="above target" />
        </div>
      </Shell>
    </AppFrame>
  );
}
