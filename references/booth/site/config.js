// Paste your Google Apps Script web app URL here (see README.md, step 2).
// Leave empty to run in demo mode: check-ins are kept on this device only.
window.KLEROS_BOOTH_CONFIG = {
  endpoint: 'https://script.google.com/macros/s/AKfycbzxw7RFUWHJGAD78-9hdmmE4KmNctwLPnpZfD134d_fuoSEQ6MRgKDy7GgWuR9A8D-vzg/exec',
  // ---- This year's edition. devcon.kleros.io is reused every Devcon: update these, the hubs below,
  // and the focus pipelines in matching.js (focus: true) for each new edition. See README "New Devcon year".
  edition: 'Devcon VIII',
  city: 'Mumbai',
  event: 'Devcon VIII Mumbai',   // stored with every check-in so years stay separable in the Sheet

  // Shown in the privacy notice as the place to ask for access or deletion. A shared inbox is better than a personal one.
  privacyContact: 'weiwei@kleros.io',

  // The "Kleros updates" box subscribes visitors to the Kleros blog (Ghost). Ghost emails them a link to confirm.
  // `label` tags the new subscribers in Ghost; create a label with this exact name in Ghost admin for it to stick.
  blog: { url: 'https://blog.kleros.io', label: 'Devcon VIII booth' },

  // Merch tiers, shown above the form (so visitors know more steps mean better merch) and on the final screen.
  // Teal: check in and confirm the blog email. Purple: also join the Kleros Telegram (checked by @KlerosDevconBot)
  // and follow Kleros on X and LinkedIn. Gold: also get all 3 Kleros 101 questions right (quiz.js).
  // One item per person, from their tier. Stock for Devcon VIII (from the supplier orders):
  //   free     GTA stickers (7 designs x 100), metallic tattoos (50 A5 sheets)
  //   Teal     200 flip-flops
  //   Purple   100 copper bottles + 100 gamchas = 200
  //   Gold     100 kurtas (the 28 named kurtas are the team's)
  // PoH charms (50) and PoH tees (50) are left out for now; their pictures are assets/merch/charm.jpg and tee.jpg.
  // `reward` is shown on the ladder and the ticket, `short` inside sentences, `img` is one picture or several.
  // Change the rewards and pictures freely; keep three tiers.
  merch: {
    free: { reward: 'Stickers and metallic tattoos', how: 'Free for everyone at the booth',
            img: ['assets/merch/stickers.jpg', 'assets/merch/tattoo.jpg'] },
    tiers: [
      { name: 'Teal', reward: 'Kleros flip-flops', short: 'Kleros flip-flops', img: ['assets/merch/flipflops.jpg'] },
      { name: 'Purple', reward: 'Copper bottle or gamcha', short: 'a copper bottle or gamcha',
        img: ['assets/merch/bottle.jpg', 'assets/merch/gamcha.jpg'] },
      { name: 'Gold', reward: 'Kleros kurta', short: 'a Kleros kurta', img: ['assets/merch/kurta.jpg'] }
    ],
    note: 'One item per person, while stocks last'
  },
  telegram: { bot: 'KlerosDevconBot', group: 'https://t.me/kleros' },
  follow: { x: 'https://x.com/kleros_io', linkedin: 'https://www.linkedin.com/company/kleros/' },

  // Community Hubs card on the ticket screen. Set `show: false` to hide it.
  // Copy is kept neutral on purpose: the hubs are community spaces, not Kleros-run,
  // and each has a no-promotion policy. Describe the topics, not who organises them.
  session: {
    show: true,
    kicker: 'Also at Devcon',
    title: 'Community Hubs',
    dates: '3–6 Nov',
    hubs: [
      { name: 'Legal & Governance Hub', about: 'Dispute resolution, arbitration, token rights and compliance as institutions and AI agents come onchain.' },
      { name: 'Agentic Hub', about: 'Agent identity and reputation (ERC-8004), agent payments, and who is accountable when an agent deal goes wrong.' },
      { name: 'Prediction Markets Hub', about: 'How markets resolve: oracles, resolution design and settling disputed outcomes, alongside liquidity and futarchy.' }
    ],
    venue: 'Jio World Centre',
    note: 'Check the Devcon app for each hub’s schedule'
  }
};
