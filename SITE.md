# FleetClaim AI Marketing Site

This is the FleetClaim AI marketing website — an [Astro](https://astro.build) static site
with Tailwind CSS v4 + TypeScript, served on **port 3000**.

## Layout

```
src/
  layouts/
    BaseLayout.astro    # HTML shell: <head>, SEO, header, footer, theme
  components/
    Header.astro        # Sticky nav, logo, links, CTA, mobile hamburger
    Footer.astro        # Multi-column footer with links and socials
    ThemeToggle.astro   # Dark/light mode toggle with localStorage persistence
  pages/
    index.astro         # "/" — homepage
    pricing.astro       # "/pricing"
    contact.astro       # "/contact"
    blog.astro          # "/blog"
    docs.astro          # "/docs" (knowledge base)
    affiliates.astro    # "/affiliates"
    dashboard.astro     # "/dashboard" (analytics mockup)
  styles/
    global.css          # Tailwind entrypoint + design tokens + components
  scripts/
    theme.ts            # Theme initialization (reference)
public/
  favicon.svg
```

Add a page by creating a new `.astro` file under `src/pages/` — e.g. `about.astro` becomes `/about`.

## Publishing changes

After editing, run:

```bash
bun run publish
```

This rebuilds the Astro site and restarts the server on port 3000. Editing files alone does not update the live site — you must publish.

## Design

- **Color palette**: Deep navy (#0F172A), electric blue (#3B82F6), clean whites, subtle grays
- **Dark mode**: Class-based toggling with `prefers-color-scheme` detection and localStorage persistence
- **Typography**: Inter (sans), JetBrains Mono (mono)
- **Responsive**: Mobile, tablet, desktop breakpoints throughout

## Stripe Price IDs (for later integration)

- Starter ($99/mo): `price_1TzJL3DXObfXKLO3H3pGYJmM`
- Professional ($249/mo): `price_1TzJL3DXObfXKLO3EWjaTi55`
- Enterprise ($499/mo): `price_1TzJL3DXObfXKLO3pVi2fYRL`

## Contact Email

Form submissions: `fleetclaim-ai-27b8975b@ctomail.io`
