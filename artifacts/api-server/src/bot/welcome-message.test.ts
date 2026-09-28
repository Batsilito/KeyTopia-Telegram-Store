import assert from "node:assert/strict";
import test from "node:test";
import { createWelcomeMessage } from "./welcome-message.ts";

test("welcome message includes the customer's name, shop guide, channel and support", () => {
  const message = createWelcomeMessage({
    language: "en",
    firstName: "Sam",
    storeName: "KeyTopia",
    channel: "@KeytopiaChannel",
  });

  assert.match(message, /Welcome to KeyTopia/);
  assert.match(message, /Hey <b>Sam<\/b>/);
  assert.match(message, /<blockquote>/);
  assert.match(message, /Shop<\/b> — Browse and buy digital products/);
  assert.match(message, /Deposit<\/b> — Add funds to your wallet/);
  assert.match(message, /https:\/\/t\.me\/KeytopiaChannel/);
  assert.match(message, /Tap <b>Support<\/b>/);
});

test("welcome message escapes user and store names before inserting them as HTML", () => {
  const message = createWelcomeMessage({
    language: "en",
    firstName: '<Admin & "Friend">',
    storeName: "Key & <Topia>",
  });

  assert.match(message, /Welcome to Key &amp; &lt;Topia&gt;/);
  assert.match(message, /Hey <b>&lt;Admin &amp; &quot;Friend&quot;&gt;<\/b>/);
  assert.doesNotMatch(message, /<Admin|<Topia>/);
});

test("legacy Arabic preference still receives English welcome copy", () => {
  const message = createWelcomeMessage({
    language: "ar",
    firstName: "Sara",
    storeName: "KeyTopia",
    supportAvailable: false,
  });

  assert.match(message, /Welcome to KeyTopia/);
  assert.match(message, /Hey <b>Sara<\/b>/);
  assert.match(message, /<b>Shop<\/b>/);
  assert.doesNotMatch(message, /https:\/\/t\.me/);
  assert.doesNotMatch(message, /Support/);
  assert.doesNotMatch(message, /[\u0600-\u06FF]/);
});