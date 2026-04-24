const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const OpenAI = require('openai');

const app = express();
const defaultPort = Number(process.env.PORT || 3000);
const apiKey = (process.env.OPENAI_API_KEY || '').trim();
const MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const WEATHER_KEY = (process.env.WEATHER_API_KEY || '').trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_WEBHOOK_SECRET = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const TELEGRAM_WEBHOOK_URL = (process.env.TELEGRAM_WEBHOOK_URL || '').trim();
const siteFile = path.join(__dirname, 'travel.html');
const telegramHistory = new Map();

const client = apiKey ? new OpenAI({ apiKey }) : null;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/', (_req, res) => { res.sendFile(siteFile); });

// ── REAL-TIME: Weather ──
app.get('/api/weather/:city', async (req, res) => {
  const city = req.params.city;
  const key = WEATHER_KEY || '0d39b13539944541145f tried460b70c1'; // free-tier demo key
  try {
    const resp = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)},IN&units=metric&appid=${key}`);
    if (!resp.ok) throw new Error('Weather API error');
    const data = await resp.json();
    const forecast = await fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)},IN&units=metric&cnt=9&appid=${key}`);
    let forecastData = null;
    if (forecast.ok) forecastData = await forecast.json();
    res.json({
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      condition: data.weather[0]?.description || 'N/A',
      icon: data.weather[0]?.icon || '01d',
      wind: data.wind?.speed || 0,
      city: data.name,
      forecast: forecastData?.list?.map(f => ({
        dt: f.dt_txt, temp: Math.round(f.main.temp), desc: f.weather[0]?.description, icon: f.weather[0]?.icon
      })) || []
    });
  } catch (e) {
    res.status(500).json({ error: 'Weather data unavailable', fallback: true,
      temp: '--', feels_like: '--', humidity: '--', condition: 'unavailable' });
  }
});

// ── REAL-TIME: Exchange Rates ──
app.get('/api/exchange-rates', async (_req, res) => {
  try {
    const resp = await fetch('https://api.exchangerate-api.com/v4/latest/INR');
    if (!resp.ok) throw new Error('Exchange rate API error');
    const data = await resp.json();
    const r = data.rates || {};
    res.json({
      base: 'INR', updated: data.date,
      rates: { USD: r.USD, EUR: r.EUR, GBP: r.GBP, AED: r.AED, SGD: r.SGD, INR: 1 },
      display: {
        USD: r.USD ? `1 USD = ₹${(1/r.USD).toFixed(2)}` : 'N/A',
        EUR: r.EUR ? `1 EUR = ₹${(1/r.EUR).toFixed(2)}` : 'N/A',
        GBP: r.GBP ? `1 GBP = ₹${(1/r.GBP).toFixed(2)}` : 'N/A',
        AED: r.AED ? `1 AED = ₹${(1/r.AED).toFixed(2)}` : 'N/A',
        SGD: r.SGD ? `1 SGD = ₹${(1/r.SGD).toFixed(2)}` : 'N/A'
      }
    });
  } catch (e) {
    res.json({ error: 'Exchange rates unavailable', fallback: true,
      display: { USD:'1 USD ≈ ₹83–84', EUR:'1 EUR ≈ ₹90–92', GBP:'1 GBP ≈ ₹105–107' }});
  }
});

// ── REAL-TIME: Crowd & Advisory ──
app.get('/api/travel-info/:city', async (req, res) => {
  const city = req.params.city.toLowerCase();
  const month = new Date().getMonth();
  const peakMonths = { goa:[10,11,0,1], manali:[4,5,11,0], munnar:[8,9,10,11], delhi:[9,10,11,1,2],
    andaman:[10,11,0,1,2,3], jodhpur:[9,10,11,1,2], varkala:[10,11,0,1,2], mysore:[9,10,11],
    mumbai:[10,11,0,1,2], kodaikanal:[3,4,5], ooty:[3,4,5,9,10], coorg:[9,10,11,0] };
  const peaks = peakMonths[city] || [];
  const crowd = peaks.includes(month) ? 'High 🔴' : (peaks.includes((month+1)%12) ? 'Moderate 🟡' : 'Low 🟢');
  res.json({
    crowd, bestTime: peaks.length ? `Peak months: ${peaks.map(m=>['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m]).join(', ')}` : 'Year-round',
    alerts: 'No active travel advisories ✅', safety: 'Safe for tourists',
    tips: city === 'goa' ? 'Monsoon (Jun-Sep): Some beaches unsafe for swimming' :
          city === 'manali' ? 'Winter roads may close due to snow' :
          city === 'andaman' ? 'Book ferries in advance during peak season' : 'Check local weather before travel'
  });
});

// ── Enhanced System Prompt ──
function buildSystemPrompt(preferences, mood, lang, liveData) {
  let system = `You are "Trip for Heaven's" AI Travel Expert — a friendly, knowledgeable travel assistant specializing in Indian destinations 🇮🇳🌴🏔️

Your personality: Warm, friendly, enthusiastic 😊. Speak naturally with emojis. Give clear, practical, real-world travel advice. Always helpful, never robotic.

STYLE RULES:
- Use emojis 🌴🏔️✨
- Keep answers clear & engaging
- Always include prices in ₹ when relevant 💰
- Give 2–3 suggestions when possible
- End with a helpful follow-up question
- Be honest if data unavailable
- Encourage responsible tourism

DESTINATION KNOWLEDGE:
GOA 🌴 → Beaches, nightlife | MANALI 🏔️ → Snow, adventure | JODHPUR 🏰 → Heritage, forts
MUNNAR 🍃 → Tea hills | DELHI 🏙️ → Culture, history | ANDAMAN 🏝️ → Islands, scuba
VARKALA 🌊 → Cliffs, wellness | MYSORE 🏯 → Palace, culture | MUMBAI 🎬 → City life
KODAIKANAL 🌄 → Lake, hills | OOTY 🚂 → Tea gardens | COORG ☕ → Coffee, nature

WHAT YOU CAN DO:
- Suggest destinations based on budget & mood
- Create day-wise itineraries (3–7 days)
- Calculate total trip cost with breakdown
- Recommend hotels & activities with real prices
- Give best time to visit info
- Provide travel tips and safety info

RESPONSE GUIDELINES:
- Read the user's exact question carefully before replying
- Never give the same reply repeatedly
- Generate fresh, unique answers based on current question
- If unclear, ask a polite follow-up question
- Use realistic INR price guidance
- Reply in the same language as the user`;

  if (liveData) {
    system += `\n\nLIVE DATA AVAILABLE (use when relevant):`;
    if (liveData.weather) system += `\nWeather: ${liveData.weather.temp}°C, ${liveData.weather.condition}, Humidity: ${liveData.weather.humidity}%`;
    if (liveData.exchangeRates) system += `\nExchange Rates: ${JSON.stringify(liveData.exchangeRates.display)}`;
    if (liveData.travelInfo) system += `\nCrowd Status: ${liveData.travelInfo.crowd} | Alerts: ${liveData.travelInfo.alerts}`;
  }

  if (preferences?.budget) system += `\nUser Budget: ${preferences.budget}.`;
  if (preferences?.type) system += `\nTravel group: ${preferences.type}.`;
  if (preferences?.season) system += `\nFavorite season: ${preferences.season}.`;
  if (preferences?.activities) system += `\nInterests: ${preferences.activities}.`;
  if (mood) system += `\nCurrent mood: ${mood}.`;

  const langNote = { hi:' Always reply in Hindi.', ta:' Always reply in Tamil.', ml:' Always reply in Malayalam.',
    te:' Always reply in Telugu.', bn:' Always reply in Bengali.' }[lang] || '';
  return system + langNote;
}

