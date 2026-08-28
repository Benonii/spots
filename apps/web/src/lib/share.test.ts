import { describe, expect, mock, test } from "bun:test";
import { shareLink, spotShareText, spotShareUrl } from "./share";

const payload = { title: "Kaldi's", text: "Kaldi's — Bole", url: "https://x.test/?spot=abc" };

describe("spotShareUrl", () => {
  test("builds the deep link the carousel already honours", () => {
    expect(spotShareUrl("ChIJabc", "https://spots.test")).toBe(
      "https://spots.test/?spot=ChIJabc",
    );
  });

  test("escapes an id that would otherwise break the query string", () => {
    expect(spotShareUrl("a b&c=d", "https://x.test")).toBe("https://x.test/?spot=a%20b%26c%3Dd");
  });
});

describe("spotShareText", () => {
  test("names the area when there is one", () => {
    expect(spotShareText("Kaldi's", "Bole")).toBe("Kaldi's — Bole, Addis Ababa");
    expect(spotShareText("Kaldi's", null)).toBe("Kaldi's — Addis Ababa");
  });
});

describe("shareLink", () => {
  test("prefers the share sheet", async () => {
    const share = mock(() => Promise.resolve());
    expect(await shareLink(payload, { share })).toBe("shared");
    expect(share).toHaveBeenCalledWith(payload);
  });

  test("a cancelled sheet is not a failure, and does not fall back to copying", async () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const copy = mock(() => Promise.resolve());
    expect(await shareLink(payload, { share: () => Promise.reject(abort), copy })).toBe(
      "dismissed",
    );
    expect(copy).not.toHaveBeenCalled();
  });

  test("any other share error falls back to the clipboard", async () => {
    const copy = mock(() => Promise.resolve());
    const outcome = await shareLink(payload, {
      share: () => Promise.reject(new Error("not allowed")),
      copy,
    });
    expect(outcome).toBe("copied");
    expect(copy).toHaveBeenCalledWith(payload.url);
  });

  test("copies when there is no share sheet", async () => {
    const copy = mock(() => Promise.resolve());
    expect(await shareLink(payload, { copy })).toBe("copied");
  });

  test("reports failure when neither route works", async () => {
    expect(await shareLink(payload, { copy: () => Promise.reject(new Error("denied")) })).toBe(
      "failed",
    );
  });
});
