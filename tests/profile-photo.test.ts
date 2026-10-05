import assert from "node:assert/strict";
import test from "node:test";
import {
  canChangeProfilePhoto,
  profilePhotoMime,
  MAX_PROFILE_PHOTO_BYTES,
} from "../src/lib/profile-photo.ts";
test("profile photos can be changed by their owner or HR, not colleagues or Finance", () => {
  assert.ok(canChangeProfilePhoto("one", "one", ["Accounts"]));
  assert.ok(canChangeProfilePhoto("hr", "one", ["HR"]));
  assert.ok(canChangeProfilePhoto("admin", "one", ["Super Admin"]));
  assert.equal(
    canChangeProfilePhoto("two", "one", ["Employee", "Line Manager", "Accounts"]),
    false,
  );
});
test("profile photo upload rejects scripts and oversized images", () => {
  assert.throws(() => profilePhotoMime(new TextEncoder().encode("<svg onload='alert(1)'></svg>")));
  assert.throws(() => profilePhotoMime(new Uint8Array(MAX_PROFILE_PHOTO_BYTES + 1)));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  assert.equal(profilePhotoMime(png), "image/png");
  assert.throws(() => profilePhotoMime(new Uint8Array([255, 216, 255, 1, 255, 217])));
});