function fallbackChatReply(prompt = '') {
  const q = String(prompt).toLowerCase().trim();
  const daysMatch = q.match(/(\d+)\s*[- ]?\s*day/);
  const budgetMatch = q.match(/(?:₹|rs\.?|inr)?\s*(\d{4,6})/i);
  const days = daysMatch ? parseInt(daysMatch[1], 10) : null;
  const budget = budgetMatch ? parseInt(budgetMatch[1], 10) : null;

  const destinationGuides = {
    goa: {
      title: 'Goa',
      bestTime: 'Nov–Feb',
      budgetPerDay: '₹2,500–4,000/day',
      highlights: 'Baga Beach, Fort Aguada, Dudhsagar Falls',
      samplePlan: ['Beach time in North Goa', 'Forts and sunset points', 'Water sports or Old Goa churches'],
    },
    manali: {
      title: 'Manali',
      bestTime: 'Dec–Feb for snow, Apr–Jun for sightseeing',
      budgetPerDay: '₹3,000–5,000/day',
      highlights: 'Rohtang Pass, Solang Valley, Hadimba Temple',
      samplePlan: ['Old Manali and cafes', 'Solang Valley adventure', 'Temple visit and local market'],
    },
    kerala: {
      title: 'Kerala',
      bestTime: 'Oct–Mar',
      budgetPerDay: '₹2,500–4,500/day',
      highlights: 'Munnar, Alleppey, Kochi, Varkala',
      samplePlan: ['Kochi heritage walk', 'Munnar tea hills', 'Alleppey backwaters', 'Varkala or beach time'],
    },
    munnar: {
      title: 'Munnar',
      bestTime: 'Sep–Mar',
      budgetPerDay: '₹2,500–4,000/day',
      highlights: 'Tea gardens, Eravikulam Park, Mattupetty Dam',
      samplePlan: ['Tea estate views', 'Eravikulam National Park', 'Dam and scenic stops'],
    },
    jaipur: {
      title: 'Jaipur',
      bestTime: 'Oct–Mar',
      budgetPerDay: '₹2,000–3,500/day',
      highlights: 'Amber Fort, City Palace, Hawa Mahal',
      samplePlan: ['Amber Fort and Jal Mahal', 'City Palace and bazaars', 'Nahargarh sunset'],
    },
    rajasthan: {
      title: 'Rajasthan',
      bestTime: 'Oct–Mar',
      budgetPerDay: '₹2,200–4,000/day',
      highlights: 'Jaipur, Udaipur, Jodhpur, Jaisalmer',
      samplePlan: ['Jaipur forts and bazaars', 'Jodhpur heritage walk', 'Udaipur lakes or Jaisalmer desert experience'],
    },
  };

  if (q.includes('rajasthan') && (q.includes('hidden gem') || q.includes('hidden gems'))) {
    return '🏰 **Hidden Gems in Rajasthan**\n\n1. Bundi: Stepwells, blue lanes, and a quieter fort-town feel.\n2. Kumbhalgarh: Massive fort walls and Aravalli views.\n3. Barmer: Great for textiles, local crafts, and a less-touristy desert vibe.\n4. Mandawa: Painted havelis and small-town heritage charm.\n5. Osian: Desert temples and camel safari option near Jodhpur.\n\n💡 Best for 4–6 days with a budget around ₹12,000–₹24,000 depending on transport and hotel style. Ask me for a Rajasthan route and budget split if you want.';
  }

  const destinationKey = Object.keys(destinationGuides).find(key => q.includes(key));
  if (destinationKey) {
    const guide = destinationGuides[destinationKey];
    if (days || budget) {
      const effectiveDays = days || 3;
      const estimatedMin = effectiveDays * (destinationKey === 'kerala' ? 2500 : 2200);
      const estimatedComfort = effectiveDays * (destinationKey === 'kerala' ? 4200 : 3500);
      const budgetLine = budget
        ? budget >= estimatedMin
          ? `Your budget of ₹${budget.toLocaleString()} can work for about ${effectiveDays} days with a budget-to-midrange plan.`
          : `₹${budget.toLocaleString()} is a bit tight for ${effectiveDays} days. A safer target is around ₹${estimatedMin.toLocaleString()}–₹${estimatedComfort.toLocaleString()}.`
        : `A practical budget for ${effectiveDays} days is about ₹${estimatedMin.toLocaleString()}–₹${estimatedComfort.toLocaleString()}.`;
      return `✨ **${guide.title} ${effectiveDays}-Day Fallback Plan**\n\nBest time: ${guide.bestTime}\nTrip style budget: ${guide.budgetPerDay}\nMain highlights: ${guide.highlights}\n\n${budgetLine}\n\nSuggested flow:\n1. ${guide.samplePlan[0]}\n2. ${guide.samplePlan[1]}\n3. ${guide.samplePlan[2] || guide.samplePlan[guide.samplePlan.length - 1]}\n${effectiveDays >= 4 && guide.samplePlan[3] ? `4. ${guide.samplePlan[3]}\n` : ''}\n💡 Ask for “budget hotel ideas in ${guide.title}” or “${guide.title} itinerary” and I’ll keep helping in fallback mode.`;
    }
    return `🌴 **${guide.title}** is a great choice!\n\nBest Time: ${guide.bestTime}\nBudget: ${guide.budgetPerDay}\nMust Do: ${guide.highlights}\n\n💡 Tell me your days + budget, for example: "${guide.title} 5 days 15000".`;
  }

  if (q.includes('weather')) return '🌡️ Live weather data is being fetched when available. Ask about a city like Goa, Munnar, Jaipur, or Manali for a more useful travel answer.';
  if (q.includes('budget') || q.includes('cost')) return '💰 **Budget Tips:**\n\n• Budget trip: ₹1,500–3,000/day\n• Mid-range: ₹3,000–6,000/day\n• Luxury: ₹7,000+/day\n\nTell me your destination and number of days, and I’ll estimate a trip cost in fallback mode.';
  if (q.includes('plan') || q.includes('itinerary')) return '📅 I can still help in fallback mode. Tell me:\n1. Destination\n2. Number of days\n3. Budget\n4. Solo/couple/family/friends';
  return '🌟 I’m your Trip for Heaven travel expert. Tell me a destination, days, and budget like "Kerala 5 days 15000" and I’ll give a practical fallback plan.';
}

function normalizeHistory(history = []) {
  const messages = [];
  for (const item of history) {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(item?.content || '').trim();
    if (!content) continue;
    if (messages.length && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += `\n${content}`;
    } else { messages.push({ role, content }); }
  }
  return messages;
}

function getTelegramHistory(chatId) {
  return telegramHistory.get(String(chatId)) || [];
}

function appendTelegramHistory(chatId, role, content) {
  const key = String(chatId);
  const history = getTelegramHistory(key);
  history.push({ role, content: String(content || '').trim() });
  telegramHistory.set(key, history.slice(-12));
}

function formatTelegramReply(reply = '') {
  return String(reply)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
}

async function createAITextResponse(messages) {
  if (!client) { const error = new Error('OPENAI_API_KEY is missing'); error.code = 'missing_api_key'; throw error; }
  // Use Chat Completions API — works cleanly with system/user/assistant roles
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: messages.map(m => ({ role: m.role, content: String(m.content) })),
  temperature: 0.8,
  top_p: 0.9,
  presence_penalty: 0.6
  });
  return (response.choices?.[0]?.message?.content || '').trim();
}

function classifyAIError(err) {
  const message = String(err?.message || '').toLowerCase();
  const status = Number(err?.status || err?.code || 0);
  const quotaExceeded =
    status === 429 ||
    message.includes('429') ||
    message.includes('insufficient_quota') ||
    message.includes('quota') ||
    message.includes('billing');

  const missingKey = err?.code === 'missing_api_key' || message.includes('api key');

  return {
    missingKey,
    quotaExceeded,
    status: Number.isFinite(status) ? status : null,
    publicMessage: missingKey
      ? 'OPENAI_API_KEY is missing on the server.'
      : quotaExceeded
        ? 'OpenAI quota or billing limit reached. The app is using fallback mode until billing is restored.'
        : (err?.message || 'AI request failed'),
  };
}

async function generateChatReply({ prompt, lang, preferences, mood, history } = {}) {
  if (!prompt) {
    const error = new Error('prompt is required');
    error.code = 'missing_prompt';
    throw error;
  }

  const city = detectCity(prompt);
  let liveData = {};
  if (city) {
    try { liveData = await fetchLiveData(city); } catch (e) { /* continue without live data */ }
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(preferences, mood, lang, Object.keys(liveData).length ? liveData : null) },
    ...normalizeHistory((history || []).slice(-8)),
    { role: 'user', content: String(prompt) },
  ];
  const reply = await createAITextResponse(messages);
  return {
    reply: reply || "I couldn't generate a response right now. Please try again.",
    liveData,
  };
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is missing');

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: formatTelegramReply(text).slice(0, 4000) || 'I could not generate a reply right now.',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed (${response.status}): ${errorText || 'unknown error'}`);
  }
}

async function fetchTelegramApi(method, payload = {}) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is missing');

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const description = data?.description || `HTTP ${response.status}`;
    throw new Error(`Telegram ${method} failed: ${description}`);
  }
  return data.result;
}

async function registerTelegramWebhook() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_URL) return null;

  return fetchTelegramApi('setWebhook', {
    url: TELEGRAM_WEBHOOK_URL,
    secret_token: TELEGRAM_WEBHOOK_SECRET || undefined,
    allowed_updates: ['message', 'edited_message'],
    drop_pending_updates: false,
  });
}

async function getTelegramWebhookInfo() {
  if (!TELEGRAM_BOT_TOKEN) return null;
  return fetchTelegramApi('getWebhookInfo');
}

function isValidTelegramWebhook(req) {
  if (!TELEGRAM_WEBHOOK_SECRET) return true;
  return req.get('x-telegram-bot-api-secret-token') === TELEGRAM_WEBHOOK_SECRET;
}

// Helper to fetch live data for a city
async function fetchLiveData(city) {
  const liveData = {};
  const baseUrl = `http://localhost:${defaultPort}`;
  try {
    if (city) {
      const [wResp, tResp] = await Promise.allSettled([
        fetch(`${baseUrl}/api/weather/${encodeURIComponent(city)}`).then(r=>r.json()),
        fetch(`${baseUrl}/api/travel-info/${encodeURIComponent(city)}`).then(r=>r.json())
      ]);
      if (wResp.status === 'fulfilled' && !wResp.value.error) liveData.weather = wResp.value;
      if (tResp.status === 'fulfilled') liveData.travelInfo = tResp.value;
    }
    const eResp = await fetch(`${baseUrl}/api/exchange-rates`).then(r=>r.json()).catch(()=>null);
    if (eResp && !eResp.error) liveData.exchangeRates = eResp;
  } catch(e) { /* silent */ }
  return liveData;
}

// Detect city from prompt
function detectCity(prompt) {
  const q = (prompt || '').toLowerCase();
  const cities = ['goa','manali','jodhpur','munnar','delhi','andaman','varkala','mysore','mumbai','kodaikanal','ooty','coorg','jaipur','udaipur','shimla','rishikesh','varanasi','agra','kochi','darjeeling','leh','ladakh'];
  return cities.find(c => q.includes(c)) || null;
}

