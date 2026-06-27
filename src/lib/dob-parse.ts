const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const DAY_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20, "twenty first": 21, "twenty second": 22,
  "twenty third": 23, "twenty fourth": 24, "twenty fifth": 25, "twenty sixth": 26,
  "twenty seventh": 27, "twenty eighth": 28, "twenty ninth": 29, thirtieth: 30,
  "thirty first": 31,
};

export function stripCapturedMarkers(text: string): string {
  return text.replace(/\bCaptured\s+[^:]+:\s*[^\n]*/gi, " ").replace(/\s+/g, " ").trim();
}

function normaliseTwoDigitYear(year: number): number {
  if (year >= 100) return year;
  const currentYear = new Date().getUTCFullYear();
  const candidate = 2000 + year;
  return candidate > currentYear ? candidate - 100 : candidate;
}

function isValidDob(day: number, month: number, year: number): boolean {
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return false;
  if (year < 1900 || year > currentYear || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function parseDayWords(phrase: string): number | null {
  const value = phrase.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
  return DAY_WORDS[value] ?? null;
}

function parseYearWords(phrase: string): number | null {
  const value = phrase.toLowerCase().replace(/-/g, " ").replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return null;
  if (/^\d{2,4}$/.test(value)) return normaliseTwoDigitYear(Number(value));
  if (/^nineteen\s+/.test(value)) {
    const tail = value.replace(/^nineteen\s+/, "");
    const n = parseSpokenNumber(tail);
    return n != null ? 1900 + n : null;
  }
  if (/^twenty\s+/.test(value) && !value.startsWith("twenty hundred")) {
    const tail = value.replace(/^twenty\s+/, "");
    const n = parseSpokenNumber(tail);
    return n != null ? 2000 + n : null;
  }
  return null;
}

function parseSpokenNumber(phrase: string): number | null {
  const words: Record<string, number> = {
    zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  };
  const tokens = phrase.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let total = 0;
  for (const token of tokens) {
    const n = words[token];
    if (n == null) return null;
    total += n;
  }
  return total;
}

/** Lenient UK date-of-birth detection for spoken / typed answers. */
export function hasCompleteDob(text: string): boolean {
  const normalised = stripCapturedMarkers(text)
    .toLowerCase()
    .replace(/\bthe\b/g, " ")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalised) return false;

  const numericPatterns = [
    /\b(\d{1,2})[\/\.\-\s](\d{1,2})[\/\.\-\s](\d{2,4})\b/,
    /\b(\d{1,2})\s+(\d{1,2})\s+(\d{2,4})\b/,
  ];
  for (const pattern of numericPatterns) {
    const m = normalised.match(pattern);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const year = normaliseTwoDigitYear(Number(m[3]));
      if (isValidDob(a, b, year) || isValidDob(b, a, year)) return true;
    }
  }

  const iso = normalised.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso && isValidDob(Number(iso[3]), Number(iso[2]), Number(iso[1]))) return true;

  const monthNames = Object.keys(MONTHS).join("|");
  const dayWordPattern = Object.keys(DAY_WORDS)
    .sort((a, b) => b.length - a.length)
    .map((d) => d.replace(/\s+/g, "\\s+"))
    .join("|");
  const yearPattern = "(?:\\d{2,4}|nineteen\\s+[\\w\\s]+|twenty\\s+[\\w\\s]+)";

  const tryMatch = (day: number | null, monthName: string, yearPhrase: string) => {
    const month = MONTHS[monthName.toLowerCase()];
    const year = /^\d/.test(yearPhrase) ? normaliseTwoDigitYear(Number(yearPhrase)) : parseYearWords(yearPhrase);
    return day != null && month != null && year != null && isValidDob(day, month, year);
  };

  const patterns = [
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\s+(${yearPattern})\\b`, "gi"),
    new RegExp(`\\b(${dayWordPattern})\\s+(?:of\\s+)?(${monthNames})\\s+(${yearPattern})\\b`, "gi"),
    new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*[,.]?\\s*(${yearPattern})\\b`, "gi"),
    new RegExp(`\\b(${monthNames})\\s+(${dayWordPattern})\\s+(${yearPattern})\\b`, "gi"),
    // Split across lines / pauses: "15 march" + "1980" in same blob
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\b[\\s\\S]{0,40}\\b(${yearPattern})\\b`, "gi"),
    new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b[\\s\\S]{0,40}\\b(${yearPattern})\\b`, "gi"),
  ];

  for (const pattern of patterns) {
    for (const match of normalised.matchAll(pattern)) {
      const day = /^\d/.test(match[1]) ? Number(match[1]) : parseDayWords(match[1]);
      if (tryMatch(day, match[2], match[3])) return true;
    }
  }

  return false;
}

export function hasPartialDob(text: string): boolean {
  const n = stripCapturedMarkers(text).toLowerCase();
  return (
    hasCompleteDob(text) ||
    /\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(n) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}/i.test(n) ||
    /\b(?:19|20)\d{2}\b/.test(n) ||
    /\bnineteen\s+(?:\w+\s+){0,2}\w+/i.test(n) ||
    /\btwenty\s+(?:\w+\s+){0,2}\w+/i.test(n)
  );
}
