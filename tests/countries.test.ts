import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COUNTRY_OPTIONS,
  countryName,
  locationCountryCode,
} from "../src/lib/recruitment/countries.ts";

test("recruitment country list loads and resolves application locations", () => {
  assert.ok(COUNTRY_OPTIONS.length >= 240);
  assert.equal(countryName("OM"), "Oman");
  assert.equal(locationCountryCode("Salalah, Oman"), "OM");
  assert.equal(locationCountryCode("Rome, Italy"), "IT");
});
