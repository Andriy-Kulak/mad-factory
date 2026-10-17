import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountStats,
  breakdown,
  classifyComment,
  commenterRows,
  commentersCsv,
  companyTier,
  groupTotals,
  leadAccounts,
  leads,
  median,
  seniorityOf,
  topicOf,
  type ReachPost,
  type SocialReachData,
} from "./social-reach.ts";

const post = (over: Partial<ReachPost>): ReachPost => ({
  platform: "x",
  id: "1",
  handle: "acme",
  url: "https://x.com/acme/status/1",
  text: "",
  postedAt: "2026-01-01T00:00:00.000Z",
  format: "text",
  views: null,
  likes: null,
  comments: null,
  reposts: null,
  quotes: null,
  bookmarks: null,
  ...over,
});

const data: SocialReachData = {
  capturedAt: "2026-01-10",
  credits: 7,
  accounts: [
    { platform: "x", handle: "acme", name: "Acme", url: "https://x.com/acme", group: "company", followers: 1000, sample: "recent" },
    { platform: "x", handle: "jo", name: "Jo", url: "https://x.com/jo", group: "team", followers: 100, sample: "popular" },
    { platform: "linkedin", handle: "acme-inc", name: "Acme", url: "https://www.linkedin.com/company/acme-inc", group: "company", followers: 5000, sample: "recent" },
  ],
  posts: [
    post({ id: "1", views: 100, likes: 10, bookmarks: 1 }),
    post({ id: "2", views: 300, likes: 30, bookmarks: 3, format: "video", postedAt: "2026-01-03T00:00:00.000Z" }),
    post({ id: "3", views: 5, likes: 1, isReply: true }),
    post({ id: "4", handle: "jo", views: 900, likes: 40 }),
    post({ platform: "linkedin", id: "10", handle: "acme-inc", url: "https://www.linkedin.com/posts/acme-10", text: "Introducing Widgets 2", likes: 200, comments: 12 }),
    post({ platform: "linkedin", id: "11", handle: "acme-inc", url: "https://www.linkedin.com/posts/acme-11", text: "Old post, listed only" }),
  ],
  comments: [
    { postId: "10", authorName: "Acme", authorUrl: "https://www.linkedin.com/company/acme-inc", text: "Read more: https://example.com" },
    { postId: "10", authorName: "Sam", authorUrl: "https://www.linkedin.com/in/sam", text: "Does it work with spreadsheets?" },
    { postId: "10", authorName: "Kim", authorUrl: "https://www.linkedin.com/in/kim", text: "Congrats!" },
    { postId: "10", authorName: "Lee", authorUrl: "https://www.linkedin.com/in/lee", text: "Shipped it!" },
  ],
  people: [{ url: "https://www.linkedin.com/in/lee", found: true, location: "Somewhere", followers: 10, employer: "ACME" }],
};

test("median handles odd, even, empty and nulls", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([null, null]), null);
  assert.equal(median([null, 5]), 5);
});

test("accountStats leaves replies out and relates views to followers", () => {
  const [company, team] = accountStats(data, "x");
  assert.equal(company!.posts, 2);
  assert.equal(company!.medianViews, 200);
  assert.equal(company!.topViews, 300);
  assert.equal(company!.viewsPerFollower, 0.2);
  assert.equal(company!.first, "2026-01-01T00:00:00.000Z");
  assert.equal(company!.last, "2026-01-03T00:00:00.000Z");
  assert.equal(team!.viewsPerFollower, 9);
});

test("accountStats counts LinkedIn posts without numbers but only measures the fetched ones", () => {
  const [page] = accountStats(data, "linkedin");
  assert.equal(page!.posts, 2);
  assert.equal(page!.measured, 1);
  assert.equal(page!.medianLikes, 200);
  assert.equal(page!.likesPer1k, 40);
  assert.equal(page!.medianViews, null);
});

test("topicOf puts company news ahead of the launch words it contains", () => {
  assert.equal(topicOf("Introducing our new dashboard"), "launch");
  assert.equal(topicOf("We have raised $40M at a $1B valuation and are launching more"), "funding");
  assert.equal(topicOf("Alex has joined us as VP of Partnerships"), "hire");
  assert.equal(topicOf("Welcome Alex to the team!"), "hire");
  assert.equal(topicOf("Example Co is acquiring Sample Labs"), "acquisition");
  assert.equal(topicOf("How Sample Co 3x'ed its output. Read the full story"), "customer");
  assert.equal(topicOf("A look behind the scenes at our offsite"), "event");
  assert.equal(topicOf("Some thoughts on the future of work"), "other");
});

test("breakdown groups measured posts only", () => {
  const rows = breakdown(
    data.posts.filter((p) => p.platform === "x"),
    (p) => p.format,
  );
  assert.deepEqual(
    rows.map((r) => [r.key, r.posts]),
    [
      ["text", 3],
      ["video", 1],
    ],
  );
});

test("classifyComment: company pages, employer match, questions, long takes and cheers", () => {
  const c = (text: string, authorUrl = "https://www.linkedin.com/in/x") => ({ postId: "1", authorName: "X", authorUrl, text });
  assert.equal(classifyComment(c("Read more", "https://www.linkedin.com/company/acme"), undefined, ["Acme"]), "company");
  assert.equal(classifyComment(c("Nice"), { url: "", found: true, location: null, followers: null, employer: "Acme, Inc." }, ["acme inc"]), "insider");
  assert.equal(classifyComment(c("Insane work by our team!"), undefined, ["Acme"]), "insider");
  assert.equal(classifyComment(c("Can it run on our own servers?"), undefined, ["Acme"]), "signal");
  assert.equal(classifyComment(c("We have been using it for a month and love it"), undefined, ["Acme"]), "signal");
  assert.equal(classifyComment(c(`${"A long take about the market. ".repeat(10)}Right?`), undefined, ["Acme"]), "commentary");
  assert.equal(classifyComment(c("Congrats 🎉"), undefined, ["Acme"]), "cheer");
});

