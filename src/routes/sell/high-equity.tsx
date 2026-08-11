import { createFileRoute } from "@tanstack/react-router";
import { SellerLandingPage } from "~/components/SellerLandingPage";
import type { SellerLandingProps } from "~/components/SellerLandingPage";

const content: SellerLandingProps = {
  title: "High-Equity Homeowners",
  headline: "Sitting on Equity? Access Your Cash Without the Hassle.",
  painPoints: [
    "Have significant equity but don't want to take out a loan",
    "Want to downsize or relocate but dread the selling process",
    "Property needs updates you don't want to pay for",
    "Want a guaranteed sale without months of showings",
    "Need liquidity but don't want a HELOC or refinance",
  ],
  description:
    "You've built substantial equity in your home — now put it to work. Instead of borrowing against your equity with a loan or spending months on the open market, sell directly to DealFlow AI for a fair cash offer. Close fast, skip the repairs, and keep more of your equity.",
  whyDealFlow:
    "High equity is a great position to be in, but accessing that equity traditionally means either borrowing (with interest) or listing with an agent (with commissions and months of uncertainty). We offer a third path: a direct cash sale that puts your equity in your pocket quickly.\n\nWe pay fair market-based offers that respect the equity you've built. Since we buy as-is, you don't spend a dime on repairs, staging, or agent commissions — which means more of that equity stays with you. Close in as little as 7 days.\n\nReady to unlock your equity? Get a no-obligation cash offer today.",
  sellerType: "high-equity",
};

export const Route = createFileRoute("/sell/high-equity")({
  head: () => ({
    meta: [
      { title: "High Equity? Unlock Your Cash — DealFlow AI" },
      {
        name: "description",
        content:
          "Sitting on home equity? Sell directly for cash with no repairs, no commissions. Access your equity quickly and easily.",
      },
    ],
  }),
  component: () => <SellerLandingPage {...content} />,
});
