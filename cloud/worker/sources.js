// Data-source registry shared by the Worker (collectors) and documented in the UI.
// Everything here is public, free, and keyless. Collectors store compact results in D1.

export const FEEDS = [
  ["bbc-world", "BBC News", "https://feeds.bbci.co.uk/news/world/rss.xml", "geopolitics"],
  ["guardian-world", "The Guardian", "https://www.theguardian.com/world/rss", "geopolitics"],
  ["aljazeera", "Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "geopolitics"],
  ["bbc-business", "BBC News", "https://feeds.bbci.co.uk/news/business/rss.xml", "business"],
  ["nyt-business", "New York Times", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "business"],
  ["nyt-economy", "New York Times", "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml", "macro"],
  ["nyt-tech", "New York Times", "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", "technology"],
  ["cnbc-top", "CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "markets"],
  ["marketwatch", "MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories", "markets"],
  ["cbc-business", "CBC News", "https://www.cbc.ca/webfeed/rss/rss-business", "business"],
  ["fed", "Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml", "macro"],
  ["boc", "Bank of Canada", "https://www.bankofcanada.ca/content_type/press-releases/feed/", "macro"],
  ["ars", "Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "technology"],
  ["techcrunch", "TechCrunch", "https://techcrunch.com/feed/", "technology"],
  ["hn", "Hacker News", "https://hnrss.org/frontpage", "technology"],
];

// Market instruments always tracked (besides your holdings and watchlist).
export const MARKET = [
  "^GSPC", "^IXIC", "^GSPTSE", "^RUT", "^VIX", "^IRX", "^FVX", "^TNX", "^TYX", "2YY=F",
  "CL=F", "BZ=F", "NG=F", "RB=F", "HO=F", "GC=F", "HG=F", "DX-Y.NYB", "CADUSD=X", "BTC-USD", "XLE",
];
// Instruments that also get long weekly history (for "compared with years before").
export const LONG = ["CL=F", "BZ=F", "^TNX", "^IRX", "^TYX", "^GSPC", "^GSPTSE", "^IXIC", "GC=F", "HG=F", "^VIX", "DX-Y.NYB", "NG=F", "CADUSD=X"];

export const BOC_SERIES = [
  "FXUSDCAD", "FXEURCAD", "FXGBPCAD", "FXJPYCAD", "FXCHFCAD", "FXAUDCAD", "FXCNYCAD", "FXHKDCAD",
  "V39079", "V80691311", "V80691335", "BD.CDN.2YR.DQ.YLD", "BD.CDN.5YR.DQ.YLD", "BD.CDN.10YR.DQ.YLD", "BD.CDN.LONG.DQ.YLD",
];
export const BOC_MONTHLY = ["STATIC_TOTALCPICHANGE", "CPI_TRIM", "CPI_MEDIAN"];

// Geopolitical hotspots: news attention (GDELT), flights (ADS-B), shipping (IMF PortWatch).
export const HOTSPOTS = [
  { id: "hormuz", q: '"strait of hormuz" OR hormuz', port: ["Strait of Hormuz"], air: [26.4, 56.3, 120] },
  { id: "redsea", q: 'houthi OR "red sea" OR "bab el-mandeb"', port: ["Bab el-Mandeb Strait", "Cape of Good Hope"], air: [15.5, 41.8, 200] },
  { id: "suez", q: '"suez canal"', port: ["Suez Canal"] },
  { id: "taiwan", q: '"taiwan strait" OR "taiwan blockade"', port: ["Taiwan Strait"], air: [24.3, 119.8, 150] },
  { id: "ukraine", q: 'ukraine russia war', port: ["Bosporus Strait", "Kerch Strait"], air: [49.0, 31.5, 250] },
  { id: "levant", q: 'israel OR gaza OR lebanon OR hezbollah', air: [32.2, 35.2, 120] },
  { id: "scs", q: '"south china sea"', port: ["Luzon Strait"] },
  { id: "korea", q: '"north korea" OR pyongyang', port: ["Korea Strait"], air: [38.3, 127.2, 120] },
  { id: "panama", q: '"panama canal"', port: ["Panama Canal"] },
  { id: "malacca", q: '"strait of malacca" OR "malacca strait"', port: ["Malacca Strait"] },
];
export const PORTS = [...new Set(HOTSPOTS.flatMap((h) => h.port || []))];

export const PROXY_HOSTS = new Set([
  "query1.finance.yahoo.com", "query2.finance.yahoo.com", "www.bankofcanada.ca", "fred.stlouisfed.org", "api.bls.gov",
  "data.sec.gov", "www.sec.gov", "api.gdeltproject.org", "services9.arcgis.com", "api.adsb.lol", "earthquake.usgs.gov",
  "data.international.gc.ca", "home.treasury.gov", "www150.statcan.gc.ca",
  ...FEEDS.map((f) => new URL(f[2]).host),
]);