test("commenterRows joins posts, accounts and people, and the CSV quotes what it must", () => {
  const rows = commenterRows(data);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["company", "signal", "cheer", "insider"],
  );
  assert.equal(rows[1]!.account?.handle, "acme-inc");
  assert.equal(rows[1]!.topic, "launch");
  assert.equal(rows[3]!.person?.employer, "ACME");

  const csv = commentersCsv([{ ...rows[1]!, comment: { ...rows[1]!.comment, text: 'He said "hi", then left' } }]).split("\n");
  assert.equal(csv[0], "kind,commenter,profile_url,title,seniority,employer,company_tier,fortune500_rank,company_linkedin,location,followers,comment,post_account,post_topic,post_date,post_url");
  assert.equal(csv[1], 'signal,Sam,https://www.linkedin.com/in/sam,,Unknown,,Smaller company,,,,,"He said ""hi"", then left",Acme,Launch,2026-01-01,https://www.linkedin.com/posts/acme-10');
});

test("groupTotals adds up followers per group and only counts recent originals", () => {
  const [company, team] = groupTotals(data, "x", "2026-01-02T00:00:00.000Z");
  assert.deepEqual(
    { accounts: company!.accounts, followers: company!.followers, active: company!.active, posts: company!.posts, views: company!.views, top: company!.top?.id },
    { accounts: 1, followers: 1000, active: 1, posts: 1, views: 300, top: "2" },
  );
  assert.deepEqual({ followers: team!.followers, active: team!.active, posts: team!.posts }, { followers: 100, active: 0, posts: 0 });
});

test("seniorityOf reads the most senior word in a title", () => {
  assert.equal(seniorityOf("Co-Founder & CEO"), "exec");
  assert.equal(seniorityOf("Senior Vice President, Engineering"), "vp");
  assert.equal(seniorityOf("Platform Lead - SVP"), "vp");
  assert.equal(seniorityOf("Head of Platform"), "director");
  assert.equal(seniorityOf("Senior Director of Engineering"), "director");
  assert.equal(seniorityOf("Engineering Manager"), "manager");
  assert.equal(seniorityOf("Technical Product Owner"), "manager");
  assert.equal(seniorityOf("Principal Software Engineer"), "senior");
  assert.equal(seniorityOf("Software Engineer"), "ic");
  assert.equal(seniorityOf("Dreamer"), "unknown");
  assert.equal(seniorityOf(null), "unknown");
});

test("companyTier: Fortune 500 rank first, then LinkedIn's 10,001+ bucket", () => {
  const c = { url: "u", name: "N", domain: null, industry: null };
  assert.equal(companyTier({ ...c, size: "10,001+ employees", employees: 5000, fortune500: 40 }), "fortune500");
  assert.equal(companyTier({ ...c, size: "10,001+ employees", employees: 5000, fortune500: null }), "enterprise");
  assert.equal(companyTier({ ...c, size: "51-200 employees", employees: 120, fortune500: null }), "other");
  assert.equal(companyTier(undefined), "other");
});

test("leads rank senior people at big companies who asked something above cheers, and roll up by company", () => {
  const big = { url: "https://www.linkedin.com/company/bigco", name: "BigCo", domain: "bigco.com", size: "10,001+ employees", employees: 50000, industry: "Banking", fortune500: 12 };
  const small = { url: "https://www.linkedin.com/company/tiny", name: "Tiny", domain: null, size: "2-10 employees", employees: 4, industry: null, fortune500: null };
  const person = (url: string, employerUrl: string, title: string) => ({ url, found: true, location: null, followers: null, employer: null, employerUrl, title });
  const d: SocialReachData = {
    ...data,
    comments: [
      { postId: "10", authorName: "Vee", authorUrl: "https://www.linkedin.com/in/vee", text: "Does it handle our monorepo?" },
      { postId: "10", authorName: "Ivy", authorUrl: "https://www.linkedin.com/in/ivy", text: "Congrats!" },
      { postId: "10", authorName: "Tom", authorUrl: "https://www.linkedin.com/in/tom", text: "How much does it cost?" },
      { postId: "10", authorName: "Lee", authorUrl: "https://www.linkedin.com/in/lee", text: "Great launch" },
    ],
    people: [
      person("https://www.linkedin.com/in/vee", big.url, "VP Engineering"),
      person("https://www.linkedin.com/in/ivy", big.url, "Software Engineer"),
      person("https://www.linkedin.com/in/tom", small.url, "Founder"),
      { url: "https://www.linkedin.com/in/lee", found: true, location: null, followers: null, employer: "Acme", employerUrl: null, title: null },
    ],
    companies: [big, small],
  };
  const list = leads(d);
  assert.deepEqual(
    list.map((l) => [l.name, l.tier, l.seniority, l.kind]),
    [
      ["Vee", "fortune500", "vp", "signal"],
      ["Tom", "other", "exec", "signal"],
      ["Ivy", "fortune500", "ic", "cheer"],
    ],
  );
  const accounts = leadAccounts(list);
  assert.deepEqual(
    accounts.map((a) => [a.company.name, a.people.length, a.signals, a.topSeniority]),
    [
      ["BigCo", 2, 1, "vp"],
      ["Tiny", 1, 1, "exec"],
    ],
  );
});
