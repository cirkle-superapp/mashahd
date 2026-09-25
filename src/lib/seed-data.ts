/**
 * Seed data for the YouTube-like demo. All thumbnails are real images
 * fetched via an image-search service (OSS-hosted, embeddable). Channel
 * avatars use DiceBear (deterministic). Video files are Google's public
 * sample MP4s.
 *
 * The seed route imports this and writes everything to SQLite.
 */

export type SeedChannel = {
  name: string;
  handle: string;
  avatarUrl: string;
  bannerColors: string; // comma-separated hex
  description: string;
  subscribers: number;
};

export type SeedVideo = {
  title: string;
  description: string;
  thumbnailUrl: string;
  videoUrl: string;
  durationSec: number;
  views: number;
  likes: number;
  dislikes: number;
  category: string;
  tags: string; // pipe-separated
  channelHandle: string;
  daysAgo: number;
};

const SAMPLE_VIDEOS = [
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
];
const SAMPLE_DURATIONS = [596, 653, 888, 734, 60, 15];

// Public HLS test streams with multiple renditions — used to demonstrate
// the multi-resolution quality selector (§35). Each stream has 3-5
// renditions at different heights (240p, 380p, 480p, 720p, 1080p).
// Verified working as of Pass 49.
const HLS_TEST_STREAMS = [
  // Mux official test stream — 5 video renditions (240p → 1080p)
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  // Shaka Angel One — multiple video + audio + subtitle renditions
  "https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8",
];

const v = (i: number) => SAMPLE_VIDEOS[i % SAMPLE_VIDEOS.length];
const d = (i: number) => SAMPLE_DURATIONS[i % SAMPLE_DURATIONS.length];

function avatar(seed: string, color: string) {
  return `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(
    seed
  )}&backgroundColor=${color}&radius=50`;
}

export const channels: SeedChannel[] = [
  {
    name: "Pixel Forge",
    handle: "pixelforge",
    avatarUrl: avatar("PixelForge", "ef4444"),
    bannerColors: "#1e293b,#0f172a,#dc2626",
    description:
      "Weekly deep-dives into modern web development. Next.js, TypeScript, and everything in between. New videos every Tuesday and Friday.",
    subscribers: 1_240_000,
  },
  {
    name: "Wander Lens",
    handle: "wanderlens",
    avatarUrl: avatar("WanderLens", "0ea5e9"),
    bannerColors: "#0c4a6e,#075985,#0ea5e9",
    description:
      "Cinematic travel films from every corner of the globe. Filmed in 4K, edited with love. Subscribe and travel with us.",
    subscribers: 856_000,
  },
  {
    name: "The Daily Sizzle",
    handle: "dailysizzle",
    avatarUrl: avatar("DailySizzle", "f59e0b"),
    bannerColors: "#7c2d12,#9a3412,#f59e0b",
    description:
      "Approachable recipes you'll actually want to cook. No fancy equipment, no 30-minute intros — just good food, made simple.",
    subscribers: 2_105_000,
  },
  {
    name: "Apex Gaming",
    handle: "apexgaming",
    avatarUrl: avatar("ApexGaming", "8b5cf6"),
    bannerColors: "#2e1065,#4c1d95,#8b5cf6",
    description:
      "High-skill gameplay, builds, and breakdowns. From software to fighting games, we play it all at the highest level.",
    subscribers: 3_410_000,
  },
  {
    name: "Iron Pulse",
    handle: "ironpulse",
    avatarUrl: avatar("IronPulse", "16a34a"),
    bannerColors: "#14532d,#166534,#16a34a",
    description:
      "Train smarter. Science-backed workouts for every level — no bro-science, no fluff. Your coach in your pocket.",
    subscribers: 678_000,
  },
  {
    name: "Sonic Bloom",
    handle: "sonicbloom",
    avatarUrl: avatar("SonicBloom", "db2777"),
    bannerColors: "#500724,#831843,#db2777",
    description:
      "Original live sessions, lo-fi mixes, and indie finds. Music for focus, music for the road, music for the quiet hours.",
    subscribers: 1_823_000,
  },
  {
    name: "Lab Notes",
    handle: "labnotes",
    avatarUrl: avatar("LabNotes", "0891b2"),
    bannerColors: "#083344,#155e75,#0891b2",
    description:
      "Curious about how the world actually works? We break down the science behind everyday phenomena — one experiment at a time.",
    subscribers: 945_000,
  },
  {
    name: "Color Theory",
    handle: "colortheory",
    avatarUrl: avatar("ColorTheory", "d946ef"),
    bannerColors: "#4a044e,#701a75,#d946ef",
    description:
      "Painting, illustration, and creative process. Tutorials, studio vlogs, and honest conversations about making art for a living.",
    subscribers: 423_000,
  },
  {
    name: "Wild Reels",
    handle: "wildreels",
    avatarUrl: avatar("WildReels", "ca8a04"),
    bannerColors: "#422006,#713f12,#ca8a04",
    description:
      "Documentary-grade wildlife footage from six continents. We follow the story, not the spectacle.",
    subscribers: 1_502_000,
  },
  {
    name: "Redline Garage",
    handle: "redlinegarage",
    avatarUrl: avatar("RedlineGarage", "dc2626"),
    bannerColors: "#450a0a,#7f1d1d,#dc2626",
    description:
      "Reviews, restorations, and the occasional bad idea. We turn wrenches so you don't have to.",
    subscribers: 1_108_000,
  },
];

