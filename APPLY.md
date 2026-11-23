# Company whitepaper + social links
Copy over the same paths (frontend only, no backend, no migration):

NEW
- hub-frontend/public/socials.js                      (the 3 social links, one place)
- hub-frontend/src/pages/company-whitepaper.html      (EVOXERA Technology whitepaper: /company-whitepaper.html)

CHANGED
- hub-frontend/vite.config.js                         (registers the new page)
- hub-frontend/public/sitemap.xml                     (adds the new page)
- hub-frontend/src/pages/ecosystem.html               (Whitepaper tile beside Roadmap, footer link, follow block)
- hub-frontend/src/pages/appevoxera.html              (Whitepaper link, follow block)
- hub-frontend/src/pages/xera/index.html              (Follow card on the Profile tab). Built on top of the Withdraw fix.
- hub-frontend/src/pages/xera/whitepaper.html         (follow block)
- socials added to the footer (one script line each): about, contact, home, integrated, policy, privacy, services, terms,
  business-tools, website-creation, xera/faq, xera/roadmap, xera/disclosure, xera/stats, xera/tokenomics
  (home.html and business-tools.html include the earlier link-preview fix)

To change a link later, edit only public/socials.js.
