import { createFileRoute } from "@tanstack/react-router";
import { SellerLandingPage } from "~/components/SellerLandingPage";
import type { SellerLandingProps } from "~/components/SellerLandingPage";

const content: SellerLandingProps = {
  title: "Pre-Foreclosure",
  headline: "Facing Foreclosure? There's Still Time to Get Cash for Your Home.",
  painPoints: [
    "Received a notice of default or lis pendens",
    "Behind on mortgage payments and can't catch up",
    "Worried about foreclosure destroying your credit",
    "Want to avoid the embarrassment of a public auction",
    "Need to sell fast before the bank takes your home",
  ],
  description:
    "Foreclosure is stressful, but you have options. Selling your home before the auction can protect your credit, give you cash to start fresh, and let you leave on your own terms. DealForge Properties can close fast — often before the foreclosure date.",
  whyDealFlow:
    "When you're in pre-foreclosure, every day matters. You need a buyer who can move quickly and reliably. We evaluate properties fast and can close in as little as 7 days — potentially stopping the foreclosure process in its tracks.\n\nA foreclosure on your record can impact your ability to rent or buy for years. By selling before the auction, you can walk away with cash in your pocket and your credit intact. We handle all the communication with your lender and can often negotiate to satisfy the loan.\n\nDon't wait until it's too late. Contact us today and let's find a solution.",
  sellerType: "pre-foreclosure",
};

export const Route = createFileRoute("/sell/pre-foreclosure")({
  head: () => ({
    meta: [
      { title: "Facing Foreclosure? Get Help Fast — DealForge Properties" },
      {
        name: "description",
        content:
          "Behind on your mortgage? Sell your home before foreclosure. Close fast for cash, protect your credit, and start fresh.",
      },
    ],
  }),
  component: () => <SellerLandingPage {...content} />,
});