// Thumbnails keyed by category (from image-search service)
const T = {
  tech: [
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/e4eefcaed8df.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/2cbfb4a8069f.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/3a619218c350.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/dc158a293ec2.jpeg",
  ],
  travel: [
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/45e114838797.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/60da8f2f043d.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/75a76c87cdbd.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/cdb74d736590.jpg",
  ],
  food: [
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/e8e4f561fbeb.jpeg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/390ae9f019e2.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/2ac4718d5a08.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/4bd6cc3e56b1.jpg",
  ],
  gaming: [
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/0eb8aeecc97c.png",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/0862791a5e28.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/2b0134fe48b7.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/60eef4446a36.jpg",
  ],
  fitness: [
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/6627fcfcfbc1.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/6c290d9f422b.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/121464a18b0e.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/830112e455f8.jpg",
  ],
  music: [
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/2a89ff78c187.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/30edd9f7822a.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/ef9b8d7a1948.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/67fc9aab541a.jpg",
  ],
  science: [
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/8c51c84ef27d.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/dddd039ae7a8.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/d1b35f54440b.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/0db01d769b5a.jpg",
  ],
  art: [
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/3b563cf1c679.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/854465b02ff6.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/af542a5bb166.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/03611e20a921.jpg",
  ],
  nature: [
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/898a8b37ab11.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/54e05e59f4bc.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/b29ed80888a8.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/a0df067af89c.jpg",
  ],
  cars: [
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/5a6adecfa95d.png",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/4bfafa49fe22.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/ddba1a09945d.jpg",
    "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/4458df6e0ada.jpg",
  ],
};

