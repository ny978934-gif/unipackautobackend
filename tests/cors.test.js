import assert from "node:assert/strict";
import test from "node:test";
import { createCorsOptions } from "../config/cors.js";

const isAllowedOrigin = (options, origin) =>
  new Promise((resolve, reject) => {
    options.origin(origin, (error, allowed) => {
      if (error) return reject(error);
      resolve(allowed);
    });
  });

test("allows both production website origins", async () => {
  const options = createCorsOptions("");

  assert.equal(await isAllowedOrigin(options, "https://www.unipackauto.com"), true);
  assert.equal(await isAllowedOrigin(options, "https://unipackauto.com"), true);
});

test("does not allow unrelated domains that contain the production hostname", async () => {
  const options = createCorsOptions("");

  assert.equal(await isAllowedOrigin(options, "https://unipackauto.com.attacker.example"), false);
  assert.equal(await isAllowedOrigin(options, "https://staging.unipackauto.com"), false);
});

test("continues to support configured extra origins", async () => {
  const options = createCorsOptions("https://staging.example.com/, https://preview.example.com");

  assert.equal(await isAllowedOrigin(options, "https://staging.example.com"), true);
  assert.equal(await isAllowedOrigin(options, "https://preview.example.com"), true);
  assert.equal(await isAllowedOrigin(options, "https://other.example.com"), false);
});
