import { describe, it, expect } from "vitest";
import { zipLocalDate } from "../src/utils/zip.js";

describe("zipLocalDate", () => {
  // JSZip encodes entry timestamps with getUTCHours/getUTCFullYear, but the ZIP
  // format defines that field as local time, so extractors read it back as
  // local. Without the shift, files extracted west of UTC appear modified
  // hours in the future.
  it("shifts a date so its UTC fields read as the local wall clock", () => {
    const d = new Date();
    const shifted = zipLocalDate(d);
    expect(shifted.getUTCFullYear()).toBe(d.getFullYear());
    expect(shifted.getUTCMonth()).toBe(d.getMonth());
    expect(shifted.getUTCDate()).toBe(d.getDate());
    expect(shifted.getUTCHours()).toBe(d.getHours());
    expect(shifted.getUTCMinutes()).toBe(d.getMinutes());
  });

  it("is a no-op when the runtime is already at UTC", () => {
    const d = new Date();
    if (d.getTimezoneOffset() !== 0) return; // only meaningful under TZ=UTC
    expect(zipLocalDate(d).getTime()).toBe(d.getTime());
  });

  it("offsets by exactly the timezone offset", () => {
    const d = new Date();
    expect(d.getTime() - zipLocalDate(d).getTime()).toBe(d.getTimezoneOffset() * 60000);
  });
});
