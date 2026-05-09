import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generatePatternTags,
  mergeTags,
  normalizeTagUrls,
  parseImportedTags,
  validateTagUrls,
} from "./tag-utils";

describe("normalizeTagUrls", () => {
  it("trims values and removes blanks", () => {
    assert.deepEqual(normalizeTagUrls([" https://example.com/1 ", "", "   ", "https://example.com/2"]), [
      "https://example.com/1",
      "https://example.com/2",
    ]);
  });
});

describe("validateTagUrls", () => {
  it("separates valid and invalid URLs", () => {
    assert.deepEqual(validateTagUrls(["https://valid.example", "notaurl", "https://also-valid.example"]).validUrls, [
      "https://valid.example",
      "https://also-valid.example",
    ]);
    assert.deepEqual(validateTagUrls(["https://valid.example", "notaurl", "https://also-valid.example"]).invalidUrls, [
      "notaurl",
    ]);
  });
});

describe("parseImportedTags", () => {
  it("parses JSON arrays of strings", () => {
    const result = parseImportedTags(JSON.stringify(["https://example.com/1", "https://example.com/2"]), "tags.json");
    assert.deepEqual(result.urls, ["https://example.com/1", "https://example.com/2"]);
    assert.deepEqual(result.invalidEntries, []);
    assert.equal(result.format, "json");
  });

  it("parses JSON objects with tags arrays", () => {
    const result = parseImportedTags(
      JSON.stringify({ tags: [{ url: "https://example.com/1" }, { url: "https://example.com/2" }] }),
      "tags.json",
    );
    assert.deepEqual(result.urls, ["https://example.com/1", "https://example.com/2"]);
  });

  it("parses CSV with a header row", () => {
    const result = parseImportedTags("url\nhttps://example.com/1\nhttps://example.com/2\n", "tags.csv");
    assert.deepEqual(result.urls, ["https://example.com/1", "https://example.com/2"]);
    assert.deepEqual(result.invalidEntries, []);
    assert.equal(result.format, "csv");
  });

  it("retains invalid imported entries for reporting", () => {
    const result = parseImportedTags("url\nhttps://example.com/1\nnot-a-url\n", "tags.csv");
    assert.deepEqual(result.urls, ["https://example.com/1"]);
    assert.deepEqual(result.invalidEntries, ["not-a-url"]);
  });
});

describe("generatePatternTags", () => {
  it("generates incrementing URLs from a pattern", () => {
    assert.deepEqual(
      generatePatternTags({
        pattern: "https://example.com/tag-{n}",
        start: 1,
        count: 3,
      }),
      [
      "https://example.com/tag-1",
      "https://example.com/tag-2",
      "https://example.com/tag-3",
      ],
    );
  });

  it("supports custom increments and zero padding", () => {
    assert.deepEqual(
      generatePatternTags({
        pattern: "https://example.com/tag-{n}",
        start: 10,
        count: 3,
        step: 5,
        padWidth: 4,
      }),
      [
      "https://example.com/tag-0010",
      "https://example.com/tag-0015",
      "https://example.com/tag-0020",
      ],
    );
  });

  it("throws when the pattern placeholder is missing", () => {
    assert.throws(
      () =>
      generatePatternTags({
        pattern: "https://example.com/tag",
        start: 1,
        count: 2,
      }),
      /Pattern must include a \{n\} placeholder\./,
    );
  });
});

describe("mergeTags", () => {
  it("replaces tags in replace mode", () => {
    assert.deepEqual(mergeTags(["https://old.example"], ["https://new.example"], "replace"), [
      "https://new.example",
    ]);
  });

  it("appends tags in append mode", () => {
    assert.deepEqual(mergeTags(["https://old.example"], ["https://new.example"], "append"), [
      "https://old.example",
      "https://new.example",
    ]);
  });
});