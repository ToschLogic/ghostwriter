"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const tag_utils_1 = require("./tag-utils");
(0, node_test_1.describe)("normalizeTagUrls", () => {
    (0, node_test_1.it)("trims values and removes blanks", () => {
        strict_1.default.deepEqual((0, tag_utils_1.normalizeTagUrls)([" https://example.com/1 ", "", "   ", "https://example.com/2"]), [
            "https://example.com/1",
            "https://example.com/2",
        ]);
    });
});
(0, node_test_1.describe)("validateTagUrls", () => {
    (0, node_test_1.it)("separates valid and invalid URLs", () => {
        strict_1.default.deepEqual((0, tag_utils_1.validateTagUrls)(["https://valid.example", "notaurl", "https://also-valid.example"]).validUrls, [
            "https://valid.example",
            "https://also-valid.example",
        ]);
        strict_1.default.deepEqual((0, tag_utils_1.validateTagUrls)(["https://valid.example", "notaurl", "https://also-valid.example"]).invalidUrls, [
            "notaurl",
        ]);
    });
});
(0, node_test_1.describe)("parseImportedTags", () => {
    (0, node_test_1.it)("parses JSON arrays of strings", () => {
        const result = (0, tag_utils_1.parseImportedTags)(JSON.stringify(["https://example.com/1", "https://example.com/2"]), "tags.json");
        strict_1.default.deepEqual(result.urls, ["https://example.com/1", "https://example.com/2"]);
        strict_1.default.deepEqual(result.invalidEntries, []);
        strict_1.default.equal(result.format, "json");
    });
    (0, node_test_1.it)("parses JSON objects with tags arrays", () => {
        const result = (0, tag_utils_1.parseImportedTags)(JSON.stringify({ tags: [{ url: "https://example.com/1" }, { url: "https://example.com/2" }] }), "tags.json");
        strict_1.default.deepEqual(result.urls, ["https://example.com/1", "https://example.com/2"]);
    });
    (0, node_test_1.it)("parses CSV with a header row", () => {
        const result = (0, tag_utils_1.parseImportedTags)("url\nhttps://example.com/1\nhttps://example.com/2\n", "tags.csv");
        strict_1.default.deepEqual(result.urls, ["https://example.com/1", "https://example.com/2"]);
        strict_1.default.deepEqual(result.invalidEntries, []);
        strict_1.default.equal(result.format, "csv");
    });
    (0, node_test_1.it)("retains invalid imported entries for reporting", () => {
        const result = (0, tag_utils_1.parseImportedTags)("url\nhttps://example.com/1\nnot-a-url\n", "tags.csv");
        strict_1.default.deepEqual(result.urls, ["https://example.com/1"]);
        strict_1.default.deepEqual(result.invalidEntries, ["not-a-url"]);
    });
});
(0, node_test_1.describe)("generatePatternTags", () => {
    (0, node_test_1.it)("generates incrementing URLs from a pattern", () => {
        strict_1.default.deepEqual((0, tag_utils_1.generatePatternTags)({
            pattern: "https://example.com/tag-{n}",
            start: 1,
            count: 3,
        }), [
            "https://example.com/tag-1",
            "https://example.com/tag-2",
            "https://example.com/tag-3",
        ]);
    });
    (0, node_test_1.it)("supports custom increments and zero padding", () => {
        strict_1.default.deepEqual((0, tag_utils_1.generatePatternTags)({
            pattern: "https://example.com/tag-{n}",
            start: 10,
            count: 3,
            step: 5,
            padWidth: 4,
        }), [
            "https://example.com/tag-0010",
            "https://example.com/tag-0015",
            "https://example.com/tag-0020",
        ]);
    });
    (0, node_test_1.it)("throws when the pattern placeholder is missing", () => {
        strict_1.default.throws(() => (0, tag_utils_1.generatePatternTags)({
            pattern: "https://example.com/tag",
            start: 1,
            count: 2,
        }), /Pattern must include a \{n\} placeholder\./);
    });
});
(0, node_test_1.describe)("mergeTags", () => {
    (0, node_test_1.it)("replaces tags in replace mode", () => {
        strict_1.default.deepEqual((0, tag_utils_1.mergeTags)(["https://old.example"], ["https://new.example"], "replace"), [
            "https://new.example",
        ]);
    });
    (0, node_test_1.it)("appends tags in append mode", () => {
        strict_1.default.deepEqual((0, tag_utils_1.mergeTags)(["https://old.example"], ["https://new.example"], "append"), [
            "https://old.example",
            "https://new.example",
        ]);
    });
});