const SUPPORTED_DESTINATIONS = {
  goa: {
    title: 'Goa',
    state: 'Goa',
    bestTime: 'November to February',
    budgetPerDay: 'Rs. 2,500 to Rs. 4,500/day',
    luxuryPerDay: 'Rs. 9,000 to Rs. 18,000/day',
    flightRange: 'Rs. 4,500 to Rs. 11,000 round trip',
    trainInfo: 'Madgaon or Thivim by train; sleeper around Rs. 500 to Rs. 1,200, 3AC around Rs. 1,400 to Rs. 2,400',
    highlights: 'Baga Beach, Fort Aguada, Old Goa churches, Dudhsagar Falls',
    hiddenGems: 'Divar Island, Butterfly Beach',
    hiddenGemSpots: ['Divar Island - peaceful village with no crowd', 'Butterfly Beach - secluded beach with dolphin views', 'Kakolem Beach - hidden untouched beach', 'Chorla Ghats - nature, greenery, and waterfalls'],
    food: 'Goan fish curry, prawn balchao, bebinca',
    foodMustTry: ['Fish Thali', 'Prawn Balchao', 'Bebinca'],
    foodSpots: ['Britto\'s (Baga)', 'Thalassa (Vagator)', 'Fisherman\'s Wharf'],
    budgetHotels: ['Zostel Goa - Rs. 1200/night', 'OYO Rooms Calangute - Rs. 2200/night'],
    premiumHotels: ['Taj Cidade de Goa - Rs. 13000/night', 'W Goa - Rs. 18000/night'],
    hotelAreas: ['Baga - best for nightlife and easy beach access', 'Palolem - best for peaceful stays and relaxed vibe'],
    airport: 'Dabolim / Manohar International Airport - Rs. 4,500 to Rs. 11,000',
    mainStation: 'Madgaon / Thivim - direct trains from Mumbai, Delhi, Bengaluru',
    roadInfo: 'From Mumbai - about 590 km',
    nearbyPlaces: ['Gokarna - about 140 km, great for quieter beaches', 'Divar Island - short ferry route, great for peaceful village charm'],
    seasonalInfo: {
      best: 'Winter (Nov-Feb) - beaches, parties, and the best weather',
      other: ['Summer (Mar-May) - hot but cheaper', 'Monsoon (Jun-Sep) - green landscapes, waterfalls, and less crowd'],
      avoid: 'Peak summer afternoons - weather gets too hot for long beach days'
    },
    avoid: 'Avoid peak party beaches if you want a quiet stay',
    savingsTip: 'Stay in Palolem or inland areas for cheaper rooms',
    safetyTip: 'Avoid isolated beaches late at night and check swimming flags',
    samplePlan: ['North Goa beaches and cafes', 'Forts and Old Goa', 'South Goa beach day or Dudhsagar']
  },
  manali: {
    title: 'Manali',
    state: 'Himachal Pradesh',
    bestTime: 'March to June for sightseeing, December to February for snow',
    budgetPerDay: 'Rs. 3,000 to Rs. 5,000/day',
    luxuryPerDay: 'Rs. 10,000 to Rs. 20,000/day',
    flightRange: 'Rs. 6,000 to Rs. 14,000 via Kullu or Chandigarh plus road transfer',
    trainInfo: 'No direct train; use Chandigarh or Ambala railhead, then Volvo or taxi',
    highlights: 'Solang Valley, Hadimba Temple, Old Manali, Atal Tunnel',
    hiddenGems: 'Jogini Waterfall, Sethan village',
    hiddenGemSpots: ['Sethan Valley - snow views without the crowd', 'Hampta Village - local Himachal vibe and quiet lanes', 'Jogini Waterfall hidden side - calmer trail and scenic walk', 'Gulaba - peaceful alternative to Rohtang'],
    food: 'Siddu, trout, Himachali dham',
    foodMustTry: ['Trout fish', 'Siddu', 'Momos and thukpa'],
    foodSpots: ['Johnson\'s Cafe', 'Cafe 1947', 'Chopsticks Restaurant'],
    budgetHotels: ['Zostel Old Manali - Rs. 1200/night', 'Vashisht guesthouse stays - Rs. 1800/night'],
    premiumHotels: ['The Himalayan - Rs. 12000/night', 'Span Resort - Rs. 15000/night'],
    hotelAreas: ['Old Manali - best for cafes and backpacker vibe', 'Vashisht - best for quieter stays and hot springs access'],
    airport: 'Kullu Airport - Rs. 6,000 to Rs. 14,000',
    mainStation: 'Chandigarh or Ambala - then bus or taxi to Manali',
    roadInfo: 'From Delhi - about 540 km',
    nearbyPlaces: ['Sethan - around 12 km, good for snow views and quiet stays', 'Kasol - about 75 km, great for cafes and river views'],
    seasonalInfo: {
      best: 'Winter (Dec-Feb) - snow, adventure, and mountain views',
      other: ['Summer (Mar-Jun) - pleasant escape from the heat', 'Monsoon (Jul-Sep) - green scenery but weather can be unstable'],
      avoid: 'Monsoon travel on risky hill roads because of landslide chances'
    },
    avoid: 'Avoid risky night driving in snow or heavy rain',
    savingsTip: 'Use Volvo buses from Delhi instead of private cabs',
    safetyTip: 'Check weather and road status before heading to Solang or Rohtang side',
    samplePlan: ['Old Manali and Hadimba Temple', 'Solang Valley adventure', 'Vashisht or Sethan village']
  },
  mumbai: {
    title: 'Mumbai',
    state: 'Maharashtra',
    bestTime: 'November to February',
    budgetPerDay: 'Rs. 3,000 to Rs. 6,000/day',
    luxuryPerDay: 'Rs. 12,000 to Rs. 30,000/day',
    flightRange: 'Rs. 3,500 to Rs. 10,000 round trip',
    trainInfo: 'Excellent rail access to CSMT, Dadar, Mumbai Central, and LTT',
    highlights: 'Marine Drive, Gateway of India, Colaba, Bandra',
    hiddenGems: 'Khotachiwadi, Sewri flamingo point in season',
    hiddenGemSpots: ['Banganga Tank - calm historic waterfront spot', 'Khotachiwadi - charming old Portuguese-style colony', 'Gilbert Hill - rare volcanic hill inside the city', 'Sewri Fort - flamingo point and harbor views'],
    food: 'Vada pav, pav bhaji, seafood, Bombay sandwich',
    foodMustTry: ['Vada Pav', 'Pav Bhaji', 'Bombay Sandwich'],
    foodSpots: ['Ashok Vada Pav', 'Sardar Pav Bhaji', 'Leopold Cafe'],
    budgetHotels: ['Hotel in Andheri - Rs. 2500/night', 'Value stay in Colaba - Rs. 3200/night'],
    premiumHotels: ['Taj Mahal Palace - Rs. 22000/night', 'The Oberoi Mumbai - Rs. 24000/night'],
    hotelAreas: ['Colaba - best for sightseeing and cafes', 'Andheri - best for airport access and budget stays'],
    airport: 'CSMIA Mumbai - Rs. 3,500 to Rs. 10,000',
    mainStation: 'CSMT / Dadar / Mumbai Central - major national routes',
    roadInfo: 'From Pune - about 150 km',
    nearbyPlaces: ['Lonavala - about 85 km, popular for hills and short drives', 'Alibaug - ferry or road trip, great for coastal break'],
    seasonalInfo: {
      best: 'Winter (Nov-Feb) - most comfortable city weather',
      other: ['Summer (Mar-May) - hot and humid but workable for short trips', 'Monsoon (Jun-Sep) - scenic rain vibe if you enjoy monsoon mood'],
      avoid: 'Heavy monsoon commute hours if you want smooth sightseeing'
    },
    avoid: 'Avoid long road travel during monsoon flooding hours',
    savingsTip: 'Use local trains and metros for cheap city transport',
    safetyTip: 'Watch your belongings in crowded stations and tourist zones',
    samplePlan: ['Colaba and Fort district', 'Bandra and sea-facing cafes', 'Marine Drive and local food trail']
  },
  delhi: {
    title: 'Delhi',
    state: 'Delhi NCR',
    bestTime: 'October to March',
    budgetPerDay: 'Rs. 2,500 to Rs. 5,000/day',
    luxuryPerDay: 'Rs. 10,000 to Rs. 25,000/day',
    flightRange: 'Rs. 3,000 to Rs. 9,000 round trip',
    trainInfo: 'Strong train network through New Delhi, Hazrat Nizamuddin, and Anand Vihar',
    highlights: 'India Gate, Red Fort, Humayun Tomb, Chandni Chowk',
    hiddenGems: 'Sunder Nursery, Agrasen ki Baoli',
    hiddenGemSpots: ['Agrasen Ki Baoli - ancient stepwell in the city center', 'Sanjay Van - forest escape inside Delhi', 'Majnu Ka Tilla - Tibetan cafes and local vibe', 'Mehrauli Archaeological Park - ruins with nature trails'],
    food: 'Chaat, kebabs, parathas, butter chicken',
    foodMustTry: ['Chole Bhature', 'Butter Chicken', 'Parathas'],
    foodSpots: ['Karim\'s', 'Paranthe Wali Gali', 'Indian Accent'],
    budgetHotels: ['Bloomrooms Paharganj - Rs. 2800/night', 'Zostel Delhi - Rs. 900/night'],
    premiumHotels: ['The Leela Palace - Rs. 25000/night', 'The Lodhi - Rs. 22000/night'],
    hotelAreas: ['Paharganj - best for budget travelers and station access', 'Aerocity - best for premium stays and airport access'],
    airport: 'IGI Airport - Rs. 3,000 to Rs. 9,000',
    mainStation: 'New Delhi / Hazrat Nizamuddin - excellent rail links',
    roadInfo: 'From Jaipur - about 280 km',
    nearbyPlaces: ['Agra - about 230 km, ideal for Taj Mahal trip', 'Neemrana - about 120 km, good for a quick heritage getaway'],
    seasonalInfo: {
      best: 'Winter (Oct-Feb) - ideal weather for sightseeing',
      other: ['Monsoon (Jul-Sep) - moderate rain and greener city pockets'],
      avoid: 'Summer (Apr-Jun) - very hot for outdoor travel'
    },
    avoid: 'Avoid outdoor sightseeing in extreme summer afternoons',
    savingsTip: 'Use metro passes for cheaper city travel',
    safetyTip: 'Prefer registered cabs at night and avoid isolated lanes',
    samplePlan: ['Old Delhi heritage and food', 'Central Delhi landmarks', 'South Delhi cafes and gardens']
  },
  andaman: {
    title: 'Andaman',
    state: 'Andaman and Nicobar Islands',
    bestTime: 'November to April',
    budgetPerDay: 'Rs. 4,000 to Rs. 7,000/day',
    luxuryPerDay: 'Rs. 12,000 to Rs. 28,000/day',
    flightRange: 'Rs. 8,000 to Rs. 18,000 round trip to Port Blair',
    trainInfo: 'No train route; flight and ferry are the practical options',
    highlights: 'Radhanagar Beach, Cellular Jail, Havelock, Neil Island',
    hiddenGems: 'Kalapathar Beach, Chidiya Tapu sunset',
    hiddenGemSpots: ['Kalapathar Beach - quiet sunrise spot', 'Long Island - less touristy island escape', 'Lalaji Bay - crystal clear water and peaceful shore', 'Chidiya Tapu - sunset views and birdwatching'],
    food: 'Seafood platters, grilled fish, coconut-based island meals',
    foodMustTry: ['Seafood platter', 'Grilled fish'],
    foodSpots: ['New Lighthouse Restaurant', 'Full Moon Cafe'],
    budgetHotels: ['Port Blair guesthouse - Rs. 2500/night', 'Havelock budget stay - Rs. 3200/night'],
    premiumHotels: ['Taj Exotica Andaman - Rs. 28000/night', 'Barefoot at Havelock - Rs. 18000/night'],
    hotelAreas: ['Port Blair - best for short stays and ferry access', 'Havelock - best for beaches and premium resorts'],
    airport: 'Port Blair Airport - Rs. 8,000 to Rs. 18,000',
    mainStation: 'No train access; flights and ferries only',
    roadInfo: 'Local road travel mainly within islands',
    nearbyPlaces: ['Neil Island - ferry ride, great for calm beaches', 'Chidiya Tapu - short drive, ideal for sunset'],
    seasonalInfo: {
      best: 'Winter (Nov-May) - best for beaches, ferries, and water activities',
      other: ['Early summer - still good before rough sea conditions start'],
      avoid: 'Monsoon (Jun-Sep) - not ideal because of rough sea and ferry disruption'
    },
    avoid: 'Avoid last-minute ferry booking in peak season',
    savingsTip: 'Book ferries and stays early for better rates',
    safetyTip: 'Follow water activity safety instructions and weather alerts',
    samplePlan: ['Port Blair highlights', 'Havelock beaches and water sports', 'Neil Island or Chidiya Tapu']
  },
  munnar: {
    title: 'Munnar',
    state: 'Kerala',
    bestTime: 'September to March',
    budgetPerDay: 'Rs. 2,500 to Rs. 4,500/day',
    luxuryPerDay: 'Rs. 8,000 to Rs. 18,000/day',
    flightRange: 'Rs. 5,000 to Rs. 12,000 via Kochi plus road transfer',
    trainInfo: 'Nearest useful railheads are Aluva or Ernakulam, then taxi or bus',
    highlights: 'Tea gardens, Eravikulam National Park, Mattupetty Dam, Top Station',
    hiddenGems: 'Kolukkumalai sunrise point, Chokramudi trail',
    hiddenGemSpots: ['Kolukkumalai - highest tea estate with dramatic views', 'Lockhart Estate - peaceful scenic tea walks', 'Anayirangal Dam - known for elephant spotting', 'Pampadum Shola - untouched forest feel'],
    food: 'Appam with stew, Kerala meals, cardamom tea',
    foodMustTry: ['Kerala Sadya', 'Appam and stew'],
    foodSpots: ['Saravana Bhavan', 'Rapsy Restaurant'],
    budgetHotels: ['Zostel Munnar - Rs. 1100/night', 'Green View Cottages - Rs. 2800/night'],
    premiumHotels: ['Windermere Estate - Rs. 19000/night', 'Fragrant Nature Munnar - Rs. 12000/night'],
    hotelAreas: ['Town center - best for food and local transport', 'Tea estate side - best for views and quiet stays'],
    airport: 'Cochin International Airport - Rs. 5,000 to Rs. 12,000',
    mainStation: 'Aluva / Ernakulam - then taxi or bus',
    roadInfo: 'From Kochi - about 125 km',
    nearbyPlaces: ['Thekkady - about 90 km, good for wildlife and spice gardens', 'Marayoor - about 40 km, known for sandalwood and scenic drives'],
    seasonalInfo: {
      best: 'Winter (Sep-Mar) - best climate and clear hill views',
      other: ['Summer (Apr-Jun) - cool escape from city heat', 'Monsoon (Jul-Aug) - lush greenery and misty views'],
      avoid: 'None strictly, but heavy-rain days can slow travel plans'
    },
    avoid: 'Avoid aggressive hill driving during heavy rain',
    savingsTip: 'Use shared jeeps or buses for sightseeing routes',
    safetyTip: 'Start early for hill drives and avoid isolated trails after dark',
    samplePlan: ['Tea estate viewpoints', 'Eravikulam and Mattupetty', 'Top Station or Kolukkumalai']
  },
  mysore: {
    title: 'Mysore',
    state: 'Karnataka',
    bestTime: 'October to February',
    budgetPerDay: 'Rs. 2,200 to Rs. 4,200/day',
    luxuryPerDay: 'Rs. 7,000 to Rs. 15,000/day',
    flightRange: 'Rs. 4,000 to Rs. 10,000 via Mysore or Bengaluru',
    trainInfo: 'Well connected by rail from Bengaluru, Chennai, and Hyderabad',
    highlights: 'Mysore Palace, Chamundi Hills, Brindavan Gardens',
    hiddenGems: 'Karanji Lake, Rail Museum',
    hiddenGemSpots: ['Karanji Lake - quiet bird sanctuary escape', 'Melody Wax Museum - unusual and fun stop', 'Rail Museum - underrated heritage attraction', 'Brindavan Gardens at night - better atmosphere after dark'],
    food: 'Mysore pak, dosa, filter coffee',
    foodMustTry: ['Mysore Pak', 'Masala Dosa'],
    foodSpots: ['Mylari Hotel', 'Vinayaka Mylari'],
    budgetHotels: ['Zostel Mysore - Rs. 750/night', 'Palace road stay - Rs. 2200/night'],
    premiumHotels: ['Royal Orchid Metropole - Rs. 8000/night', 'Radisson Blu Mysore - Rs. 9500/night'],
    hotelAreas: ['Palace area - best for sightseeing', 'Nazarbad - best for premium stays and easy access'],
    airport: 'Mysore Airport / Bengaluru Airport - Rs. 4,000 to Rs. 10,000',
    mainStation: 'Mysuru Junction - direct trains from Bengaluru and Chennai',
    roadInfo: 'From Bengaluru - about 145 km',
    nearbyPlaces: ['Srirangapatna - about 20 km, ideal for history', 'Somnathpur - about 35 km, famous for temple architecture'],
    seasonalInfo: {
      best: 'Winter (Oct-Feb) - best weather for palaces and markets',
      other: ['Summer (Mar-May) - warm but still manageable', 'Monsoon (Jun-Sep) - pleasant with greener surroundings'],
      avoid: 'Peak summer afternoons if you want long outdoor sightseeing'
    },
    avoid: 'Avoid holiday evening crowds at palace and gardens',
    savingsTip: 'Take trains or buses from Bengaluru instead of cabs',
    safetyTip: 'Keep an eye on belongings in crowded festival seasons',
    samplePlan: ['Palace and market', 'Chamundi Hills and zoo', 'Brindavan Gardens evening']
  },
  ooty: {
    title: 'Ooty',
    state: 'Tamil Nadu',
    bestTime: 'March to June and September to November',
    budgetPerDay: 'Rs. 2,500 to Rs. 4,500/day',
    luxuryPerDay: 'Rs. 8,000 to Rs. 16,000/day',
    flightRange: 'Rs. 5,000 to Rs. 12,000 via Coimbatore plus road transfer',
    trainInfo: 'Train to Mettupalayam, then Nilgiri Mountain Railway when available',
    highlights: 'Botanical Garden, Ooty Lake, Doddabetta Peak, toy train',
    hiddenGems: 'Avalanche Lake, Emerald Lake',
    hiddenGemSpots: ['Avalanche Lake - untouched nature and calm scenery', 'Emerald Lake - peaceful lake views', 'Parsons Valley - forest reserve with quiet landscapes', 'Wenlock Downs - wide open grasslands and misty views'],
    food: 'Homemade chocolates, varkey, South Indian meals',
    foodMustTry: ['Homemade chocolates', 'Tea'],
    foodSpots: ['Earl\'s Secret', 'Nahar\'s Sidewalk Cafe'],
    budgetHotels: ['Zostel Ooty - Rs. 800/night', 'Charing Cross stay - Rs. 2400/night'],
    premiumHotels: ['Savoy Ooty - Rs. 12000/night', 'Sterling Ooty Elk Hill - Rs. 9500/night'],
    hotelAreas: ['Charing Cross - best for central access', 'Fern Hill - best for scenic premium stays'],
    airport: 'Coimbatore Airport - Rs. 5,000 to Rs. 12,000',
    mainStation: 'Mettupalayam - then toy train or taxi',
    roadInfo: 'From Coimbatore - about 85 km',
    nearbyPlaces: ['Coonoor - about 20 km, great for tea gardens', 'Pykara - about 25 km, ideal for lake and waterfalls'],
    seasonalInfo: {
      best: 'Summer (Apr-Jun) - best hill station escape',
      other: ['Winter (Oct-Feb) - cold and misty', 'Monsoon (Jul-Sep) - green but wet'],
      avoid: 'Heavy monsoon days if you want clear viewpoints'
    },
    avoid: 'Avoid holiday traffic around lake area during peak season',
    savingsTip: 'Stay slightly outside town for lower hotel prices',
    safetyTip: 'Carry layers because evenings get cold even in warmer months',
    samplePlan: ['Town and lake', 'Doddabetta and tea factory', 'Avalanche or Emerald Lake']
  },
  kodaikanal: {
    title: 'Kodaikanal',
    state: 'Tamil Nadu',
    bestTime: 'October to June',
    budgetPerDay: 'Rs. 2,400 to Rs. 4,200/day',
    luxuryPerDay: 'Rs. 8,000 to Rs. 16,000/day',
    flightRange: 'Rs. 5,000 to Rs. 12,000 via Madurai or Coimbatore plus road transfer',
    trainInfo: 'Kodai Road is the nearest railhead, followed by bus or taxi',
    highlights: 'Kodai Lake, Coaker Walk, Pillar Rocks, Bryant Park',
    hiddenGems: 'Poombarai village, Mannavanur Lake',
    hiddenGemSpots: ['Poombarai Village - farming views and valley charm', 'Mannavanur Lake - quiet lake away from the crowd', 'Dolphin\'s Nose - hidden viewpoint with dramatic valley view', 'Vattakanal - mini hippie village with cafes and trails'],
    food: 'Homemade chocolates, cheese, bakery snacks, hot soups',
    foodMustTry: ['Homemade chocolates', 'Cheese'],
    foodSpots: ['Cloud Street', 'Astoria Veg'],
    budgetHotels: ['Zostel Kodaikanal - Rs. 700/night', 'Lake guesthouse - Rs. 2200/night'],
    premiumHotels: ['The Tamara Kodai - Rs. 14000/night', 'The Carlton - Rs. 16000/night'],
    hotelAreas: ['Near Kodai Lake - best for walking access', 'Upper Lake Road - best for quieter premium stays'],
    airport: 'Madurai Airport - Rs. 5,000 to Rs. 12,000',
    mainStation: 'Kodai Road - then cab or bus uphill',
    roadInfo: 'From Madurai - about 120 km',
    nearbyPlaces: ['Poombarai - about 18 km, scenic village stop', 'Mannavanur - about 35 km, great for meadows and lake views'],
    seasonalInfo: {
      best: 'Summer (Apr-Jun) - best climate and easy sightseeing',
      other: ['Winter (Oct-Feb) - cool and cozy', 'Monsoon (Jul-Sep) - scenic and misty'],
      avoid: 'Foggy late-night drives during wet months'
    },
    avoid: 'Avoid late-night hill driving in fog',
    savingsTip: 'Use shared cabs for local sightseeing circuits',
    safetyTip: 'Wear good shoes for viewpoints and wet paths',
    samplePlan: ['Lake and Coaker Walk', 'Pillar Rocks and pine forest', 'Poombarai or Mannavanur']
  },
  coorg: {
    title: 'Coorg',
    state: 'Karnataka',
    bestTime: 'October to March',
    budgetPerDay: 'Rs. 2,800 to Rs. 4,800/day',
    luxuryPerDay: 'Rs. 9,000 to Rs. 18,000/day',
    flightRange: 'Rs. 4,500 to Rs. 11,000 via Mangaluru, Kannur, or Bengaluru plus road transfer',
    trainInfo: 'No direct train; Mysore is the easiest railhead',
    highlights: 'Abbey Falls, Raja Seat, Dubare, coffee estates',
    hiddenGems: 'Mandalpatti viewpoint, Chiklihole Reservoir',
    hiddenGemSpots: ['Mandalpatti - jeep ride with cloud-level views', 'Iruppu Falls - less crowded waterfall stop', 'Chiklihole Reservoir - peaceful sunset point', 'Nalknad Palace - hidden slice of local history'],
    food: 'Pandi curry, akki roti, filter coffee',
    foodMustTry: ['Pandi Curry', 'Kadambuttu'],
    foodSpots: ['Coorg Cuisine', 'Raintree Restaurant'],
    budgetHotels: ['Zostel Coorg - Rs. 900/night', 'Madikeri homestay - Rs. 2500/night'],
    premiumHotels: ['Evolve Back Coorg - Rs. 18000/night', 'Taj Madikeri Resort - Rs. 17000/night'],
    hotelAreas: ['Madikeri - best for base stay and food', 'Coffee estate belt - best for views and quiet resorts'],
    airport: 'Kannur / Mangaluru / Bengaluru Airport - Rs. 4,500 to Rs. 11,000',
    mainStation: 'Mysuru Junction - then road trip to Coorg',
    roadInfo: 'From Bengaluru - about 265 km',
    nearbyPlaces: ['Dubare - around 30 km, good for river activities', 'Talakaveri - around 45 km, scenic and spiritual stop'],
    seasonalInfo: {
      best: 'Winter (Oct-Mar) - best overall weather for travel',
      other: ['Monsoon (Jun-Sep) - best for waterfalls and greenery', 'Summer (Apr-May) - mild and comfortable'],
      avoid: 'Peak monsoon trekking days if roads or trails are slippery'
    },
    avoid: 'Avoid monsoon trekking without checking trail conditions',
    savingsTip: 'Choose homestays in Madikeri for better value',
    safetyTip: 'Drive carefully on ghat roads, especially in rain or fog',
    samplePlan: ['Madikeri sightseeing', 'Coffee estate and waterfall trail', 'Mandalpatti or Dubare']
  },
  jodhpur: {
    title: 'Jodhpur',
    state: 'Rajasthan',
    bestTime: 'October to March',
    budgetPerDay: 'Rs. 2,500 to Rs. 4,500/day',
    luxuryPerDay: 'Rs. 9,000 to Rs. 20,000/day',
    flightRange: 'Rs. 5,000 to Rs. 12,000 round trip',
    trainInfo: 'Good rail access to Jodhpur Junction from Delhi, Jaipur, Ahmedabad, and Mumbai',
    highlights: 'Mehrangarh Fort, Jaswant Thada, Clock Tower, blue city lanes',
    hiddenGems: 'Toorji ka Jhalra, Rao Jodha Desert Rock Park',
    hiddenGemSpots: ['Toorji Ka Jhalra - beautiful old stepwell', 'Desert Rock Park - nature trails with fort views', 'Mandore Gardens - ruins and quiet heritage corners', 'Osian Village - desert experience beyond the city'],
    food: 'Makhaniya lassi, mirchi vada, dal baati churma',
    foodMustTry: ['Dal Baati Churma', 'Mirchi Bada'],
    foodSpots: ['Gypsy Restaurant', 'Janta Sweet Home'],
    budgetHotels: ['Zostel Jodhpur - Rs. 800/night', 'Haveli stay near Clock Tower - Rs. 2500/night'],
    premiumHotels: ['RAAS Jodhpur - Rs. 22000/night', 'Umaid Bhawan Palace - Rs. 35000/night'],
    hotelAreas: ['Clock Tower area - best for markets and food', 'Near Mehrangarh - best for heritage stays'],
    airport: 'Jodhpur Airport - Rs. 5,000 to Rs. 12,000',
    mainStation: 'Jodhpur Junction - direct trains from Delhi, Jaipur, Ahmedabad',
    roadInfo: 'From Jaipur - about 350 km',
    nearbyPlaces: ['Osian - about 65 km, desert temples and dunes', 'Mandore - about 10 km, gardens and heritage ruins'],
    seasonalInfo: {
      best: 'Winter (Oct-Mar) - best desert weather',
      other: ['Monsoon (Jul-Sep) - short rains with some relief from heat'],
      avoid: 'Summer (Apr-Jun) - very hot for daytime sightseeing'
    },
    avoid: 'Avoid outdoor sightseeing in strong afternoon heat',
    savingsTip: 'Choose haveli stays near the old city for better value',
    safetyTip: 'Carry water and sun protection during daytime exploration',
    samplePlan: ['Mehrangarh and blue city walk', 'Jaswant Thada and food trail', 'Osian or desert-style evening']
  },
  varkala: {
    title: 'Varkala',
    state: 'Kerala',
    bestTime: 'October to March',
    budgetPerDay: 'Rs. 2,500 to Rs. 4,500/day',
    luxuryPerDay: 'Rs. 8,000 to Rs. 16,000/day',
    flightRange: 'Rs. 5,000 to Rs. 12,000 via Thiruvananthapuram',
    trainInfo: 'Varkala Sivagiri station is the easiest rail stop',
    highlights: 'Varkala Cliff, Papanasam Beach, Kappil backwaters',
    hiddenGems: 'Edava Beach, Black Sand Beach stretch',
    hiddenGemSpots: ['Kappil Beach - rare sea and backwaters view together', 'Edava Beach - peaceful and less crowded shore', 'Anchuthengu Fort - history by the coast', 'Odayam Beach - calm stay area with relaxed vibe'],
    food: 'Kerala seafood, appam, smoothie bowls, cafe brunches',
    foodMustTry: ['Seafood', 'Kerala meals'],
    foodSpots: ['Darjeeling Cafe', 'Cafe del Mar'],
    budgetHotels: ['North Cliff guesthouse - Rs. 2200/night', 'Clifftop hostel - Rs. 1200/night'],
    premiumHotels: ['B Canti Boutique Resort - Rs. 9000/night', 'Gateway Varkala - Rs. 11000/night'],
    hotelAreas: ['North Cliff - best for cafes and views', 'South Cliff - best for quieter beach stays'],
    airport: 'Thiruvananthapuram Airport - Rs. 5,000 to Rs. 12,000',
    mainStation: 'Varkala Sivagiri - direct rail access from Kerala cities',
    roadInfo: 'From Thiruvananthapuram - about 45 km',
    nearbyPlaces: ['Kappil - about 7 km, backwaters and quiet beach', 'Kovalam - about 55 km, popular beach extension'],
    seasonalInfo: {
      best: 'Winter (Oct-Mar) - best beach weather and easy travel',
      other: ['Summer (Apr-May) - warm but manageable', 'Monsoon (Jun-Sep) - calm, green, and less crowded'],
      avoid: 'Rough-sea days during monsoon if beach swimming is your main plan'
    },
    avoid: 'Avoid rough-sea swimming warnings during monsoon',
    savingsTip: 'Book cliff stays slightly away from the busiest strip',
    safetyTip: 'Use well-lit cliff paths at night and follow beach safety flags',
    samplePlan: ['Cliff walk and sunset beach', 'Backwaters and cafe hopping', 'Ayurveda or yoga day']
  }
};

