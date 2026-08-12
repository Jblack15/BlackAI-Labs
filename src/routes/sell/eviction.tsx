import { createFileRoute } from "@tanstack/react-router";
import { SellerLandingPage } from "~/components/SellerLandingPage";
import type { SellerLandingProps } from "~/components/SellerLandingPage";

const content: SellerLandingProps = {
  title: "Eviction Situations",
  headline: "Dealing With an Eviction? Sell and Move On.",
  painPoints: [
    "Tenants stopped paying rent and won't leave",
    "Eviction process is dragging on and costing you money",
    "Property is being damaged during the eviction",
    "Legal fees are piling up with no end in sight",
    "Just want to be done with the property and the headache",
  ],
  description:
    "Evictions are expensive, time-consuming, and emotionally draining. If you're dealing with a difficult eviction situation, DealForge Properties can take the property off your hands. We buy rentals with problem tenants — you walk away with cash and peace of mind.",
  whyDealFlow:
    "An eviction can drag on for months, costing you mortgage payments, legal fees, and lost rent — all while your property may be getting damaged. Even after the eviction, you're often left with a trashed unit that needs thousands in repairs before you can re-rent or sell.\n\nWe offer a way out. Sell the property to us as-is, tenants and all. We'll handle the eviction process after closing. You get a fair cash price, stop the financial bleeding, and move on with your life immediately.\n\nDon't let a bad tenant situation drain your finances and energy. Get a cash offer today.",
  sellerType: "eviction",
};

export const Route = createFileRoute("/sell/eviction")({
  head: () => ({
    meta: [
      { title: "Eviction Problems? Sell Your Rental — DealForge Properties" },
      {
        name: "description",
        content:
          "Dealing with a difficult eviction? Sell your rental property as-is for cash. We handle the tenants and eviction after closing.",
      },
    ],
  }),
  component: () => <SellerLandingPage {...content} />,
});
