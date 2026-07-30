import { createFileRoute } from "@tanstack/react-router";
import { SellerLandingPage } from "~/components/SellerLandingPage";
import type { SellerLandingProps } from "~/components/SellerLandingPage";

const content: SellerLandingProps = {
  title: "Code Violations",
  headline: "Code Violations Making Your House Unsellable? We Buy It.",
  painPoints: [
    "Received code violation notices from the city",
    "Fines accumulating and you can't afford repairs",
    "Can't list with an agent because of violations",
    "City is threatening legal action or condemnation",
    "Want to sell but violations are scaring away buyers",
  ],
  description:
    "Code violations can make a property nearly impossible to sell through traditional channels. Agents won't list it, lenders won't finance it, and buyers run away. DealFlow AI buys properties with code violations as-is — we handle the fixes after closing.",
  whyDealFlow:
    "Cities issue code violations for everything from peeling paint to structural issues, and they can quickly escalate into daily fines, liens, and even condemnation. Traditional buyers and lenders won't touch a property with open violations, leaving you stuck.\n\nWe're different. We buy properties with code violations because we have the resources to cure them after purchase. You don't need to fix anything. We'll assess the situation, make you a fair cash offer that accounts for the violation costs, and close on your timeline.\n\nDon't let code violations trap you in a property you can't sell. Get a cash offer today.",
  sellerType: "code-violations",
};

export const Route = createFileRoute("/sell/code-violations")({
  head: () => ({
    meta: [
      { title: "Code Violations? We Buy As-Is — DealFlow AI" },
      {
        name: "description",
        content:
          "Code violations blocking your sale? We buy properties with violations as-is for cash. No repairs needed, fast close.",
      },
    ],
  }),
  component: () => <SellerLandingPage {...content} />,
});