function detectQueryIntent(prompt = '') {
  const q = String(prompt).toLowerCase();
  if (/^(hi|hello|hey|namaste)\b/.test(q)) return 'greeting';
  if (q.includes('compare')) return 'compare';
  if (q.includes('weather') || q.includes('today') || q.includes('now') || q.includes('current')) return 'weather';
  if (q.includes('best time to visit') || q.includes('which season is best') || q.includes('best season') || q.includes('summer places') || q.includes('winter travel') || q.includes('rainy season trip') || q.includes('best places in summer') || q.includes('where to go in winter') || q.includes('winter trip ideas') || q.includes('monsoon trip') || q.includes('rainy season') || q.includes('summer trip') || q.includes('autumn trip') || q.includes('best season places') || q.includes('where to go in summer') || q.includes('where to go in winter') || q.includes('where to go in monsoon') || q.includes('where to go in autumn') || q.includes('best places for summer') || q.includes('best places for winter') || q.includes('best places for monsoon') || q.includes('best places for autumn')) return 'season';
  if (q.includes('full plan') || q.includes('full trip') || q.includes('complete trip')) return 'full_trip';
  if (q.includes('hidden gem') || q.includes('hidden gems') || q.includes('hidden place') || q.includes('hidden places') || q.includes('secret spot') || q.includes('secret spots')) return 'hidden_gems';
  if (q.includes('nearby') || q.includes('near by') || q.includes('places near')) return 'nearby';
  if (q.includes('route') || q.includes('reach') || q.includes('how to go') || q.includes('how to reach')) return 'routes';
  if (q.includes('hotel') || q.includes('stay') || q.includes('resort')) return 'hotels';
  if (q.includes('food') || q.includes('restaurant') || q.includes('eat') || q.includes('dish')) return 'food';
  if (q.includes('cost') || q.includes('budget') || q.includes('price')) return 'cost';
  if (q.includes('plan') || q.includes('trip') || q.includes('itinerary')) return 'plan';
  if (q.includes('image') || q.includes('photo') || q.includes('picture')) return 'image';
  return 'general';
}

