import { createFileRoute } from "@tanstack/react-router";
import { SellerLandingPage } from "~/components/SellerLandingPage";
import type { SellerLandingProps } from "~/components/SellerLandingPage";

const content: SellerLandingProps = {
  title: "Vacant Homes",
  headline: "Sitting on a Vacant House? Turn It Into Cash.",
  painPoints: [
    "Paying taxes and insurance on a house nobody lives in",
    "Worried about vandalism, squatters, or deterioration",
    "Moved away and can't sell the old house",
    "Vacant property is costing you money every month",
    "Need to sell but the house needs too much work to list",
  ],
  description:
    "A vacant house is a liability — it drains money in taxes, insurance, and maintenance while risking damage from neglect or vandalism. DealFlow AI turns that liability into cash. We buy vacant homes in any condition, anywhere.",
  whyDealFlow:
    "Every month your property sits vacant, it costs you money. Property taxes, insurance, utilities, and maintenance add up fast — not to mention the risk of break-ins, squatters, or weather damage. You shouldn't have to pour money into a house you don't even live in.\n\nWe make it simple. Tell us about your vacant property and we'll make a fair cash offer within 24 hours. We buy as-is — you don't need to clean it out, make repairs, or even visit the property. We handle everything.\n\nStop the bleeding. Get cash for your vacant home and put that money to better use.",
  sellerType: "vacant",
};

export const Route = createFileRoute("/sell/vacant")({
  head: () => ({
    meta: [
      { title: "Vacant Home? Get Cash Fast — DealFlow AI" },
      {
        name: "description",
        content:
          "Have a vacant property draining your finances? We buy vacant homes as-is for cash. Close fast, no repairs needed.",
      },
    ],
  }),
  component: () => <SellerLandingPage {...content} />,
});
