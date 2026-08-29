import assert from "node:assert/strict";
import { NuvemshopClient, NuvemshopPaginationError } from "../lib/nuvemshop/client";

type Page = { body: unknown; status?: number; total?: string; link?: string };

const originalFetch = globalThis.fetch;
const checkout = (id: number) => ({ id, completed_at: null });

function mockPages(pages: Record<number, Page>, seen: URL[]) {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    seen.push(url);
    const page = Number(url.searchParams.get("page"));
    const fixture = pages[page];
    if (!fixture) return new Response("pagina inesperada", { status: 500 });
    const headers = new Headers();
    if (fixture.total !== undefined) headers.set("x-total-count", fixture.total);
    if (fixture.link !== undefined) headers.set("link", fixture.link);
    return new Response(JSON.stringify(fixture.body), {
      status: fixture.status ?? 200,
      headers,
    });
  };
}

async function rejectsPagination(run: () => Promise<unknown>, label: string) {
  await assert.rejects(run, NuvemshopPaginationError, label);
  console.log(`PASS  ${label}`);
}

async function main() {
try {
  const seen: URL[] = [];
  mockPages({
    1: {
      body: [checkout(1), checkout(2)],
      total: "3",
      link: '<https://api.tiendanube.com/v1/store-1/checkouts?page=2&per_page=2>; rel="next"',
    },
    2: { body: [checkout(3)], total: "3" },
  }, seen);
  const complete = await new NuvemshopClient("store-1", "token").listCheckouts(
    "2026-01-01T00:00:00.000Z",
    2,
  );
  assert.deepEqual(complete.map((item) => item.id), [1, 2, 3]);
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.searchParams.get("page"), "1");
  assert.equal(seen[1]!.searchParams.get("page"), "2");
  assert.equal(seen[1]!.searchParams.get("created_at_min"), "2026-01-01T00:00:00.000Z");
  console.log("PASS  pagina todas as paginas e preserva filtros");

  mockPages({ 1: { body: [checkout(1)], total: "2" } }, []);
  await rejectsPagination(
    () => new NuvemshopClient("store-1", "token").listCheckouts(undefined, 1),
    "rejeita snapshot parcial sem Link next",
  );

  mockPages({ 1: { body: [checkout(1)] } }, []);
  await rejectsPagination(
    () => new NuvemshopClient("store-1", "token").listCheckouts(),
    "rejeita x-total-count ausente",
  );

  mockPages({
    1: {
      body: [checkout(1)], total: "2",
      link: '<https://api.tiendanube.com/v1/store-1/checkouts?page=2>; rel="next"',
    },
    2: { body: [checkout(2)], total: "3" },
  }, []);
  await rejectsPagination(
    () => new NuvemshopClient("store-1", "token").listCheckouts(undefined, 1),
    "rejeita mudanca de x-total-count",
  );

  mockPages({
    1: {
      body: [checkout(1)], total: "2",
      link: '<https://api.tiendanube.com/v1/store-1/checkouts?page=2>; rel="next"',
    },
    2: { body: [checkout(1)], total: "2" },
  }, []);
  await rejectsPagination(
    () => new NuvemshopClient("store-1", "token").listCheckouts(undefined, 1),
    "rejeita checkout duplicado entre paginas",
  );

  mockPages({
    1: {
      body: [checkout(1)], total: "2",
      link: '<https://malicioso.example/v1/store-1/checkouts?page=2>; rel="next"',
    },
  }, []);
  await rejectsPagination(
    () => new NuvemshopClient("store-1", "token").listCheckouts(undefined, 1),
    "rejeita Link next fora da API oficial",
  );

  mockPages({ 1: { body: { error: "rate limit" }, status: 429, total: "0" } }, []);
  await assert.rejects(
    () => new NuvemshopClient("store-1", "token").listCheckouts(),
    /Nuvemshop API 429/,
  );
  console.log("PASS  falha HTTP nao devolve snapshot parcial");

  await rejectsPagination(
    () => new NuvemshopClient("store-1", "token").listCheckouts(undefined, 201),
    "rejeita per_page acima do limite oficial",
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("\ncheckout pagination: OK");
}

void main();