function renderFoodReply(guide) {
  return `🍽️ Food in ${guide.title}\n\n🔥 Must Try:\n- ${guide.foodMustTry.join('\n- ')}\n\n📍 Best Food Spots:\n- ${guide.foodSpots.join('\n- ')}`;
}

function renderHotelReply(guide) {
  return `🏨 Hotels in ${guide.title}\n\n💰 Budget:\n- ${guide.budgetHotels.join('\n- ')}\n\n🌟 Premium:\n- ${guide.premiumHotels.join('\n- ')}\n\n📍 Best areas:\n- ${guide.hotelAreas.join('\n- ')}`;
}

function renderCostReply(guide, days = 3, budget = null) {
  const budgetTripMin = days * 4300;
  const budgetTripMax = days * 7200;
  const premiumTripMin = days * 12000;
  const budgetNote = budget
    ? budget >= budgetTripMin
      ? `- Your budget of Rs. ${budget.toLocaleString()} can work for this trip`
      : `- Rs. ${budget.toLocaleString()} is tight; safer budget range is Rs. ${budgetTripMin.toLocaleString()} to Rs. ${budgetTripMax.toLocaleString()}`
    : null;
  return `💸 Estimated Trip Cost for ${guide.title}\n\n✈️ Travel:\n- Flight: ${guide.flightRange.replace('round trip', '').trim()}\n- Train: ${guide.trainInfo}\n\n🏨 Stay (per night):\n- Budget: ${guide.budgetHotels[0].split(' - ')[1]}\n- Premium: ${guide.premiumHotels[0].split(' - ')[1]}\n\n🍽️ Food (per day):\n- Rs. 300 - Rs. 1000\n\n🚕 Local transport:\n- Rs. 500 - Rs. 1500/day\n\n🎯 Total Estimate:\n- Budget Trip (${days} days): Rs. ${budgetTripMin.toLocaleString()} - Rs. ${budgetTripMax.toLocaleString()}\n- Premium Trip: Rs. ${premiumTripMin.toLocaleString()}+\n${budgetNote ? `\n${budgetNote}` : ''}`;
}

