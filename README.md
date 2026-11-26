# Studio Recap

A year-in-review for boutique fitness studios. The studio uploads one attendance spreadsheet; every member gets a personal recap page (classes, favorite class and instructor, streak, biggest month) that ends with a one-tap Instagram story image. Members below a visit minimum get a warm welcome-back note with no numbers instead.

It is a static site with no server and no database. The spreadsheet is read in the studio owner's browser. Each member's stats are compressed into their own link after the `#`, which browsers never send to a server.

## Pages

- `public/index.html`: landing page with a live sample recap.
- `public/create.html`: the owner tool. Upload CSV, check columns, brand it, review who gets what, unlock, download links and a studio image.
- `public/r.html`: the member recap that each link opens.

## Run it locally

```
npm test            # 12 tests, no installs needed (Node 20+)
npx serve public    # then open http://localhost:3000
```

Click "Try it with a sample studio" on the create page to load `public/samples/demo-studio.csv` (180 made-up members). Regenerate it with `npm run demo-data`.

## Before you sell

1. Make your unlock keys (once):
   ```
   node scripts/make-keys.mjs
   ```
   This writes `keys/private.pem` (keep it secret, it is gitignored) and puts the public key in `public/js/config.js`.
2. Put your Stripe payment link and contact email in `public/js/config.js`.
3. Deploy the `public/` folder to Cloudflare Pages (connect the repo with build output directory `public` and no build command, or drag the folder into a new Pages project).

## After a studio pays

```
node scripts/make-unlock-code.mjs "Studio Name" 2026
```

Email them the code. They paste it into step 5 and their links and images lose the PREVIEW mark. The code only works for that studio name and year (case, spaces and punctuation don't matter).

## Known limits

- CSV only. Excel files need to be saved as CSV first.
- Full links run about 300 to 420 characters; "Short links" (note, offer and booking link go in the email instead) run about 160 to 270. Some email tools may cut long merge fields, so send a test first. A short-link service (Cloudflare Pages Functions + KV) is the fix if a studio's tool can't take them.
- Unlocking is checked in the browser, so a technical user could get around the PREVIEW mark. Fine for $149 to small studios.
- Each booking system's export differs. Column guessing covers common headers; owners can fix any column by hand. Not yet tried on a real export from Mindbody, Momence, Arketa, WellnessLiving or Mariana Tek.
