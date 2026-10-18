import assert from "node:assert/strict";
import { test } from "node:test";
import type { B2BSocialData, ReachPost } from "./b2b-social.ts";
import { NO_PEOPLE_FILTERS, filterPeople, funnel, parsePeopleFilters, peopleCsv, peopleFiltersHref, personRows, watchedAccounts } from "./b2b-social-people.ts";

const post = (over: Partial<ReachPost>): ReachPost => ({
  platform: "x",
  id: "1",
  handle: "acme",
  url: "https://x.com/acme/status/1",
  text: "Introducing a new thing",
  postedAt: "2026-01-09T00:00:00.000Z",
  format: "text",
  views: null,
  likes: null,
  comments: null,
  reposts: null,
  quotes: null,
  bookmarks: null,
  ...over,
});

const data: B2BSocialData = {
  capturedAt: "2026-01-10",
  credits: 0,
  accounts: [
    { platform: "x", handle: "acme", name: "Acme", url: "https://x.com/acme", group: "company", followers: 1000, sample: "recent" },
    { platform: "x", handle: "rival", name: "Rival", url: "https://x.com/rival", group: "competitor", followers: 5000, sample: "recent" },
    { platform: "linkedin", handle: "acme-inc", name: "Acme", url: "https://www.linkedin.com/company/acme-inc", group: "company", followers: 9000, sample: "recent" },
  ],
  posts: [
    post({}),
    post({ id: "2", handle: "rival", url: "https://x.com/rival/status/2", text: "New pricing" }),
    post({ platform: "linkedin", id: "3", handle: "acme-inc", url: "https://www.linkedin.com/posts/acme-3", text: "A customer story", postedAt: "2025-12-01T00:00:00.000Z", likes: 10 }),
  ],
  comments: [
    { postId: "2", authorName: "Dana", authorUrl: "https://x.com/dana", text: "This is a brutal downgrade, cancelling", url: "https://x.com/dana/status/9", postedAt: "2026-01-09T12:00:00.000Z" },
    { postId: "1", authorName: "Uma", authorUrl: "https://x.com/uma", text: "We have been using it every day" },
    { postId: "1", authorName: "Cy", authorUrl: "https://x.com/cy", text: "Congrats!" },
    { postId: "3", authorName: "Lee", authorUrl: "https://www.linkedin.com/in/lee", text: "Does it work with our monorepo?" },
  ],
  people: [
    {
      url: "https://x.com/dana",
      found: true,
      location: "Springfield",
      followers: 300,
      employer: "BigCo",
      employerUrl: "company:bigco",
      title: "VP Engineering",
      linkedinUrl: "https://www.linkedin.com/in/dana",
    },
    { url: "https://x.com/uma", found: true, location: null, followers: 50, employer: "Tiny", title: "Engineer" },
    { url: "https://x.com/cy", found: true, location: null, followers: 50, employer: "Tiny", title: "Engineer" },
    { url: "https://www.linkedin.com/in/lee", found: true, location: null, followers: 10, employer: "Startup", employerUrl: "company:startup", title: null },
  ],
  companies: [
    { url: "company:bigco", name: "BigCo", domain: null, size: "10,001+ employees", employees: 20000, industry: null, fortune500: 12 },
    { url: "company:startup", name: "Startup", domain: "startup.dev", size: "2-10 employees", employees: 5, industry: null, fortune500: null, yc: "W26" },
  ],
};

test("personRows: one row per person worth a message, with tier label, source and how we know", () => {
  const rows = personRows(data);
  assert.deepEqual(
    rows.map((r) => [r.name, r.reason, r.tierLabel, r.platform]),
    [
      ["Dana", "switching", "Fortune 500 #12", "x"],
      ["Uma", "using", null, "x"],
      ["Lee", "asking", "YC W26", "linkedin"],
    ],
  );
  assert.equal(rows[0]!.howWeKnow, "X account matched to their LinkedIn with Exa");
  assert.equal(rows[0]!.linkedinUrl, "https://www.linkedin.com/in/dana");
  assert.equal(rows[0]!.commentUrl, "https://x.com/dana/status/9");
  assert.equal(rows[2]!.commentUrl, null);
  assert.equal(rows[1]!.howWeKnow, "From their X bio");
  assert.equal(rows[2]!.howWeKnow, "Employer from their LinkedIn profile");
});

test("filters: window, company, level, source, account and search", () => {
  const rows = personRows(data);
  const names = (patch: Partial<typeof NO_PEOPLE_FILTERS>) => filterPeople(rows, { ...NO_PEOPLE_FILTERS, ...patch }, data.capturedAt).map((r) => r.name);
  assert.deepEqual(names({}), ["Dana", "Uma"]);
  assert.deepEqual(names({ window: "all" }), ["Dana", "Uma", "Lee"]);
  assert.deepEqual(names({ window: "all", company: "enterprise" }), ["Dana"]);
  assert.deepEqual(names({ window: "all", company: "yc" }), ["Lee"]);
  assert.deepEqual(names({ window: "all", level: "director" }), ["Dana"]);
  assert.deepEqual(names({ window: "all", source: "linkedin" }), ["Lee"]);
  assert.deepEqual(names({ window: "all", account: "rival" }), ["Dana"]);
  assert.deepEqual(names({ window: "all", q: "monorepo" }), ["Lee"]);
  assert.deepEqual(names({ window: "all", reason: "using" }), ["Uma"]);
});

test("filters round-trip through the URL, and unknown values fall back", () => {
  const f = { window: "30" as const, reason: "switching" as const, company: "enterprise" as const, level: "manager" as const, source: "x" as const, account: "rival", q: "price" };
  const href = peopleFiltersHref(f);
  assert.equal(href, "?days=30&why=switching&co=enterprise&lvl=manager&src=x&acct=rival&q=price");
  assert.deepEqual(parsePeopleFilters(Object.fromEntries(new URLSearchParams(href.slice(1)))), f);
  assert.equal(peopleFiltersHref(NO_PEOPLE_FILTERS), "?");
  assert.deepEqual(parsePeopleFilters({ days: "9", why: "nope", co: "huge" }), NO_PEOPLE_FILTERS);
});

test("watchedAccounts counts posts collected, outside commenters and people worth a message", () => {
  const accounts = watchedAccounts(data, personRows(data));
  assert.deepEqual(
    accounts.map((a) => [a.name, a.platform, a.posts, a.people, a.worth]),
    [
      ["Acme", "x", 1, 2, 1],
      ["Acme", "linkedin", 1, 1, 1],
      ["Rival", "x", 1, 1, 1],
    ],
  );
});

test("funnel counts comments and identified authors in the window", () => {
  assert.deepEqual(funnel(data, "7"), { comments: 3, identified: 3 });
  assert.deepEqual(funnel(data, "all"), { comments: 4, identified: 4 });
});

test("peopleCsv has a header and quotes what it must", () => {
  const lines = peopleCsv(personRows(data).slice(0, 1)).trim().split("\n");
  assert.equal(lines[0], "name,title,level,company,company_tier,reason,what_they_said,comment_url,source,on_post_by,post_date,post_url,linkedin_url,x_url,location,opener,score");
  assert.match(lines[1]!, /^Dana,VP Engineering,VP,BigCo,Fortune 500 #12,Unhappy with a competitor,"This is a brutal downgrade, cancelling",https:\/\/x\.com\/dana\/status\/9,X,Rival,2026-01-09,/);
});