export const videos: SeedVideo[] = [
  // --- Tech (Pixel Forge) ---
  {
    title: "Building a YouTube Clone with Next.js 16 (full walkthrough)",
    description:
      "We rebuild the core of YouTube — home feed, watch page, comments, channels — using Next.js 16 App Router, Tailwind v4, and shadcn/ui. Full source in the description.\n\nChapters:\n0:00 Intro\n2:14 Data model\n8:31 API routes\n14:02 The watch page",
    thumbnailUrl: T.tech[0],
    videoUrl: v(0),
    durationSec: d(0),
    views: 412_000,
    likes: 18_900,
    dislikes: 240,
    category: "Tech",
    tags: "nextjs|typescript|tailwind|webdev|tutorial",
    channelHandle: "pixelforge",
    daysAgo: 3,
  },
  {
    title: "TypeScript Generics Explained Visually (no jargon)",
    description:
      "Generics confuse everyone at first. In this video I draw them out — literally — so the mental model finally clicks. By the end you'll be reading generic signatures like plain English.",
    thumbnailUrl: T.tech[1],
    videoUrl: v(1),
    durationSec: d(1),
    views: 287_000,
    likes: 12_400,
    dislikes: 95,
    category: "Tech",
    tags: "typescript|generics|programming|tutorial",
    channelHandle: "pixelforge",
    daysAgo: 9,
  },
  {
    title: "Tailwind CSS v4 — what changed and what to love",
    description:
      "Tailwind v4 ships a new engine, CSS-first config, and zero runtime. Here's a practical tour of the features you'll actually use every day, plus the migration gotchas.",
    thumbnailUrl: T.tech[2],
    videoUrl: v(2),
    durationSec: d(2),
    views: 198_000,
    likes: 9_100,
    dislikes: 70,
    category: "Tech",
    tags: "tailwind|css|frontend|design",
    channelHandle: "pixelforge",
    daysAgo: 18,
  },
  {
    title: "Server Components vs Server Actions — when to use which",
    description:
      "Both run on the server, but they're not interchangeable. I break down the mental model with three real examples so you stop reaching for the wrong tool.",
    thumbnailUrl: T.tech[3],
    videoUrl: v(3),
    durationSec: d(3),
    views: 156_000,
    likes: 7_200,
    dislikes: 41,
    category: "Tech",
    tags: "nextjs|react|server components|server actions",
    channelHandle: "pixelforge",
    daysAgo: 27,
  },

  // --- Travel (Wander Lens) ---
  {
    title: "48 Hours in Kyoto — A Cinematic Travel Film",
    description:
      "Temples at dawn, bamboo at dusk, and ramen at midnight. Two days, one camera, zero scripts. Filmed in 4K around Kyoto's quietest corners.\n\nGear & itinerary in the pinned comment.",
    thumbnailUrl: T.travel[0],
    videoUrl: v(0),
    durationSec: d(0),
    views: 1_820_000,
    likes: 84_500,
    dislikes: 620,
    category: "Travel",
    tags: "kyoto|japan|travel film|cinematic|4k",
    channelHandle: "wanderlens",
    daysAgo: 5,
  },
  {
    title: "Hiking the Dolomites — the 3 best day trails",
    description:
      "Three trails, three very different moods. From the airy ridges of Tre Cime to the mirror lakes of Lago di Braies. Everything you need to plan your own trip.",
    thumbnailUrl: T.travel[1],
    videoUrl: v(1),
    durationSec: d(1),
    views: 934_000,
    likes: 41_200,
    dislikes: 180,
    category: "Travel",
    tags: "dolomites|italy|hiking|mountains|outdoors",
    channelHandle: "wanderlens",
    daysAgo: 12,
  },
  {
    title: "Iceland Ring Road — a 7-day roadtrip",
    description:
      "Waterfalls, black sand beaches, glaciers, and one very stubborn sheep. We drove the full Route 1 in a week. Here's everything we saw, plus where we'd skip next time.",
    thumbnailUrl: T.travel[2],
    videoUrl: v(2),
    durationSec: d(2),
    views: 1_240_000,
    likes: 58_900,
    dislikes: 410,
    category: "Travel",
    tags: "iceland|road trip|ring road|travel",
    channelHandle: "wanderlens",
    daysAgo: 24,
  },
  {
    title: "Lisbon at golden hour — a slow travel diary",
    description:
      "No itinerary, no rush. Just trams, tile, and pastel rooftops. A quieter side of Lisbon most tourists never see.",
    thumbnailUrl: T.travel[3],
    videoUrl: v(3),
    durationSec: d(3),
    views: 412_000,
    likes: 19_800,
    dislikes: 88,
    category: "Travel",
    tags: "lisbon|portugal|slow travel|city",
    channelHandle: "wanderlens",
    daysAgo: 38,
  },

  // --- Cooking (The Daily Sizzle) ---
  {
    title: "The Perfect Crispy Fried Chicken (no buttermilk needed)",
    description:
      "Two-day brine, double-dredge, one fry. The shatter you hear at 4:12 is real. Full recipe and temperatures below.\n\n⚠ Salt amounts matter — use a scale if you can.",
    thumbnailUrl: T.food[0],
    videoUrl: v(0),
    durationSec: d(0),
    views: 2_410_000,
    likes: 98_700,
    dislikes: 1_100,
    category: "Cooking",
    tags: "fried chicken|recipe|cooking|crispy",
    channelHandle: "dailysizzle",
    daysAgo: 4,
  },
  {
    title: "Homemade Ramen from Scratch (broth, noodles, everything)",
    description:
      "Yes, it takes 8 hours. Yes, it's worth it. A tonkotsu-style broth with hand-pulled noodles and a soft 6-minute egg. The full process, start to finish.",
    thumbnailUrl: T.food[1],
    videoUrl: v(1),
    durationSec: d(1),
    views: 1_580_000,
    likes: 71_200,
    dislikes: 540,
    category: "Cooking",
    tags: "ramen|japanese|recipe|broth|noodles",
    channelHandle: "dailysizzle",
    daysAgo: 11,
  },
  {
    title: "5 Pasta Sauces Every Home Cook Should Know",
    description:
      "Cacio e pepe, amatriciana, carbonara, vodka, and a proper pomodoro. Master these and you'll never order delivery again.",
    thumbnailUrl: T.food[2],
    videoUrl: v(2),
    durationSec: d(2),
    views: 1_120_000,
    likes: 52_400,
    dislikes: 290,
    category: "Cooking",
    tags: "pasta|italian|sauce|recipe|basics",
    channelHandle: "dailysizzle",
    daysAgo: 22,
  },
  {
    title: "How to make sushi at home (without losing a finger)",
    description:
      "Rice is the hard part. Fish is the easy part. Here's everything I learned at a sushi counter, simplified for your kitchen.",
    thumbnailUrl: T.food[3],
    videoUrl: v(3),
    durationSec: d(3),
    views: 687_000,
    likes: 31_500,
    dislikes: 120,
    category: "Cooking",
    tags: "sushi|japanese|home cooking|recipe",
    channelHandle: "dailysizzle",
    daysAgo: 33,
  },

  // --- Gaming (Apex Gaming) ---
  {
    title: "Elden Ring — Final Boss, No-Hit Run (full fight)",
    description:
      "1,200 attempts. Finally clean. Set to 0.8x speed for the slow-mo breakdown at the end.\n\nBuild & talismans in the pinned comment.",
    thumbnailUrl: T.gaming[0],
    videoUrl: v(0),
    durationSec: d(0),
    views: 3_120_000,
    likes: 142_000,
    dislikes: 890,
    category: "Gaming",
    tags: "elden ring|no hit|boss fight|fromsoftware",
    channelHandle: "apexgaming",
    daysAgo: 2,
  },
  {
    title: "Building a 1 million population city in Cities: Skylines 2",
    description:
      "It took 80 hours. Traffic never broke. Here's how the transit network evolved, district by district, from a dirt road to a megacity.",
    thumbnailUrl: T.gaming[1],
    videoUrl: v(1),
    durationSec: d(1),
    views: 1_840_000,
    likes: 78_900,
    dislikes: 410,
    category: "Gaming",
    tags: "cities skylines|city builder|simulation|base game",
    channelHandle: "apexgaming",
    daysAgo: 8,
  },
  {
    title: "Top 10 Indie Games of 2024 you probably missed",
    description:
      "No triple-A. No sequels. Just ten indie games that deserve your weekend — ranked, debated, and (mostly) agreed on.",
    thumbnailUrl: T.gaming[2],
    videoUrl: v(2),
    durationSec: d(2),
    views: 1_240_000,
    likes: 56_700,
    dislikes: 380,
    category: "Gaming",
    tags: "indie games|top 10|2024|recommendations",
    channelHandle: "apexgaming",
    daysAgo: 16,
  },
  {
    title: "We spent 100 hours in this hardcore survival game",
    description:
      "First person to die loses. Last one standing wins. We invited six creators and only two made it out. Here's the full saga.",
    thumbnailUrl: T.gaming[3],
    videoUrl: v(3),
    durationSec: d(3),
    views: 987_000,
    likes: 44_100,
    dislikes: 220,
    category: "Gaming",
    tags: "survival|multiplayer|hardcore|let's play",
    channelHandle: "apexgaming",
    daysAgo: 29,
  },

  // --- Fitness (Iron Pulse) ---
  {
    title: "20-Minute Full Body Home Workout (no equipment)",
    description:
      "Twenty minutes, zero gear, anywhere. Follow along — form cues on screen the whole way. Do it three times a week and thank me in a month.",
    thumbnailUrl: T.fitness[0],
    videoUrl: v(0),
    durationSec: d(0),
    views: 1_410_000,
    likes: 62_300,
    dislikes: 410,
    category: "Fitness",
    tags: "home workout|no equipment|full body|beginner",
    channelHandle: "ironpulse",
    daysAgo: 6,
  },
  {
    title: "How to Deadlift with Proper Form (avoid the 3 big mistakes)",
    description:
      "Most people round their lower back, start with the bar too far forward, or shoot their hips. Here's how to fix all three in one session.",
    thumbnailUrl: T.fitness[1],
    videoUrl: v(1),
    durationSec: d(1),
    views: 524_000,
    likes: 23_800,
    dislikes: 88,
    category: "Fitness",
    tags: "deadlift|form|strength training|technique",
    channelHandle: "ironpulse",
    daysAgo: 19,
  },

  // --- Music (Sonic Bloom) ---
  {
    title: "Live Acoustic Session — 4 Original Songs (one take)",
    description:
      "Recorded in a friend's living room with two mics and one take each. Track list in the description. No autotune, no edits.",
    thumbnailUrl: T.music[0],
    videoUrl: v(0),
    durationSec: d(0),
    views: 612_000,
    likes: 41_200,
    dislikes: 95,
    category: "Music",
    tags: "acoustic|original|live session|indie",
    channelHandle: "sonicbloom",
    daysAgo: 7,
  },
  {
    title: "Lo-Fi Beats to Relax / Study to (1 hour mix)",
    description:
      "Sixty minutes of warm, dusty lo-fi. Built for deep work sessions. Track list & credits in the description — support the artists if you can.",
    thumbnailUrl: T.music[1],
    videoUrl: v(1),
    durationSec: d(1),
    views: 4_820_000,
    likes: 187_000,
    dislikes: 980,
    category: "Music",
    tags: "lofi|study music|relax|beats|mix",
    channelHandle: "sonicbloom",
    daysAgo: 14,
  },

  // --- Science (Lab Notes) ---
  {
    title: "How mRNA Vaccines Actually Work (drawn out, no jargon)",
    description:
      "mRNA is just a recipe. Your cells do the cooking. Here's the whole process, drawn by hand, in under fifteen minutes.",
    thumbnailUrl: T.science[0],
    videoUrl: v(0),
    durationSec: d(0),
    views: 1_980_000,
    likes: 89_400,
    dislikes: 1_200,
    category: "Science",
    tags: "mrna|vaccine|biology|explained",
    channelHandle: "labnotes",
    daysAgo: 5,
  },
  {
    title: "Why the Sky Changes Color — Rayleigh scattering, explained",
    description:
      "Blue at noon. Orange at sunset. Black at midnight. Same sky, same air — so what changes? It all comes down to how light scatters off molecules.",
    thumbnailUrl: T.science[1],
    videoUrl: v(1),
    durationSec: d(1),
    views: 1_120_000,
    likes: 51_800,
    dislikes: 240,
    category: "Science",
    tags: "sky|light|physics|scattering|explained",
    channelHandle: "labnotes",
    daysAgo: 21,
  },

  // --- Art (Color Theory) ---
  {
    title: "Watercolor Landscape for Beginners (paint along)",
    description:
      "Grab a brush and paint with me. Three colors, one brush, one hour. By the end you'll have a finished piece and zero excuses to be scared of watercolor.",
    thumbnailUrl: T.art[0],
    videoUrl: v(0),
    durationSec: d(0),
    views: 287_000,
    likes: 18_900,
    dislikes: 41,
    category: "Art",
    tags: "watercolor|landscape|beginner|paint along",
    channelHandle: "colortheory",
    daysAgo: 4,
  },
  {
    title: "Digital Portrait Painting — Procreate, start to finish",
    description:
      "From blank canvas to finished portrait in one sitting. Brushes, color picks, and the moments I almost gave up — all on screen.",
    thumbnailUrl: T.art[1],
    videoUrl: v(1),
    durationSec: d(1),
    views: 412_000,
    likes: 22_400,
    dislikes: 58,
    category: "Art",
    tags: "procreate|digital art|portrait|painting",
    channelHandle: "colortheory",
    daysAgo: 17,
  },

  // --- Nature (Wild Reels) ---
  {
    title: "Inside the Lives of Mountain Gorillas (full documentary cut)",
    description:
      "Two weeks in the Virunga highlands. We followed the same family every day and they let us in. This is the closest look I've ever been able to film.",
    thumbnailUrl: T.nature[0],
    videoUrl: v(0),
    durationSec: d(0),
    views: 2_640_000,
    likes: 118_000,
    dislikes: 410,
    category: "Nature",
    tags: "gorillas|wildlife|documentary|virunga|africa",
    channelHandle: "wildreels",
    daysAgo: 3,
  },
  {
    title: "The Great Migration — Serengeti, raw footage",
    description:
      "Two million animals, one river crossing, zero narration. Turn the sound up and just watch.",
    thumbnailUrl: T.nature[1],
    videoUrl: v(1),
    durationSec: d(1),
    views: 1_870_000,
    likes: 84_900,
    dislikes: 220,
    category: "Nature",
    tags: "serengeti|migration|wildlife|documentary|africa",
    channelHandle: "wildreels",
    daysAgo: 13,
  },

  // --- Cars (Redline Garage) ---
  {
    title: "Driving a Hypercar on the Pacific Coast Highway",
    description:
      "One car, one road, one morning. The PCH at sunrise in something with 1,000 horsepower. We talk numbers, then we shut up and drive.",
    thumbnailUrl: T.cars[0],
    videoUrl: v(0),
    durationSec: d(0),
    views: 1_340_000,
    likes: 58_900,
    dislikes: 280,
    category: "Cars",
    tags: "hypercars|pch|supercar|review|drive",
    channelHandle: "redlinegarage",
    daysAgo: 6,
  },
  {
    title: "Restoring a 1969 Mustang — part 1: the teardown",
    description:
      "Bought for $3,400 and a handshake. Over the next few months we're bringing it back to life. Today: taking it apart, finding out what's salvageable.",
    thumbnailUrl: T.cars[1],
    videoUrl: v(1),
    durationSec: d(1),
    views: 924_000,
    likes: 42_100,
    dislikes: 140,
    category: "Cars",
    tags: "mustang|restoration|classic car|project",
    channelHandle: "redlinegarage",
    daysAgo: 20,
  },
  {
    title: "EV vs Gas — the real 5-year cost, compared",
    description:
      "Same model, two powertrains, five years. We tracked every dollar — purchase, fuel, maintenance, insurance. The answer might surprise you.",
    thumbnailUrl: T.cars[2],
    videoUrl: v(2),
    durationSec: d(2),
    views: 1_090_000,
    likes: 38_700,
    dislikes: 980,
    category: "Cars",
    tags: "ev|electric car|vs|cost|comparison",
    channelHandle: "redlinegarage",
    daysAgo: 31,
  },
  // ── HLS demo videos (§35 multi-resolution choice) ──
  // These use public HLS test streams with multiple renditions so the
  // quality selector in the player has real levels to switch between.
  // Without these, every demo video is a direct MP4 (single rendition)
  // and the selector would only show "Source".
  {
    title: "Sintel — HLS multi-rendition demo (Adaptive Streaming)",
    description:
      "This video uses an HLS master playlist with multiple renditions (180p, 270p, 720p). Open the gear icon in the player to switch quality manually, or leave it on Auto and watch hls.js adapt to your bandwidth. This is the same adaptive streaming tech YouTube/Netflix use.",
    thumbnailUrl: T.art[0],
    videoUrl: HLS_TEST_STREAMS[1],
    durationSec: 888,
    views: 245_000,
    likes: 9_800,
    dislikes: 92,
    category: "Art",
    tags: "hls|adaptive-streaming|demo|multi-resolution|sintel",
    channelHandle: "wildreels",
    daysAgo: 5,
  },
  {
    title: "Mux test stream — HLS adaptive bitrate (5 renditions)",
    description:
      "A test HLS stream with 5 renditions (180p → 1080p) hosted by Mux. Use the gear icon to pick a specific resolution and watch the player switch instantly without interrupting playback. The 'Auto' option lets hls.js pick the best rendition for your bandwidth.",
    thumbnailUrl: T.tech[2],
    videoUrl: HLS_TEST_STREAMS[0],
    durationSec: 30,
    views: 87_000,
    likes: 4_200,
    dislikes: 38,
    category: "Tech",
    tags: "hls|adaptive-streaming|mux|demo|abr",
    channelHandle: "pixelforge",
    daysAgo: 7,
  },
].map((vid, idx) => ({
  ...vid,
  // Preserve explicit HLS URLs — don't override them with SAMPLE_VIDEOS.
  // Only assign a sample MP4 if the video didn't specify its own URL.
  videoUrl: vid.videoUrl || v(idx),
  durationSec: vid.durationSec || d(idx),
}));

/** Sample comment templates used to seed a handful of starter comments per video. */
export const commentTemplates: { author: string; text: string }[] = [
  { author: "Maya R.", text: "The pacing in this video is perfect. Watched the whole thing twice already." },
  { author: "Devon K.", text: "Finally someone explained this without assuming I already knew the hard parts. Thank you." },
  { author: "Priya S.", text: "That bit at the halfway mark blew my mind. Had to pause and process." },
  { author: "Lucas M.", text: "Subscribed. The production quality here is honestly better than most channels 10x your size." },
  { author: "Aiko T.", text: "Watched at 1x then at 1.5x — somehow even better sped up. Great editing." },
  { author: "Sam W.", text: "Can we get a follow-up on the second point? Would love to go deeper." },
  { author: "Noor A.", text: "This is the kind of content I open YouTube hoping to find. Instant like." },
  { author: "Theo B.", text: "The chapter markers are a lifesaver. Wish every channel did this." },
];
