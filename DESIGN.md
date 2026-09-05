# DAR invoice workspace

Direction: adapt the user's cream task-board reference to the existing invoice dashboard.
Audience: the agency owner managing invoices, payment status, and profit.
ENERGY 1 / RHYTHM 2 / MOTION 1.

- Cream canvas and near-white sidebar create the calm workspace seen in the reference.
- Lavender, peach, and blue distinguish financial summaries; pale olive supports the total.
- Dark text and tabular monetary figures make amounts readable on the pastel surfaces.
- Keep the existing Sora family to retain continuity across invoice pages.
- Three columns correspond to real payment states: unpaid, deposit, and paid.
- Cards group one client's reference, actions, and financial breakdown. No invented metrics or clients.
- The separate report view gives the wide accounting table enough room without pushing invoices below it.
- Mobile stacks columns and brings navigation into the top bar. Tables scroll within their own container.
- Motion is limited to interaction feedback; reduced-motion preferences are respected.

## Verification

- PASS: both existing PINs unlock the redesigned dashboard in the browser.
- PASS: September includes the Barber invoice allocated across August and September.
- PASS: search updates column counts and displays an empty state when nothing matches.
- PASS: invoice and financial report navigation switch views.
- PASS: profit editor opens with the selected client and closes with Escape.
- PASS: 390px viewport has no page-wide horizontal overflow; cards reflow into one column.
- PASS: syntax check runs on the inline JavaScript; diff whitespace check passes.
- Existing client data, invoice links, payment persistence, and invoice detail pages are retained.
- Cloud persistence cannot be verified through the local Python server, which does not run the Vercel API.
