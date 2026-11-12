import { MarketClient } from "./MarketClient";

export const metadata = { title: "Market · MGA" };

export default function MarketPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">The market for your role</h1>
        <p className="text-slate-600">What employers actually ask for across every posting we track, and which of your gaps unlock the most jobs.</p>
      </header>
      <MarketClient />
    </div>
  );
}
