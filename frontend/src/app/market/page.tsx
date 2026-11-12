import { MarketClient } from "./MarketClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Market · MGA" };

export default function MarketPage() {
  return (
    <div className="space-y-16">
      <PageHeader eyebrow="The market" title="What employers ask for," accent="and where you stand.">
        Every posting we track for your role, skill by skill, and which of your gaps unlock the most jobs.
      </PageHeader>
      <MarketClient />
    </div>
  );
}
