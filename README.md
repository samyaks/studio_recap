# Studio Recap

A year-in-review for boutique fitness studios. The studio uploads one attendance spreadsheet; every member gets a personal recap page (classes, favorite class and instructor, streak, biggest month) that ends with a one-tap Instagram story image. Members below a visit minimum get a warm welcome-back note with no numbers instead.

It is a static site with two small Cloudflare Pages Functions (the Stripe webhook that emails unlock codes, and a script-error log) and no database. The spreadsheet is read in the studio owner's browser and never uploaded. Each member's stats are compressed into their own link after the `#`, which browsers never send to a server.

## Pages

- `public/index.html`: landing page with a live sample recap.
- `public/create.html`: the owner tool. Upload CSV, check columns, brand it, review who gets what, unlock, download links and a studio image.
- `public/r.html`: the member recap that each link opens.

## Run it locally

```
npm test            # 31 tests, no installs needed (Node 20+)
npx serve public    # then open http://localhost:3000
```

Click "Try it with a sample studio" on the create page to load `public/samples/demo-studio.csv` (180 made-up members). Regenerate it with `npm run demo-data`.

## Before you sell

1. Make your unlock keys (once):
   ```
   node scripts/make-keys.mjs
   ```
   This writes `keys/private.pem` (keep it secret, it is gitignored; save a copy in your password manager, since losing it means you can't make codes) and puts the public key and the landing page's sample code in `public/js/config.js`.
2. In `public/js/config.js`, fill in `paymentLink`, `contactEmail` and `legalName` (the business that sells it).
3. Have a lawyer read `public/legal.html` (terms and privacy, written as a draft) and change what they ask.
4. Make the Stripe payment link with two custom fields: a text field with key `studioname` ("Studio name, as you'll type it in the tool") and a dropdown with key `recapyear` (one option per year you sell). Turn on email collection.
5. Deploy to Cloudflare Pages: connect the repo with build output directory `public`, no build command. The `functions/` folder at the root is picked up on its own.
6. In the Pages project, add these secrets and variables, then redeploy:
   - `STRIPE_WEBHOOK_SECRET`: from the Stripe webhook below
   - `UNLOCK_PRIVATE_KEY`: the whole contents of `keys/private.pem`
   - `RESEND_API_KEY` and `MAIL_FROM` (for example `Studio Recap <codes@yourdomain.com>`, on a domain verified in Resend)
   - optional: `CONTACT_EMAIL` (reply-to for buyers), `OWNER_EMAIL` (a note for every sale, and for any sale it couldn't handle), `SITE_URL`
   - optional: a KV namespace bound as `UNLOCK_SENT`, so Stripe's retries never send a second email
7. In Stripe, add a webhook endpoint at `https://YOUR-SITE/api/stripe-webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and copy its signing secret into step 6.
8. Make a test purchase in Stripe's test mode and check the code email arrives and unlocks.
9. Set an uptime check on the landing page with any uptime service.

## After a studio pays

The webhook emails the buyer their code. If a sale had no studio name, or you want to make a code by hand:

```
node scripts/make-unlock-code.mjs "Studio Name" 2026
```

They paste the code into step 5 and their links and images lose the PREVIEW mark. The code only works for that studio name and year (case, spaces and punctuation don't matter).

## Errors

Script errors on any page are sent to `/api/client-error` (page path, error text and browser only; never the part of a link after `#`). Read them in Cloudflare under the Pages project's Functions, Real-time logs.

## Known limits

- CSV only. Excel files need to be saved as CSV first.
- Unlocked links carry the studio's code (about 100 characters), so they run about 400 to 520 characters; "Short links" (note, offer and booking link go in the email instead) run about 270 to 380. Preview links are about 100 characters shorter. Some email tools may cut long merge fields, so send a test first. A short-link service (Cloudflare Pages Functions + KV) is the fix if a studio's tool can't take them.
- The recap page checks each link's code against its studio name and year, so deleting the preview flag from a link no longer removes PREVIEW. The studio-wide image is still made in the owner's browser, so a technical user could get a clean one without paying.
- Each booking system's export differs. Column guessing covers common headers; owners can fix any column by hand. Not yet tried on a real export from Mindbody, Momence, Arketa, WellnessLiving or Mariana Tek.
