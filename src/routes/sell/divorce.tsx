import { createFileRoute } from "@tanstack/react-router";
import { SellerLandingPage } from "~/components/SellerLandingPage";
import type { SellerLandingProps } from "~/components/SellerLandingPage";

const content: SellerLandingProps = {
  title: "Divorce / Distressed Sale",
  headline: "Going Through a Divorce? Sell Your Home Quickly and Move On.",
  painPoints: [
    "Need to sell the marital home as part of divorce settlement",
    "Can't afford the mortgage on a single income",
    "Both parties want a fast, clean split of assets",
    "Don't want to deal with showings during a difficult time",
    "House needs repairs neither party wants to pay for",
  ],
  description:
    "Divorce is hard enough without the added stress of selling a house. DealFlow AI provides a fast, clean sale so both parties can divide the proceeds and move forward. No repairs, no showings, no delays — just a fair cash offer and a quick close.",
  whyDealFlow:
    "Dividing assets in a divorce is never simple, and the family home is often the biggest — and most contested — piece of the puzzle. Listing with an agent means months of showings, negotiations, and uncertainty at a time when you need clarity and closure.\n\nWe make it straightforward. We'll evaluate the property and present a fair cash offer that both parties can agree on. Close in as little as 7 days, split the proceeds according to your settlement, and move on. No repairs, no staging, no open houses — just a done deal.\n\nLet us take the house off your plate so you can focus on what comes next.",
  sellerType: "divorce",
};

export const Route = createFileRoute("/sell/divorce")({
  head: () => ({
    meta: [
      { title: "Divorce Sale? Sell Fast For Cash — DealFlow AI" },
      {
        name: "description",
        content:
          "Selling a home due to divorce? Get a fair cash offer, close fast, and split the proceeds. No repairs, no stress, no delays.",
      },
    ],
  }),
  component: () => <SellerLandingPage {...content} />,
});