function renderPlanReply(guide) {
  const foodSpot1 = guide.foodSpots[0] || 'local food spot';
  const foodSpot2 = guide.foodSpots[1] || foodSpot1;
  const foodSpot3 = guide.foodSpots[2] || foodSpot2;
  return `📅 3-Day Plan for ${guide.title}\n\nDay 1:\n- ${guide.samplePlan[0]}\n- Food spot: ${foodSpot1}\n\nDay 2:\n- ${guide.samplePlan[1]}\n- Food spot: ${foodSpot2}\n\nDay 3:\n- ${guide.samplePlan[2]}\n- Food spot: ${foodSpot3}`;
}

function renderRoutesReply(guide) {
  return `🛣️ How to Reach ${guide.title}\n\n✈️ By Air:\n- ${guide.airport}\n\n🚆 By Train:\n- ${guide.mainStation}\n\n🚗 By Road:\n- ${guide.roadInfo}`;
}

function renderNearbyReply(guide) {
  return `📍 Nearby Places from ${guide.title}\n\n- ${guide.nearbyPlaces.join('\n- ')}`;
}

function renderHiddenGemsReply(guide) {
  return `🌟 Hidden Gems in ${guide.title}\n\n- ${guide.hiddenGemSpots.join('\n- ')}`;
}

function detectSeasonType(prompt = '') {
  const q = String(prompt).toLowerCase();
  if (q.includes('summer')) return 'summer';
  if (q.includes('winter')) return 'winter';
  if (q.includes('monsoon') || q.includes('rainy')) return 'monsoon';
  if (q.includes('autumn')) return 'autumn';
  return null;
}

function renderAllSeasonSuggestionsReply() {
  return `🌍 Best Places by Season

- Summer: Manali, Ooty, Kodaikanal, Munnar, Coorg
- Monsoon: Munnar, Coorg, Goa, Varkala
- Winter: Goa, Manali, Jodhpur, Varkala, Delhi
- Autumn: Mysore, Andaman, Ooty, Kodaikanal`;
}

function renderSeasonReply(guide) {
  return `🌦️ Best Time to Visit ${guide.title}\n\n✅ Best Season:\n- ${guide.seasonalInfo.best}\n\n🌤️ Other Options:\n- ${guide.seasonalInfo.other.join('\n- ')}\n\n⚠️ Avoid:\n- ${guide.seasonalInfo.avoid}`;
}

function renderSeasonSuggestionsReply(season) {
  const seasonMap = {
    summer: {
      title: 'Summer',
      places: ['Manali - cool weather and mountains', 'Ooty - pleasant hill climate', 'Kodaikanal - peaceful and scenic', 'Munnar - tea gardens and cool air', 'Coorg - mild and green']
    },
    winter: {
      title: 'Winter',
      places: ['Goa - beaches and nightlife', 'Manali - snow experience', 'Jodhpur - pleasant desert weather', 'Varkala - perfect beach weather', 'Delhi - best climate for sightseeing']
    },
    monsoon: {
      title: 'Monsoon',
      places: ['Munnar - lush greenery', 'Coorg - waterfalls at peak', 'Goa - quiet and scenic', 'Varkala - calm and less crowded']
    },
    autumn: {
      title: 'Autumn',
      places: ['Mysore - festivals and culture', 'Andaman - clear skies and beaches', 'Ooty - fresh greenery', 'Kodaikanal - scenic beauty']
    }
  };
  const info = seasonMap[season];
  if (!info) return null;
  return `🌍 Best Places for ${info.title}\n\n- ${info.places.join('\n- ')}`;
}

function renderTipsReply(guide) {
  return `💡 Travel Tips:\n\n- Best time to visit: ${guide.bestTime}\n- What to avoid: ${guide.avoid}\n- Budget saving tip: ${guide.savingsTip}\n- Safety tip: ${guide.safetyTip}`;
}

function renderFullTripReply(guide, days = 3, budget = null) {
  return [
    renderPlanReply(guide),
    '',
    renderCostReply(guide, days, budget),
    '',
    renderFoodReply(guide),
    '',
    renderRoutesReply(guide),
    '',
    renderNearbyReply(guide),
    '',
    renderTipsReply(guide)
  ].join('\n');
}

