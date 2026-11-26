# Studio Recap

A year-in-review for boutique fitness studios. The studio uploads one attendance spreadsheet; every member gets a personal recap page (classes taken plus two highlights, such as favorite class, streak, favorite instructor or biggest month) that ends with a one-tap Instagram story image. Members below a visit minimum get a warm welcome-back note with no numbers instead.

It is a static site with three small Cloudflare Pages Functions (checkout, the Stripe webhook that emails unlock codes, and a script-error log). The spreadsheet is read in the studio owner's browser and never uploaded. Each member's stats are compressed into their own link after the `#`, which browsers never send to a server.

## Pages

- `public/index.html`: landing page with a live sample recap.
- `public/create.html`: the owner tool. Upload CSV, check columns, brand it, review who gets what, unlock, download links and a studio image.
- `public/r.html`: the member recap that each link opens.

## Run it locally

```
npm test            # 43 tests, no installs needed (Node 20+)
npx serve public    # then open http://localhost:3000
```

Click "Try it with a sample studio" on the create page to load `public/samples/demo-studio.csv` (180 made-up members). Regenerate it with `npm run demo-data`.

## Before you sell

1. Make your unlock keys (once):
   ```
   node scripts/make-keys.mjs
   ```
   This writes `keys/private.pem` (keep it secret, it is gitignored; save a copy in your password manager, since losing it means you can't make codes) and puts the public key and the landing page's sample code in `public/js/config.js`. Commit `config.js`: the site is deployed from the repo, so the public key must be in it.
2. In `public/js/config.js`, fill in `paymentLink`, `contactEmail`, `legalName` and `legalAddress` (the business that sells it). Leave `signedLinks` off unless your studios send links through tools that take merge fields over 255 characters (see Known limits).
3. Have a lawyer read `public/legal.html` (terms and privacy, written as a draft) and change what they ask.
4. In Stripe test mode, add a one-time Price for $149 (one studio-year) and copy its id (`price_...`). The site creates the Checkout Session (`POST /api/checkout`) after the owner has a studio name, a year and an email, and Stripe collects the card. A payment link is not required for that. An old payment link still gets a code if it collects the buyer's email and has two required custom fields: a text field with key `studioname` ("Studio name, as you'll type it in the tool") and a dropdown with key `recapyear`, one option per year you sell, with the year itself as the option's value (such as `2026`).
5. Deploy to Cloudflare Pages: connect the repo with build output directory `public`, no build command. The `functions/` folder at the root is picked up on its own.
6. In the Pages project, add these secrets and variables, then redeploy:
   - `STRIPE_SECRET_KEY`: the secret key (`sk_test_...` in test mode). Checkout uses it server-side and never sends it to the browser.
   - `STRIPE_PRICE_ID`: the Price id from step 4 (`price_...`)
   - `STRIPE_WEBHOOK_SECRET`: from the Stripe webhook below
   - `UNLOCK_PRIVATE_KEY`: the whole contents of `keys/private.pem`
   - `RESEND_API_KEY` and `MAIL_FROM` (for example `Studio Recap <codes@yourdomain.com>`, on a domain verified in Resend)
   - `OWNER_EMAIL`: your own address. You get a note for every sale, and for any sale that needs a code by hand.
   - optional: `CONTACT_EMAIL` (reply-to for buyers), `SITE_URL`, `PAYMENT_LINK_ID` (a `plink_...` id, so other payment-link products on the same Stripe account don't trigger codes). Checkout Sessions from the site have no payment link; they still get a code because they carry the studio in metadata.
   - optional D1 binding `DB`, with a `purchases` table of `id`, `user_email`, `studio_name`, `studio_key`, `year`, `status`, `created_at`. The webhook inserts a `paid` row after it emails the code. Without the binding, the email still goes out.
   - optional KV namespaces: `UNLOCK_SENT`, so Stripe's retries never send a second email, and `CLIENT_ERRORS`, to keep a sample of error reports for 30 days (set `KEEP_ALL_ERRORS` to keep every one)
7. In Stripe, add a webhook endpoint at `https://YOUR-SITE/api/stripe-webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and copy its signing secret into step 6.
8. Make a test purchase and check the code email arrives and unlocks the tool.
9. Switch Stripe to live mode and repeat steps 4 and 7 there: live mode has its own Price and its own webhook signing secret. Put the live secret key in `STRIPE_SECRET_KEY`, the live Price id in `STRIPE_PRICE_ID` and the live signing secret in `STRIPE_WEBHOOK_SECRET`. If you still use a payment link, put the live link in `paymentLink` and the live `plink_...` id in `PAYMENT_LINK_ID`, then redeploy.
10. Set an uptime check on the landing page with any uptime service.

## After a studio pays

The webhook emails the buyer their code. If a sale had no studio name, or you want to make a code by hand:

```
node scripts/make-unlock-code.mjs "Studio Name" 2026
```

They paste the code into step 5 and their links and images lose the PREVIEW mark. The code only works for that studio name and year (case, spaces and punctuation don't matter).

## Errors

Script errors on any page are sent to `/api/client-error` (page path, error text and browser only; never the part of a link after `#`). With the `CLIENT_ERRORS` KV namespace bound, one report in ten is kept for 30 days (all of them with `KEEP_ALL_ERRORS` set); read them in the Cloudflare dashboard under that namespace. Without it, they only appear in the Pages project's Functions, Real-time logs while that view is open.

## Known limits

- CSV only. Excel files need to be saved as CSV first.
- Links run about 300 to 410 characters; "Short links" (note, offer and booking link go in the email instead) run about 165 to 270. Mailchimp text merge fields hold 255 characters, so some recap links won't fit even as short links; send a test first. A short-link service (Cloudflare Pages Functions + KV) is the fix, though it would mean storing member recaps on the server, which the terms and privacy page would then have to say.
- Unlocking is checked when the owner pastes the code. With `signedLinks` off, a technical user could edit a link to remove PREVIEW. With it on, the recap page checks each link's code against its studio name and year, but links grow by about 100 characters (400 to 520; short 270 to 380). Older browsers that can't check Ed25519 accept any link carrying a code-shaped value. Turning it on after links have gone out makes those earlier links show PREVIEW. The studio-wide image is made in the owner's browser either way. Fine for $149 to small studios.
- Each booking system's export differs. Column guessing covers common headers; owners can fix any column by hand. Not yet tried on a real export from Mindbody, Momence, Arketa, WellnessLiving or Mariana Tek.
