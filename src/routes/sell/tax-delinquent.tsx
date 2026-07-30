import { createFileRoute } from "@tanstack/react-router";
import { SellerLandingPage } from "~/components/SellerLandingPage";
import type { SellerLandingProps } from "~/components/SellerLandingPage";

const content: SellerLandingProps = {
  title: "Tax Delinquent Properties",
  headline: "Behind on Property Taxes? We Can Help.",
  painPoints: [
    "Facing a tax lien or tax foreclosure auction",
    "Need to sell fast before the county takes your property",
    "Can't afford to pay back taxes and penalties",
    "Stressed about losing all your equity to a tax sale",
    "Want to walk away with cash instead of nothing",
  ],
  description:
    "If you're behind on property taxes, time is not on your side. Tax authorities can foreclose and auction your property, often leaving you with nothing — even if you had substantial equity. DealFlow AI can close quickly and help you get cash for your property before it's too late.",
  whyDealFlow:
    "We specialize in helping homeowners facing tax delinquency. Unlike a tax auction where you may lose everything, we pay fair cash for your property so you can satisfy your tax debt and walk away with money in your pocket.\n\nOur team understands the urgency. We can evaluate your property within hours and close in as little as 7 days — often fast enough to stop a tax sale in its tracks. We handle all the paperwork and work directly with the tax authority to resolve liens.\n\nDon't wait until the county takes your home. Reach out today and let us present a solution that works for you.",
  sellerType: "tax-delinquent",
};

export const Route = createFileRoute("/sell/tax-delinquent")({
  head: () => ({
    meta: [
      { title: "Tax Delinquent Property? Get Cash Fast — DealFlow AI" },
      {
        name: "description",
        content:
          "Behind on property taxes? We buy tax-delinquent properties fast for cash. Stop the tax sale, satisfy your debt, and walk away with cash.",
      },
    ],
  }),
  component: () => <SellerLandingPage {...content} />,
});
