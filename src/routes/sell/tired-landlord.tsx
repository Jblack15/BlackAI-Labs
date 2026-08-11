import { createFileRoute } from "@tanstack/react-router";
import { SellerLandingPage } from "~/components/SellerLandingPage";
import type { SellerLandingProps } from "~/components/SellerLandingPage";

const content: SellerLandingProps = {
  title: "Tired Landlords",
  headline: "Done With Tenants? Sell Your Rental Property Fast.",
  painPoints: [
    "Tenants not paying rent or damaging the property",
    "Tired of late-night maintenance calls and headaches",
    "Property management company isn't delivering results",
    "Want to cash out and exit the landlord business",
    "Property needs major repairs before you can get new tenants",
  ],
  description:
    "Being a landlord isn't passive income — it's a job. If you're tired of dealing with difficult tenants, constant repairs, and property management headaches, DealFlow AI can help you exit. We buy rental properties with or without tenants, as-is, for cash.",
  whyDealFlow:
    "We understand landlord burnout. What started as a great investment can turn into a second job filled with stress. Between tenant turnover, evictions, maintenance emergencies, and property management drama, you might be ready to move on.\n\nWe buy rental properties in any condition — occupied or vacant. If you have difficult tenants, we'll handle the transition after closing. You don't need to evict anyone, make repairs, or even clean the place. We take it off your hands and put cash in your pocket.\n\nReclaim your time and peace of mind. Get a cash offer for your rental property today.",
  sellerType: "tired-landlord",
};

export const Route = createFileRoute("/sell/tired-landlord")({
  head: () => ({
    meta: [
      { title: "Tired Landlord? Sell Your Rental — DealFlow AI" },
      {
        name: "description",
        content:
          "Done with tenants and property management? Sell your rental property as-is for cash. We buy occupied or vacant rentals fast.",
      },
    ],
  }),
  component: () => <SellerLandingPage {...content} />,
});
