import { CONFIG } from './config.js';

document.querySelectorAll('[data-product-name]').forEach((e) => { e.textContent = CONFIG.productName; });
if (CONFIG.legalName) document.querySelectorAll('[data-legal-name]').forEach((e) => { e.textContent = CONFIG.legalName; });
if (CONFIG.legalAddress) document.querySelectorAll('[data-legal-address]').forEach((e) => { e.textContent = ', ' + CONFIG.legalAddress; });
document.querySelectorAll('[data-contact]').forEach((a) => {
  if (CONFIG.contactEmail) {
    a.href = 'mailto:' + CONFIG.contactEmail;
    if (a.textContent === 'us') a.textContent = CONFIG.contactEmail;
  } else a.replaceWith(document.createTextNode(a.textContent));
});
