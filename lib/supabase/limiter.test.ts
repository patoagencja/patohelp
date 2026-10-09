import assert from "node:assert/strict";
import { test } from "node:test";

import { createLimiter, type Release } from "./limiter.ts";

const tick = () => new Promise((r) => setImmediate(r));

test("foreground only: a FIFO semaphore of `max` slots", async () => {
  const limiter = createLimiter(2, 1);
  const order: number[] = [];
  const held: Release[] = [];
  for (let i = 0; i < 4; i++) {
    void limiter.acquire().then((release) => {
      order.push(i);
      held.push(release);
    });
  }
  await tick();
  assert.deepEqual(order, [0, 1]);
  held[0]();
  await tick();
  assert.deepEqual(order, [0, 1, 2]);
  held[1]();
  held[1](); // releasing twice frees one slot only
  await tick();
  assert.deepEqual(order, [0, 1, 2, 3]);
});

test("background reads never hold more than their share", async () => {
  const limiter = createLimiter(3, 2);
  let granted = 0;
  for (let i = 0; i < 5; i++) void limiter.acquire("background").then(() => granted++);
  await tick();
  assert.equal(granted, 2);
  // The slot background can't use is still there for the page.
  let page = false;
  void limiter.acquire().then(() => (page = true));
  await tick();
  assert.equal(page, true);
});

test("a freed slot goes to a waiting foreground read before background ones", async () => {
  const limiter = createLimiter(2, 2);
  const bg: Release[] = [];
  const got: string[] = [];
  for (let i = 0; i < 4; i++) {
    void limiter.acquire("background").then((r) => {
      got.push(`bg${i}`);
      bg.push(r);
    });
  }
  await tick();
  assert.deepEqual(got, ["bg0", "bg1"]);
  void limiter.acquire().then(() => got.push("fg"));
  await tick();
  assert.deepEqual(got, ["bg0", "bg1"]);
  bg[0]();
  await tick();
  assert.deepEqual(got, ["bg0", "bg1", "fg"]);
  bg[1]();
  await tick();
  assert.deepEqual(got, ["bg0", "bg1", "fg", "bg2"]);
});
