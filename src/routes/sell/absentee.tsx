import { createFileRoute } from "@tanstack/react-router";
import { SellerLandingPage } from "~/components/SellerLandingPage";
import type { SellerLandingProps } from "~/components/SellerLandingPage";

const content: SellerLandingProps = {
  title: "Absentee Owners",
  headline: "Out-of-State Owner? Sell Your Property Without the Headache.",
  painPoints: [
    "Living far from your rental or inherited property",
    "Managing a property from out of state is stressful",
    "Tenants moved out and left the place in bad condition",
    "Tired of property management companies and their fees",
    "Ready to cash out without traveling back to handle the sale",
  ],
  description:
    "Owning property from a distance comes with unique challenges — difficult tenants, unreliable property managers, and the constant worry of what's happening to your investment. DealForge Properties buys absentee-owned properties for cash, letting you exit on your terms.",
  whyDealFlow:
    "As an absentee owner, you face challenges that local owners don't. You rely on property managers who may or may not be doing their job. You can't easily check on the property. And when problems arise, you're stuck dealing with them from hundreds or thousands of miles away.\n\nWe make it easy to sell from anywhere. Our process is entirely remote-friendly — we can evaluate your property, make an offer, and close without you ever needing to travel. We buy properties in any condition, with or without tenants.\n\nFree yourself from the burden of long-distance ownership. Get a fair cash offer today.",
  sellerType: "absentee",
};

export const Route = createFileRoute("/sell/absentee")({
  head: () => ({
    meta: [
      { title: "Absentee Owner? Sell From Anywhere — DealForge Properties" },
      {
        name: "description",
        content:
          "Out-of-state property owner? Sell your home remotely for cash. No travel needed, as-is condition, fast close.",
      },
    ],
  }),
  component: () => <SellerLandingPage {...content} />,
});
