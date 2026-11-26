// Settings you change before going live.
export const CONFIG = {
  productName: 'Studio Recap',
  price: '$149',
  // Your Stripe payment link. Leave empty to hide the Buy button.
  paymentLink: '',
  // Where studios reach you. Leave empty to hide.
  contactEmail: '',
  // Public key printed by `node scripts/make-keys.mjs`. Empty means every link is a preview.
  unlockPublicKey: '',
  // true: unlocked member links carry the studio's code (about 100 characters) and the recap page
  // checks it, so editing a link can't remove PREVIEW. Leave false while studios send links through
  // tools with short merge fields (Mailchimp text merge fields hold 255 characters).
  signedLinks: false,
  // Unlock code for the made-up sample studio on the landing page, also written by make-keys.
  demoUnlockCode: '',
  // The business that sells this, as it appears on the terms and privacy page (for example your LLC).
  legalName: '',
  // Its business address, shown on the same page.
  legalAddress: '',
};
