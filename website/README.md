# Torgy website

Public marketing site for Torgy, the free local-first Windows desktop organizer.

- **Source:** `website/` — hand-written static HTML/CSS/JS. No build step, no external requests (no CDNs, no fonts, no trackers — on brand).
- **Deploy:** `.github/workflows/deploy-website.yml` pushes `website/` to GitHub Pages on every `main` push that touches it.
- **Custom domain:** prepared for `torgy.trujoedigital.com` — DNS cut needs Truman's explicit go-ahead (add a `CNAME` file with the domain to `website/` and point the DNS record at the Pages site when approved).

Download buttons point at the signed assets in `TruJ0e/Torgy-Releases`. Update the version links here when a new release ships.
