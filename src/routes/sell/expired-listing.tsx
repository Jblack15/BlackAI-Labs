import { createFileRoute } from "@tanstack/react-router";
import { SellerLandingPage } from "~/components/SellerLandingPage";
import type { SellerLandingProps } from "~/components/SellerLandingPage";

const content: SellerLandingProps = {
  title: "Expired Listings",
  headline: "Your Listing Expired? We'll Buy Your Home Directly.",
  painPoints: [
    "Your home sat on the market and didn't sell",
    "Frustrated with agent promises that didn't deliver",
    "Tired of keeping the house show-ready for months",
    "Price reductions haven't attracted serious buyers",
    "Ready for a guaranteed sale without more waiting",
  ],
  description:
    "An expired listing is frustrating — months of showings, open houses, and price cuts with nothing to show for it. DealFlow AI offers a guaranteed sale. No more waiting, no more showings, no more uncertainty. Just a fair cash offer and a fast close.",
  whyDealFlow:
    "When your listing expires, it's easy to feel defeated. You did everything right — priced competitively, kept the house spotless, accommodated endless showings — and still it didn't sell. The traditional market has failed you, but that doesn't mean you're out of options.\n\nWe buy homes directly, cutting out the uncertainty of the MLS. No more waiting for the right buyer to come along. No more wondering if the next showing will finally lead to an offer. We evaluate your property and make a firm cash offer within 24 hours.\n\nYour expired listing isn't the end of the road — it's an opportunity for a fresh start. Get a cash offer today.",
  sellerType: "expired-listing",
};

export const Route = createFileRoute("/sell/expired-listing")({
  head: () => ({
    meta: [
      { title: "Listing Expired? Sell Directly — DealFlow AI" },
      {
        name: "description",
        content:
          "Your home didn't sell on the MLS? We buy directly for cash. No more showings, no waiting — get a fair offer and close fast.",
      },
    ],
  }),
  component: () => <SellerLandingPage {...content} />,
});
