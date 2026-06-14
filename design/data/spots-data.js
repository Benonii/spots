/* Realistic mock of the Supabase `spots` table for the Addis date-spots app.
   Shape matches schemas.md §1.3 + quality_signals §3. quality_score is the
   CLI-computed 0..100 value; we render a 0-5 star score as quality_score/20. */
(function () {
  // Deterministic gradient placeholders for cover_image_url (earthy green -> sunset)
  const COVERS = [
    "linear-gradient(160deg, #9FB68F 0%, #7E9579 100%)",
    "linear-gradient(160deg, #ECC079 0%, #E6A94F 100%)",
    "linear-gradient(160deg, #EA9560 0%, #E37B33 100%)",
    "linear-gradient(160deg, #A7BE9C 0%, #82996F 100%)",
    "linear-gradient(160deg, #E9B97E 0%, #D9924B 100%)",
    "linear-gradient(160deg, #B9AC90 0%, #968870 100%)",
  ];

  function level(min) {
    if (min == null) return null;
    if (min < 300) return 1;
    if (min < 700) return 2;
    if (min < 1500) return 3;
    return 4;
  }

  // base 0..5 over dims with weights, x20 x evidenceFactor -> 0..100
  function score(d, videoCount) {
    const w = { aesthetic: 1.0, vibe: 1.0, food: 1.0, value: 1.2, service: 0.8 };
    let num = 0, den = 0;
    for (const k in w) { if (d[k] != null) { num += w[k] * d[k]; den += w[k]; } }
    const base = den ? num / den : 0;
    const ef = 0.85 + 0.05 * Math.min(videoCount, 3);
    return Math.max(0, Math.min(100, Math.round(base * 20 * ef)));
  }

  const raw = [
    {
      name: "Tomoca Roastery — Kazanchis", neighborhood: "Kazanchis",
      address: "Wawel St, Kazanchis, Addis Ababa", lat: 9.0157, lng: 38.7649,
      price_min: 180, price_max: 360, basis: "per_person",
      tags: ["coffee", "historic", "quiet", "morning"],
      summary: "Ethiopia's oldest roaster — espresso at a standing bar, deep coffee aroma.",
      dims: { aesthetic: 3.5, vibe: 4.2, food: 3.0, value: 4.6, service: 3.8 },
      ev: { positiveMentions: 22, negativeMentions: 2, aestheticMentions: 7 },
      video_count: 3,
    },
    {
      name: "Sishu Bole", neighborhood: "Bole",
      address: "Bole Medhanealem, Addis Ababa", lat: 9.0107, lng: 38.7869,
      price_min: 420, price_max: 850, basis: "per_person",
      tags: ["brunch", "garden", "pastries", "bright"],
      summary: "Leafy garden café — flaky pastries, slow brunch, dappled light.",
      dims: { aesthetic: 4.4, vibe: 4.3, food: 4.1, value: 3.6, service: 3.9 },
      ev: { positiveMentions: 31, negativeMentions: 4, aestheticMentions: 18 },
      video_count: 3,
    },
    {
      name: "Cascara Coffee — Old Airport", neighborhood: "Old Airport",
      address: "Off Cape Verde St, Old Airport", lat: 8.9806, lng: 38.7600,
      price_min: 260, price_max: 540, basis: "per_person",
      tags: ["coffee", "minimal", "quiet", "work-friendly"],
      summary: "Pared-back specialty bar, single-origin pour-overs, calm playlist.",
      dims: { aesthetic: 4.5, vibe: 4.4, food: 3.4, value: 4.0, service: 4.2 },
      ev: { positiveMentions: 19, negativeMentions: 1, aestheticMentions: 12 },
      video_count: 2,
    },
    {
      name: "Kuriftu Rooftop — Bole", neighborhood: "Bole",
      address: "Africa Ave, Bole, Addis Ababa", lat: 9.0049, lng: 38.7820,
      price_min: 1100, price_max: 2400, basis: "per_person",
      tags: ["rooftop", "sunset", "cocktails", "view", "romantic"],
      summary: "City-edge rooftop — sunset over Bole, candlelit tables, long cocktail list.",
      dims: { aesthetic: 4.8, vibe: 4.7, food: 4.0, value: 3.0, service: 4.1 },
      ev: { positiveMentions: 44, negativeMentions: 6, aestheticMentions: 29 },
      video_count: 3,
    },
    {
      name: "Gusto Restaurant", neighborhood: "Kazanchis",
      address: "Guinea Conakry St, Kazanchis", lat: 9.0142, lng: 38.7681,
      price_min: 700, price_max: 1500, basis: "per_person",
      tags: ["italian", "dinner", "wine", "cozy"],
      summary: "Old-Addis trattoria — handmade pasta, warm lamplight, unhurried service.",
      dims: { aesthetic: 4.0, vibe: 4.4, food: 4.6, value: 3.8, service: 4.3 },
      ev: { positiveMentions: 27, negativeMentions: 3, aestheticMentions: 9 },
      video_count: 2,
    },
    {
      name: "Lime Tree — Bole", neighborhood: "Bole",
      address: "Mega Bldg, Bole Rd, Addis Ababa", lat: 9.0095, lng: 38.7787,
      price_min: 520, price_max: 1050, basis: "per_person",
      tags: ["mediterranean", "fresh", "lunch", "bright"],
      summary: "Sunny Mediterranean plates — mezze to share, citrus and herbs.",
      dims: { aesthetic: 4.1, vibe: 4.0, food: 4.3, value: 3.9, service: 4.0 },
      ev: { positiveMentions: 24, negativeMentions: 3, aestheticMentions: 10 },
      video_count: 2,
    },
    {
      name: "Mama's Kitchen — Gerji", neighborhood: "Gerji",
      address: "Gerji Mebrat Hayl, Addis Ababa", lat: 9.0145, lng: 38.8200,
      price_min: 240, price_max: 480, basis: "per_person",
      tags: ["ethiopian", "traditional", "homestyle", "value"],
      summary: "Generous traditional platters, family-run, low tables and incense.",
      dims: { aesthetic: 3.6, vibe: 4.2, food: 4.5, value: 4.7, service: 4.0 },
      ev: { positiveMentions: 33, negativeMentions: 2, aestheticMentions: 6 },
      video_count: 3,
    },
    {
      name: "Yod Abyssinia — Old Airport", neighborhood: "Old Airport",
      address: "Bole Rd / Old Airport, Addis Ababa", lat: 8.9842, lng: 38.7654,
      price_min: 650, price_max: 1300, basis: "per_person",
      tags: ["ethiopian", "live-music", "dance", "lively"],
      summary: "Cultural dinner show — azmari music, dancing, big shared platters.",
      dims: { aesthetic: 4.2, vibe: 4.8, food: 4.0, value: 3.7, service: 3.8 },
      ev: { positiveMentions: 38, negativeMentions: 5, aestheticMentions: 14 },
      video_count: 3,
    },
    {
      name: "Alem Bunna — Sidist Kilo", neighborhood: "Sidist Kilo",
      address: "Near AAU, Sidist Kilo, Addis Ababa", lat: 9.0400, lng: 38.7620,
      price_min: 150, price_max: 300, basis: "per_person",
      tags: ["coffee", "student", "casual", "value"],
      summary: "Neighborhood roaster by the university — strong macchiato, easy chatter.",
      dims: { aesthetic: 3.2, vibe: 3.9, food: 2.8, value: 4.6, service: 3.6 },
      ev: { positiveMentions: 14, negativeMentions: 2, aestheticMentions: 3 },
      video_count: 1,
    },
    {
      name: "The Coffee Garden — Sarbet", neighborhood: "Sarbet",
      address: "Sarbet, near Ethio-China St", lat: 8.9930, lng: 38.7570,
      price_min: 320, price_max: 640, basis: "per_person",
      tags: ["coffee", "garden", "green", "quiet", "romantic"],
      summary: "Walled garden of ferns and birdsong — pour-over and cardamom cake.",
      dims: { aesthetic: 4.6, vibe: 4.5, food: 3.6, value: 4.0, service: 4.1 },
      ev: { positiveMentions: 21, negativeMentions: 1, aestheticMentions: 15 },
      video_count: 2,
    },
    {
      name: "Stub Roof Restaurant", neighborhood: "Piassa",
      address: "Piassa, Adwa Bridge area", lat: 9.0348, lng: 38.7505,
      price_min: 480, price_max: 980, basis: "per_person",
      tags: ["rooftop", "view", "historic", "sunset"],
      summary: "Old-Piassa rooftop — rusted-tin charm, Entoto on the horizon at dusk.",
      dims: { aesthetic: 4.0, vibe: 4.3, food: 3.7, value: 4.1, service: 3.5 },
      ev: { positiveMentions: 18, negativeMentions: 3, aestheticMentions: 11 },
      video_count: 2,
    },
    {
      name: "Mosob — CMC", neighborhood: "CMC",
      address: "CMC Michael, Addis Ababa", lat: 9.0290, lng: 38.8350,
      price_min: 560, price_max: 1150, basis: "per_person",
      tags: ["ethiopian", "modern", "dinner", "cozy"],
      summary: "Modern take on traditional — plated injera, soft jazz, warm wood.",
      dims: { aesthetic: 4.3, vibe: 4.1, food: 4.4, value: 3.8, service: 4.2 },
      ev: { positiveMentions: 26, negativeMentions: 2, aestheticMentions: 12 },
      video_count: 2,
    },
    {
      name: "Sky Lounge — Megenagna", neighborhood: "Megenagna",
      address: "Zefmesh Grand Mall, Megenagna", lat: 9.0205, lng: 38.8000,
      price_min: 900, price_max: 1900, basis: "per_person",
      tags: ["rooftop", "cocktails", "night", "view"],
      summary: "Glassy top-floor lounge — neon city grid, shareable small plates.",
      dims: { aesthetic: 4.2, vibe: 4.0, food: 3.6, value: 3.1, service: 3.7 },
      ev: { positiveMentions: 20, negativeMentions: 5, aestheticMentions: 10 },
      video_count: 2,
    },
    {
      name: "Enrico's Pastry — Piassa", neighborhood: "Piassa",
      address: "Churchill Ave, Piassa, Addis Ababa", lat: 9.0331, lng: 38.7489,
      price_min: 200, price_max: 420, basis: "per_person",
      tags: ["pastries", "historic", "coffee", "morning"],
      summary: "1950s pasticceria — marble counters, cream cakes, old-Addis nostalgia.",
      dims: { aesthetic: 4.3, vibe: 4.4, food: 4.0, value: 4.3, service: 3.7 },
      ev: { positiveMentions: 23, negativeMentions: 1, aestheticMentions: 13 },
      video_count: 2,
    },
    {
      name: "Habesha 2000", neighborhood: "Bole",
      address: "Bole Olympia, Addis Ababa", lat: 9.0011, lng: 38.7745,
      price_min: 700, price_max: 1400, basis: "per_person",
      tags: ["ethiopian", "live-music", "lively", "dance"],
      summary: "Big cultural hall — energetic eskista, communal platters, full nights.",
      dims: { aesthetic: 3.9, vibe: 4.6, food: 3.9, value: 3.6, service: 3.6 },
      ev: { positiveMentions: 29, negativeMentions: 6, aestheticMentions: 9 },
      video_count: 3,
    },
    {
      name: "Bunna & Books — Summit", neighborhood: "Summit",
      address: "Summit Safari, Addis Ababa", lat: 8.9990, lng: 38.8500,
      price_min: 280, price_max: 560, basis: "per_person",
      tags: ["coffee", "books", "quiet", "work-friendly", "cozy"],
      summary: "Café-library hush — secondhand shelves, slow afternoons, drip coffee.",
      dims: { aesthetic: 4.2, vibe: 4.5, food: 3.2, value: 4.2, service: 4.0 },
      ev: { positiveMentions: 17, negativeMentions: 1, aestheticMentions: 11 },
      video_count: 2,
    },
    {
      name: "Galani Café — Mexico", neighborhood: "Mexico",
      address: "Mexico Square, Addis Ababa", lat: 9.0050, lng: 38.7430,
      price_min: 360, price_max: 720, basis: "per_person",
      tags: ["coffee", "modern", "bright", "lunch"],
      summary: "Bright corner café — big windows, good salads, people-watching.",
      dims: { aesthetic: 3.8, vibe: 3.8, food: 3.7, value: 3.9, service: 4.0 },
      ev: { positiveMentions: 15, negativeMentions: 2, aestheticMentions: 6 },
      video_count: 1,
    },
    {
      name: "Entoto Hilltop Picnic", neighborhood: "Entoto",
      address: "Entoto Park, north of Addis", lat: 9.0930, lng: 38.7560,
      price_min: 150, price_max: 500, basis: "total",
      tags: ["outdoors", "view", "nature", "picnic", "romantic"],
      summary: "Eucalyptus air and the whole city below — bring a blanket and a flask.",
      dims: { aesthetic: 4.7, vibe: 4.6, food: 2.5, value: 4.8, service: 2.0 },
      ev: { positiveMentions: 25, negativeMentions: 2, aestheticMentions: 19 },
      video_count: 2,
    },
  ];

  let coverI = 0;
  window.SPOTS = raw.map((r, i) => {
    const dims = r.dims;
    const qs = score(dims, r.video_count);
    return {
      id: "spot-" + (i + 1),
      google_place_id: "gp_addis_" + (i + 1).toString().padStart(3, "0"),
      name: r.name,
      neighborhood: r.neighborhood,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      price_min: r.price_min,
      price_max: r.price_max,
      price_currency: "ETB",
      price_basis: r.basis,
      price_level: level(r.price_min),
      quality_score: qs,
      quality_signals: { dimensions: dims, evidence: r.ev },
      tags: r.tags,
      summary: r.summary,
      video_count: r.video_count,
      cover_image_url: COVERS[(coverI++) % COVERS.length],
      first_seen_at: new Date(Date.now() - (raw.length - i) * 86400000 * 6).toISOString(),
      updated_at: new Date(Date.now() - i * 86400000 * 2).toISOString(),
    };
  });

  // Seed a couple of "visited" entries (only if user has none yet) so the
  // bottom table is populated on first demo load.
  window.SEED_VISITED = [
    {
      placeId: "gp_addis_001", name: "Tomoca Roastery — Kazanchis",
      visitedAt: "2026-05-18", rating: 5,
      notes: "Standing-bar espresso, no seats but worth it. Go early, it smells incredible.",
    },
    {
      placeId: "gp_addis_004", name: "Kuriftu Rooftop — Bole",
      visitedAt: "2026-05-31", rating: 4,
      notes: "Sunset was unreal. Pricey cocktails — split a plate. Ask for the corner table.",
    },
    {
      placeId: "gp_addis_010", name: "The Coffee Garden — Sarbet",
      visitedAt: "2026-06-07", rating: 5,
      notes: "Our favourite so far. Birds, ferns, cardamom cake. Quiet on weekday mornings.",
    },
  ];
})();
