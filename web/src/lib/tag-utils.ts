export type TagMergeMode = "replace" | "append";

export type UrlValidationResult = {
  validUrls: string[];
  invalidUrls: string[];
};

export type ImportedTagParseResult = {
  urls: string[];
  invalidEntries: string[];
  format: "json" | "csv";
};

export type PatternGenerationInput = {
  pattern: string;
  start: number;
  count: number;
  step?: number;
  padWidth?: number;
};

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function normalizeTagUrls(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

export function validateTagUrls(values: string[]): UrlValidationResult {
  const normalized = normalizeTagUrls(values);
  const validUrls: string[] = [];
  const invalidUrls: string[] = [];

  for (const value of normalized) {
    if (isValidUrl(value)) {
      validUrls.push(value);
    } else {
      invalidUrls.push(value);
    }
  }

  return { validUrls, invalidUrls };
}

function extractJsonUrls(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    if (payload.every((item) => typeof item === "string")) {
      return payload;
    }

    if (
      payload.every(
        (item) => typeof item === "object" && item !== null && "url" in item && typeof item.url === "string",
      )
    ) {
      return payload.map((item) => item.url);
    }
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    "tags" in payload &&
    Array.isArray(payload.tags) &&
    payload.tags.every(
      (item) => typeof item === "object" && item !== null && "url" in item && typeof item.url === "string",
    )
  ) {
    return payload.tags.map((item) => item.url);
  }

  throw new Error(
    "Unsupported JSON format. Use an array of URLs, an array of { url } objects, or a { tags: [{ url }] } object.",
  );
}

function parseCsvUrls(content: string): string[] {
  const rows = content
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length === 0) {
    return [];
  }

  const firstRow = rows[0].replace(/^"|"$/g, "").trim().toLowerCase();
  const dataRows = firstRow === "url" ? rows.slice(1) : rows;

  return dataRows.map((row) => {
    const firstColumn = row.split(",")[0] ?? "";
    return firstColumn.replace(/^"|"$/g, "").trim();
  });
}

export function parseImportedTags(content: string, fileName: string): ImportedTagParseResult {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".json")) {
    const parsed = JSON.parse(content) as unknown;
    const { validUrls, invalidUrls } = validateTagUrls(extractJsonUrls(parsed));
    return { urls: validUrls, invalidEntries: invalidUrls, format: "json" };
  }

  if (lowerName.endsWith(".csv")) {
    const { validUrls, invalidUrls } = validateTagUrls(parseCsvUrls(content));
    return { urls: validUrls, invalidEntries: invalidUrls, format: "csv" };
  }

  throw new Error("Unsupported file type. Please import a .json or .csv file.");
}

export function generatePatternTags({
  pattern,
  start,
  count,
  step = 1,
  padWidth = 0,
}: PatternGenerationInput): string[] {
  if (!pattern.includes("{n}")) {
    throw new Error("Pattern must include a {n} placeholder.");
  }
  if (!Number.isInteger(start)) {
    throw new Error("Start number must be a whole number.");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Tag count must be a whole number greater than 0.");
  }
  if (!Number.isInteger(step) || step < 1) {
    throw new Error("Increment must be a whole number greater than 0.");
  }
  if (!Number.isInteger(padWidth) || padWidth < 0) {
    throw new Error("Pad width must be a whole number 0 or greater.");
  }

  const urls = Array.from({ length: count }, (_, index) => {
    const nextNumber = String(start + index * step).padStart(padWidth, "0");
    return pattern.split("{n}").join(nextNumber);
  });

  const { validUrls, invalidUrls } = validateTagUrls(urls);
  if (invalidUrls.length > 0) {
    throw new Error(`Generated URLs contained invalid values: ${invalidUrls.slice(0, 3).join(", ")}`);
  }

  return validUrls;
}

export function mergeTags(existing: string[], incoming: string[], mode: TagMergeMode): string[] {
  return mode === "append" ? [...existing, ...incoming] : incoming;
}