function buildSystemPrompt(preferences, mood, lang, liveData) {
  let system = `You are "Trip for Heaven" AI Travel Expert, a smart, real-time, friendly travel assistant.

Core behavior:
- Answer ONLY what the user asks.
- Reply like a real human travel expert: warm, conversational, slightly enthusiastic.
- Never sound robotic, random, generic, or repetitive.
- Understand the user's intent clearly before answering.
- Keep responses unique every time.
- No long paragraphs.
- Keep answers concise unless the user asks for more detail.
- Use short sections and bullet points so replies stay clean and readable.
- If the user says "hi", greet naturally and ask how you can help.

Primary destinations:
- Goa
- Manali
- Mumbai
- Delhi
- Andaman
- Munnar
- Mysore
- Ooty
- Kodaikanal
- Coorg
- Jodhpur
- Varkala

For each supported destination, be ready to provide best time, state, weather, budget and luxury cost, flight cost range, train route, top attractions, at least 2 hidden gems, food specialties, 2 budget hotels, 2 premium hotels, 2 to 5 day itinerary, nearby places, transport options, safety tips, and seasonal advice.

Intent handling:
1. Greeting -> friendly intro plus a help question.
2. Hotels query -> show only hotels.
3. Food query -> show only must-try food and food spots.
4. Cost query -> show only cost.
5. Plan trip query -> show itinerary plus food spots.
6. Routes query -> show only how to reach the place.
7. Nearby places query -> show only nearby places.
8. Hidden gems query -> show only hidden places or secret spots.
9. Season query -> answer directly with best season details for a place, or give season-based destination suggestions.
10. Full trip query -> include plan, cost, food, routes, nearby places, and travel tips.
11. Comparison query -> clean comparison.
12. General destination query -> short practical answer only for what was asked.

Style rules:
- Keep the tone friendly, conversational, and lightly enthusiastic.
- Use light emoji only when helpful.
- Avoid repeated phrases and filler.
- Do not give irrelevant information.
- Do not mix everything in one answer.
- Structure replies with short sections and bullets.
- Keep each answer focused on the exact request.
- Understand user meaning even if wording changes, like "ooty route", "routes to ooty", and "how to reach ooty".
- If a supported place is already mentioned, answer directly without asking the user to retype the destination.
- If the user asks any season-related general query, answer directly with suggestions and never ask for more details.
- If the user mentions budget, optimize for value.
- If the user mentions honeymoon, focus on romantic spots.
- If the user mentions family, focus on safe easy travel.
- If the user mentions solo, include hostels and safety tips.
- If the user asks for images, provide 2 to 3 relevant image links with a short description.
- If the user asks about today, now, or current weather, use live data when available.
- If live data is partial or uncertain, say exactly: "Based on latest available data..."
- Never pretend to know live facts that are not present in the provided data.
- Use realistic INR ranges instead of fake precision.
- If the request is unclear, ask one short clarifying question.

Output formats:
- Hotels:
  🏨 Hotels in [Place]
  💰 Budget:
  - Hotel - price
  🌟 Premium:
  - Hotel - price
  📍 Best areas:
  - Area - reason
- Food:
  🍽️ Food in [Place]
  🔥 Must Try:
  - Dish
  📍 Best Food Spots:
  - Place (area)
- Cost:
  💸 Estimated Trip Cost for [Place]
  ✈️ Travel
  🏨 Stay
  🍽️ Food
  🚕 Local transport
  🎯 Total Estimate
- Routes:
  🛣️ How to Reach [Place]
  ✈️ By Air
  🚆 By Train
  🚗 By Road
- Nearby:
  📍 Nearby Places from [Place]
  - Place - distance + why visit
- Hidden gems:
  🌟 Hidden Gems in [Place]
  - Spot - short reason
- Season:
  🌦️ Best Time to Visit [Place]
  ✅ Best Season
  🌤️ Other Options
  ⚠️ Avoid
- Season suggestions:
  🌍 Best Places for [Season]
  - Place - why it is good
- Plan:
  📅 3-Day Plan for [Place]
  Day 1:
  - Places
  - Food spot
  Day 2:
  - Places
  - Food spot
  Day 3:
  - Places
  - Food spot

Reply in the same language as the user unless an explicit language preference is provided.`;

  if (liveData) {
    system += `\n\nLive data available:`;
    if (liveData.weather) system += `\nWeather: ${liveData.weather.temp}C, ${liveData.weather.condition}, humidity ${liveData.weather.humidity}%`;
    if (liveData.exchangeRates) system += `\nExchange rates: ${JSON.stringify(liveData.exchangeRates.display)}`;
    if (liveData.travelInfo) system += `\nTravel info: crowd ${liveData.travelInfo.crowd}, alerts ${liveData.travelInfo.alerts}`;
  }

  if (preferences?.budget) system += `\nUser budget: ${preferences.budget}.`;
  if (preferences?.type) system += `\nTravel group: ${preferences.type}.`;
  if (preferences?.season) system += `\nPreferred season: ${preferences.season}.`;
  if (preferences?.activities) system += `\nInterests: ${preferences.activities}.`;
  if (mood) system += `\nCurrent mood: ${mood}.`;

  const langNote = { hi:' Always reply in Hindi.', ta:' Always reply in Tamil.', ml:' Always reply in Malayalam.', te:' Always reply in Telugu.', bn:' Always reply in Bengali.' }[lang] || '';
  return system + langNote;
}

function fallbackChatReply(prompt = '') {
  const q = String(prompt).toLowerCase().trim();
  const daysMatch = q.match(/(\d+)\s*[- ]?\s*day/);
  const budgetMatch = q.match(/(?:rs\.?|inr|budget)?\s*(\d{4,6})/i);
  const days = daysMatch ? parseInt(daysMatch[1], 10) : null;
  const budget = budgetMatch ? parseInt(budgetMatch[1], 10) : null;
  const intent = detectQueryIntent(q);

  if (intent === 'greeting') {
    return 'Hey! How can I help with your trip today? I can plan Goa, Manali, Mumbai, Delhi, Andaman, Munnar, Mysore, Ooty, Kodaikanal, Coorg, Jodhpur, and Varkala.';
  }

  if (intent === 'weather') {
    return 'Based on latest available data, I can answer current weather best when you mention the destination directly, like "Goa weather today" or "current weather in Munnar".';
  }

  if (intent === 'compare') {
    return 'Tell me the two destinations you want to compare, like "Goa vs Andaman" or "Ooty vs Kodaikanal for family trip", and I will compare them clearly.';
  }

  if (intent === 'image') {
    return 'Tell me the place name and I will share 2 to 3 image links with a quick note on what each image shows.';
  }

  const destinationKey = Object.keys(SUPPORTED_DESTINATIONS).find(key => q.includes(key));
  if (destinationKey) {
    const guide = SUPPORTED_DESTINATIONS[destinationKey];
    if (intent === 'season') return renderSeasonReply(guide);
    if (intent === 'food') return renderFoodReply(guide);
    if (intent === 'hotels') return renderHotelReply(guide);
    if (intent === 'cost') return renderCostReply(guide, days || 3, budget);
    if (intent === 'routes') return renderRoutesReply(guide);
    if (intent === 'nearby') return renderNearbyReply(guide);
    if (intent === 'hidden_gems') return renderHiddenGemsReply(guide);
    if (intent === 'plan') return renderPlanReply(guide);
    if (intent === 'full_trip') return renderFullTripReply(guide, days || 3, budget);

    return `📍 ${guide.title}\n\n- Best time: ${guide.bestTime}\n- Known for: ${guide.highlights}\n- Hidden gems: ${guide.hiddenGems}\n- Best for food: ${guide.food}`;
  }

  if (intent === 'season') {
    const season = detectSeasonType(q);
    const seasonalReply = renderSeasonSuggestionsReply(season);
    if (seasonalReply) return seasonalReply;
    return renderAllSeasonSuggestionsReply();
  }

  if (intent === 'cost') {
    return 'A simple rule of thumb is: budget trip Rs. 1,800 to Rs. 3,500/day, mid-range Rs. 3,500 to Rs. 7,000/day, luxury Rs. 8,000+/day. Tell me the destination and number of days and I will break it down properly.';
  }

  if (intent === 'plan') {
    return 'Tell me the destination, number of days, and travel style, for example: "Plan a 4-day Coorg family trip under 18000".';
  }

  if (intent === 'food') {
    return 'Tell me the destination name, like "food in Goa" or "best food in Delhi", and I will show only food details.';
  }

  if (intent === 'hotels') {
    return 'Tell me the destination name, like "hotels in Ooty" or "best stays in Coorg", and I will show only hotel options.';
  }

  if (intent === 'routes') {
    return 'I can show routes for Goa, Manali, Mumbai, Delhi, Andaman, Munnar, Mysore, Ooty, Kodaikanal, Coorg, Jodhpur, and Varkala.';
  }

  if (intent === 'nearby') {
    return 'I can show nearby places for Goa, Manali, Mumbai, Delhi, Andaman, Munnar, Mysore, Ooty, Kodaikanal, Coorg, Jodhpur, and Varkala.';
  }

  if (intent === 'hidden_gems') {
    return 'I can show hidden gems for Goa, Manali, Mumbai, Delhi, Andaman, Munnar, Mysore, Ooty, Kodaikanal, Coorg, Jodhpur, and Varkala.';
  }

  if (intent === 'season') {
    return renderAllSeasonSuggestionsReply();
  }

  if (intent === 'full_trip') {
    return 'I can give a full trip plan for Goa, Manali, Mumbai, Delhi, Andaman, Munnar, Mysore, Ooty, Kodaikanal, Coorg, Jodhpur, and Varkala.';
  }

  return 'I can help with Goa, Manali, Mumbai, Delhi, Andaman, Munnar, Mysore, Ooty, Kodaikanal, Coorg, Jodhpur, and Varkala. Try "food in Goa", "hotels in Ooty", "cost for Munnar", or "plan Manali trip".';
}

