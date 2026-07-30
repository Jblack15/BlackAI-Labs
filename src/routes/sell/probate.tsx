import { createFileRoute } from "@tanstack/react-router";
import { SellerLandingPage } from "~/components/SellerLandingPage";
import type { SellerLandingProps } from "~/components/SellerLandingPage";

const content: SellerLandingProps = {
  title: "Probate / Inherited Properties",
  headline: "Inherited a House You Don't Want? Sell It Fast.",
  painPoints: [
    "Inherited a property you don't want to manage",
    "Siblings or heirs disagree on what to do with the house",
    "Property needs major repairs you can't afford",
    "Living out of state and can't manage the property",
    "Want a quick, clean sale without listing with an agent",
  ],
  description:
    "Inheriting a property can be more burden than blessing — especially when it needs work, is out of state, or when multiple heirs can't agree. DealFlow AI makes it simple: we buy inherited properties as-is for cash, so you can settle the estate and move on.",
  whyDealFlow:
    "We've helped dozens of families navigate probate property sales. The process can be emotional and complex, but selling for cash simplifies everything. No repairs, no showings, no waiting months for a buyer.\n\nWe work with executors, administrators, and heirs directly. If the property is still in probate, we can work with your attorney to structure the sale properly. We buy properties in any condition — even ones that have been vacant for years.\n\nGet a fair cash offer within 24 hours and close on your timeline. Let us take the property off your hands so you can focus on what matters.",
  sellerType: "probate",
};

export const Route = createFileRoute("/sell/probate")({
  head: () => ({
    meta: [
      { title: "Inherited a House? Sell It Fast For Cash — DealFlow AI" },
      {
        name: "description",
        content:
          "Inherited a property you don't want? We buy probate and inherited homes as-is for cash. Fast close, no repairs, no stress.",
      },
    ],
  }),
  component: () => <SellerLandingPage {...content} />,
});
