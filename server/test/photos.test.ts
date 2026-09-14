import { describe, expect, it } from "vitest";
import { ftypBrand, isHeic, pickPhotoFile } from "../src/services/photos.ts";

function ftypFile(brand: string): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.write("ftyp", 4, "ascii");
  buffer.write(brand, 8, "ascii");
  return buffer;
}

describe("isHeic", () => {
  it("accepts the HEVC-coded HEIF brands sharp cannot decode", () => {
    for (const brand of ["heic", "heix", "hevc", "hevx", "mif1", "msf1"]) {
      expect(isHeic(ftypFile(brand))).toBe(true);
    }
  });

  it("leaves AVIF and non-ISO-BMFF files to sharp", () => {
    expect(isHeic(ftypFile("avif"))).toBe(false);
    expect(isHeic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]))).toBe(false);
    expect(isHeic(Buffer.alloc(4))).toBe(false);
    expect(isHeic(Buffer.alloc(0))).toBe(false);
  });

  it("reads the major brand case-insensitively", () => {
    expect(ftypBrand(ftypFile("HEIC"))).toBe("heic");
  });
});

describe("pickPhotoFile", () => {
  it("serves the normalized photo for every size on new logs", () => {
    const entries = ["full.jpg", "thumb.jpg"];
    expect(pickPhotoFile(entries, "thumb")).toBe("thumb.jpg");
    expect(pickPhotoFile(entries, "full")).toBe("full.jpg");
    expect(pickPhotoFile(entries, "orig")).toBe("full.jpg");
  });

  it("keeps legacy originals reachable", () => {
    const entries = ["orig.heic", "full.jpg", "thumb.jpg"];
    expect(pickPhotoFile(entries, "thumb")).toBe("thumb.jpg");
    expect(pickPhotoFile(entries, "full")).toBe("full.jpg");
    expect(pickPhotoFile(entries, "orig")).toBe("orig.heic");
  });

  it("falls back to the original when a legacy set is incomplete", () => {
    expect(pickPhotoFile(["orig.png"], "full")).toBe("orig.png");
    expect(pickPhotoFile(["orig.png"], "orig")).toBe("orig.png");
    expect(pickPhotoFile([], "thumb")).toBeNull();
  });
});