function detectCity(prompt) {
  const q = String(prompt || '').toLowerCase();
  const aliases = {
    goa: ['goa'],
    manali: ['manali'],
    mumbai: ['mumbai', 'bombay'],
    delhi: ['delhi', 'new delhi'],
    andaman: ['andaman', 'port blair', 'havelock', 'swaraj dweep', 'neil island', 'shaheed dweep'],
    munnar: ['munnar'],
    mysore: ['mysore', 'mysuru'],
    ooty: ['ooty', 'udhagamandalam'],
    kodaikanal: ['kodaikanal', 'kodai'],
    coorg: ['coorg', 'kodagu', 'madikeri'],
    jodhpur: ['jodhpur'],
    varkala: ['varkala']
  };

  for (const [city, names] of Object.entries(aliases)) {
    if (names.some(name => q.includes(name))) return city;
  }
  return null;
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'trip-for-heaven-ai',
    model: MODEL,
    apiConfigured: Boolean(apiKey),
    telegramConfigured: Boolean(TELEGRAM_BOT_TOKEN),
    telegramWebhookUrlConfigured: Boolean(TELEGRAM_WEBHOOK_URL),
    features: ['weather', 'exchange-rates', 'travel-info', 'ai-chat', 'telegram-webhook'],
  });
});

app.get('/api/about-features', (_req, res) => {
  const destinationCount = Object.keys(SUPPORTED_DESTINATIONS).length;
  const hotelCount = Object.values(SUPPORTED_DESTINATIONS).reduce((total, guide) => {
    return total + (guide.budgetHotels?.length || 0) + (guide.premiumHotels?.length || 0);
  }, 0);

  res.json({
    status: 'ok',
    generatedAt: new Date().toISOString(),
    features: {
      flights: {
        title: 'Live Flight Paths',
        status: WEATHER_KEY ? 'Live backend ready' : 'Backend ready',
        description: `${destinationCount} destinations with airport, train, and route guidance served by the backend.`,
        meta: WEATHER_KEY ? 'Weather-enabled travel data is active.' : 'Travel data works even if live weather falls back.'
      },
      hotels: {
        title: 'Hotel Database',
        status: 'Connected',
        description: `${hotelCount}+ curated budget and premium stay suggestions across ${destinationCount} destinations.`,
        meta: 'Served from the same destination data used by the AI assistant.'
      },
      ai: {
        title: 'AI Travel Guide',
        status: apiKey ? 'AI live' : 'Fallback mode',
        description: apiKey
          ? `Website chat is connected to the backend using ${MODEL}.`
          : 'Backend chat is online and will answer in fallback mode until the API key is configured.',
        meta: 'Powered by the Trip for Heaven server.'
      },
      planner: {
        title: 'Trip Planner',
        status: apiKey ? 'Planner ready' : 'Planner fallback ready',
        description: `Day-wise itineraries are available through the backend planner endpoint for ${destinationCount} supported destinations.`,
        meta: 'Uses the same AI planning flow as the chat assistant.'
      },
      calculator: {
        title: 'Cost Calculator',
        status: 'Connected',
        description: `Trip estimates are available for ${destinationCount} supported destinations with transport, stay, and food planning.`,
        meta: 'Frontend calculator now matches backend destination coverage.'
      }
    }
  });
});

app.get('/api/telegram/status', async (_req, res) => {
  try {
    if (!TELEGRAM_BOT_TOKEN) {
      return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN is missing' });
    }

    const webhookInfo = await getTelegramWebhookInfo();
    return res.json({
      configured: true,
      envWebhookUrl: TELEGRAM_WEBHOOK_URL || null,
      secretEnabled: Boolean(TELEGRAM_WEBHOOK_SECRET),
      webhookInfo,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to fetch Telegram webhook info' });
  }
});

app.post('/api/telegram/register-webhook', async (_req, res) => {
  try {
    if (!TELEGRAM_BOT_TOKEN) {
      return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN is missing' });
    }
    if (!TELEGRAM_WEBHOOK_URL) {
      return res.status(400).json({ error: 'TELEGRAM_WEBHOOK_URL is missing in .env' });
    }

    const result = await registerTelegramWebhook();
    return res.json({
      success: true,
      webhookUrl: TELEGRAM_WEBHOOK_URL,
      secretEnabled: Boolean(TELEGRAM_WEBHOOK_SECRET),
      telegramResult: result,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to register Telegram webhook' });
  }
});

app.post('/api/ai-chat', async (req, res) => {
  const { prompt, lang, preferences, mood, history } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  try {
    const { reply, liveData } = await generateChatReply({ prompt, lang, preferences, mood, history });
    return res.json({ reply: reply || "I couldn't generate a response right now. Please try again.", model: MODEL, liveData });
  } catch (err) {
    console.error('AI chat error:', err?.message || err);
    const details = classifyAIError(err);
    return res.status(details.missingKey ? 503 : 200).json({
      reply: fallbackChatReply(prompt), fallback: true, model: MODEL,
      error: details.publicMessage,
      errorType: details.missingKey ? 'missing_api_key' : details.quotaExceeded ? 'quota_exceeded' : 'request_failed',
      quotaExceeded: details.quotaExceeded,
    });
  }
});

app.post('/api/telegram/webhook', async (req, res) => {
  if (!isValidTelegramWebhook(req)) {
    return res.status(401).json({ error: 'Invalid Telegram webhook secret' });
  }

  const message = req.body?.message || req.body?.edited_message;
  const chatId = message?.chat?.id;
  const text = String(message?.text || '').trim();

  res.sendStatus(200);

  if (!chatId) return;

  try {
    if (!TELEGRAM_BOT_TOKEN) {
      console.warn('Telegram webhook received a message, but TELEGRAM_BOT_TOKEN is missing.');
      return;
    }

    if (!text) {
      await sendTelegramMessage(chatId, 'Send me a text message like "Plan a 4-day Goa trip" and I will help from the same Trip for Heaven AI.');
      return;
    }

    if (text === '/start') {
      await sendTelegramMessage(chatId, 'Welcome to Trip for Heaven. Ask me about Indian destinations, trip budgets, itineraries, weather, or hotel ideas, and I will reply using the same AI as the website chat.');
      return;
    }

    if (text === '/help') {
      await sendTelegramMessage(chatId, 'Try messages like: "Best time to visit Goa", "Plan a 5-day Manali trip", or "Budget hotels in Ooty".');
      return;
    }

    appendTelegramHistory(chatId, 'user', text);
    const history = getTelegramHistory(chatId);
    const { reply } = await generateChatReply({ prompt: text, lang: 'en', history });
    appendTelegramHistory(chatId, 'assistant', reply);
    await sendTelegramMessage(chatId, reply);
  } catch (err) {
    console.error('Telegram webhook error:', err?.message || err);
    try {
      await sendTelegramMessage(chatId, fallbackChatReply(text));
    } catch (sendErr) {
      console.error('Telegram fallback send error:', sendErr?.message || sendErr);
    }
  }
});

app.post('/api/ai-plan', async (req, res) => {
  const { destinationName, destinationState, attractionNames = [], days = 5, style = 'relaxed', preferences, mood } = req.body || {};
  try {
    const system = buildSystemPrompt(preferences, mood, 'en', null) + ' Create a practical day-by-day India travel itinerary using markdown.';
    const prompt = `Create a ${days}-day ${style} itinerary for ${destinationName}, ${destinationState}, India.\nInclude morning, afternoon, and evening suggestions, must-see attractions, local food ideas, and rough INR costs.\nKey attractions: ${attractionNames.slice(0, 6).join(', ')}.\nKeep it useful and under 450 words. End with one money-saving tip.`;
    const plan = await createAITextResponse([{ role: 'system', content: system }, { role: 'user', content: prompt }]);
    return res.json({ plan: plan || `**${days}-Day Itinerary for ${destinationName}**\n\nDay 1: Arrive & explore\nDay 2: Top attractions\nDay 3: Cultural immersion\n\nTip: Book transport early!`, model: MODEL });
  } catch (err) {
    console.error('AI plan error:', err?.message || err);
    return res.json({ plan: `**${days}-Day Itinerary for ${destinationName}**\n\nDay 1: Arrive & explore\nDay 2: Top attractions\nDay 3: Cultural immersion\n\nTip: Book transport early!`, fallback: true, model: MODEL });
  }
});

app.get('*', (req, res, next) => { if (req.path.startsWith('/api/')) return next(); return res.sendFile(siteFile); });

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n✦ Trip for Heaven server running at http://localhost:${port}`);
    console.log(`  AI model: ${MODEL}`);
    console.log(`  Telegram bot: ${TELEGRAM_BOT_TOKEN ? 'configured' : 'disabled (set TELEGRAM_BOT_TOKEN in .env)'}`);
    console.log(`  Telegram webhook URL: ${TELEGRAM_WEBHOOK_URL || 'not set'}`);
    console.log(`  Telegram webhook secret: ${TELEGRAM_WEBHOOK_SECRET ? 'enabled' : 'not set'}`);
    console.log(`  OpenAI key: ${apiKey ? '✅ loaded' : '❌ missing (set OPENAI_API_KEY in .env)'}`);
    console.log(`  Weather API: ${WEATHER_KEY ? '✅ loaded' : '⚠️ using demo key'}`);
    console.log(`  Features: Weather, Exchange Rates, Travel Info, AI Chat\n`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') { console.warn(`Port ${port} in use, trying ${port+1}...`); startServer(port + 1); return; }
    throw err;
  });

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_WEBHOOK_URL) {
    registerTelegramWebhook()
      .then(() => console.log(`  Telegram webhook registered for ${TELEGRAM_WEBHOOK_URL}`))
      .catch(err => console.warn(`  Telegram webhook registration failed: ${err?.message || err}`));
  }
}

startServer(defaultPort);
