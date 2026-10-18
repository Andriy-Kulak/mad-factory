import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountStats,
  breakdown,
  classifyComment,
  commenterRows,
  companyTier,
  groupTotals,
  leads,
  median,
  onTopic,
  seniorityOf,
  topicOf,
  outreach,
  type ReachPost,
  type B2BSocialData,
} from "./b2b-social.ts";

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

const data: B2BSocialData = {
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

const relevanceCompany = {
  url: "company:sample",
  name: "Sample Holdings",
  domain: null,
  size: "10,001+ employees",
  employees: 20_000,
  industry: null,
  fortune500: 12,
};

function relevanceData({
  group = "team",
  postText,
  replyText,
  personUrl = "https://www.linkedin.com/in/person",
  personName = "Person",
  employer = "Sample Holdings",
  employerUrl = relevanceCompany.url,
  title = "VP Engineering",
  postId = "relevance",
  postDate = "2026-01-09T00:00:00.000Z",
}: {
  group?: "team" | "competitor";
  postText: string;
  replyText: string;
  personUrl?: string;
  personName?: string;
  employer?: string | null;
  employerUrl?: string | null;
  title?: string | null;
  postId?: string;
  postDate?: string;
}): B2BSocialData {
  const handle = group === "team" ? "jo" : "rival";
  return {
    ...data,
    accounts: group === "team" ? data.accounts : [...data.accounts, { platform: "x", handle, name: "Rival", url: `https://x.com/${handle}`, group, followers: 5000, sample: "recent" }],
    posts: [post({ id: postId, handle, url: `https://x.com/${handle}/status/${postId}`, text: postText, postedAt: postDate })],
    comments: [{ postId, authorName: personName, authorUrl: personUrl, text: replyText }],
    people: [{ url: personUrl, found: true, location: null, followers: 25, employer, employerUrl, title }],
    companies: [relevanceCompany],
  };
}

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

test("onTopic matches coding terms and account names as whole words", () => {
  assert.equal(onTopic("3 g vs 5–6 g", []), false);
  assert.equal(onTopic("AI agents", []), true);
  assert.equal(onTopic("Does acme's Widget support this?", ["Acme"]), true);
  assert.equal(onTopic("Does acmeville support this?", ["Acme"]), false);
  assert.equal(onTopic("Jo's post", ["Jo"]), false);
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
  assert.equal(classifyComment(c("Can it run on our own servers?"), undefined, ["Acme"]), "evaluating");
  assert.equal(classifyComment(c("How does it compare to the other tools?"), undefined, ["Acme"]), "evaluating");
  assert.equal(classifyComment(c("Your pricing model is confusing now"), undefined, ["Acme"]), "pain");
  assert.equal(classifyComment(c("what's the new model's cache pricing?"), undefined, ["Acme"]), "evaluating");
  assert.equal(classifyComment(c("We keep hitting usage limits and switched away"), undefined, ["Acme"]), "pain");
  assert.equal(classifyComment(c("We have been using it for a month and love it"), undefined, ["Acme"]), "using");
  assert.equal(classifyComment(c(`${"A long take about the market. ".repeat(10)}Right?`), undefined, ["Acme"]), "commentary");
  assert.equal(classifyComment(c("Congrats 🎉"), undefined, ["Acme"]), "cheer");
  assert.equal(classifyComment(c("Sorry about that! It should be resolved now."), undefined, ["Acme"]), "insider");
});

test("commenterRows joins posts, accounts and people", () => {
  const rows = commenterRows(data);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["company", "evaluating", "cheer", "insider"],
  );
  assert.equal(rows[1]!.account?.handle, "acme-inc");
  assert.equal(rows[1]!.topic, "launch");
  assert.equal(rows[3]!.person?.employer, "ACME");
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
  assert.equal(companyTier({ ...c, name: "Self-Employed", size: "10,001+ employees", employees: 90000, fortune500: null }), "other");
});

test("leads rank senior people at big companies who asked something above cheers", () => {
  const big = { url: "https://www.linkedin.com/company/bigco", name: "BigCo", domain: "bigco.com", size: "10,001+ employees", employees: 50000, industry: "Banking", fortune500: 12 };
  const small = { url: "https://www.linkedin.com/company/tiny", name: "Tiny", domain: null, size: "2-10 employees", employees: 4, industry: null, fortune500: null };
  const person = (url: string, employerUrl: string, title: string) => ({ url, found: true, location: null, followers: null, employer: null, employerUrl, title });
  const d: B2BSocialData = {
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
      ["Vee", "fortune500", "vp", "evaluating"],
      ["Tom", "other", "exec", "evaluating"],
      ["Ivy", "fortune500", "ic", "cheer"],
    ],
  );
});

test("leads: tracked team profiles are insiders anywhere, and since keeps only comments on newer posts", () => {
  const d: B2BSocialData = {
    ...data,
    accounts: [...data.accounts, { platform: "linkedin", handle: "pat", name: "Pat", url: "https://www.linkedin.com/in/pat", group: "team", followers: 10, sample: "recent" }],
    posts: [...data.posts, post({ platform: "linkedin", id: "12", handle: "acme-inc", url: "https://www.linkedin.com/posts/acme-12", text: "New", postedAt: "2026-01-09T00:00:00.000Z" })],
    comments: [
      { postId: "10", authorName: "Pat", authorUrl: "https://www.linkedin.com/in/pat", text: "Does it work offline?" },
      { postId: "10", authorName: "Old", authorUrl: "https://www.linkedin.com/in/old", text: "Does it work offline?" },
      { postId: "12", authorName: "New", authorUrl: "https://www.linkedin.com/in/new", text: "Does it work offline?" },
    ],
  };
  assert.equal(commenterRows(d)[0]!.kind, "insider");
  assert.deepEqual(
    leads(d)
      .map((l) => l.name)
      .sort(),
    ["New", "Old"],
  );
  assert.deepEqual(
    leads(d, "2026-01-05T00:00:00.000Z").map((l) => l.name),
    ["New"],
  );
});

test("outreach: a reason and an opener per identifiable person, competitor pain first, anonymous and brand accounts left out", () => {
  const d: B2BSocialData = {
    ...data,
    accounts: [...data.accounts, { platform: "x", handle: "rival", name: "Rival", url: "https://x.com/rival", group: "competitor", followers: 5000, sample: "recent" }],
    posts: [...data.posts, post({ id: "20", handle: "rival", url: "https://x.com/rival/status/20", text: "Introducing new pricing" })],
    comments: [
      { postId: "20", authorName: "Dana", authorUrl: "https://x.com/dana", text: "This pricing change is a brutal downgrade, cancelling" },
      { postId: "20", authorName: "Anon", authorUrl: "https://x.com/anon", text: "So expensive now" },
      { postId: "20", authorName: "Bot", authorUrl: "https://x.com/bot", text: "Pricing is confusing? Here is how it works" },
      { postId: "1", authorName: "Uma", authorUrl: "https://x.com/uma", text: "We have been using it every day" },
      { postId: "1", authorName: "Cy", authorUrl: "https://x.com/cy", text: "Congrats!" },
    ],
    people: [
      {
        url: "https://x.com/dana",
        found: true,
        location: null,
        followers: 300,
        employer: "BigCo",
        employerUrl: "company:bigco",
        title: "Head of Platform",
        linkedinUrl: "https://www.linkedin.com/in/dana",
      },
      { url: "https://x.com/anon", found: true, location: null, followers: 10, employer: null, title: null },
      { url: "https://x.com/bot", found: true, location: null, followers: 9_000_000, employer: "Rival", title: "Bot" },
      { url: "https://x.com/uma", found: true, location: null, followers: 50, employer: "Tiny", title: "Engineer" },
      { url: "https://x.com/cy", found: true, location: null, followers: 50, employer: "Tiny", title: "Engineer" },
    ],
    companies: [{ url: "company:bigco", name: "BigCo", domain: null, size: "10,001+ employees", employees: 20000, industry: null, fortune500: null }],
  };
  const list = outreach(d);
  assert.deepEqual(
    list.map((o) => [o.lead.name, o.reason]),
    [
      ["Dana", "switching"],
      ["Uma", "using"],
    ],
  );
  assert.equal(list[0]!.profileUrl, "https://www.linkedin.com/in/dana");
  assert.equal(list[0]!.xUrl, "https://x.com/dana");
  assert.match(list[0]!.opener, /Rival's post/);
  assert.match(list[0]!.opener, /Acme/);
});

test("unrelated team replies stay listed as C3 nurture while coding posts keep their grade", () => {
  const replyText = "Is that the north trail?";
  const unrelated = outreach(relevanceData({ postText: "Sunrise hike at the canyon today", replyText }))[0]!;
  const onTopic = outreach(relevanceData({ postText: "Shipping our new coding agent", replyText }))[0]!;

  assert.equal(unrelated.relevant, false);
  assert.deepEqual([unrelated.fit, unrelated.intent, unrelated.route, unrelated.reason], ["C", 3, "nurture", "asking"]);
  assert.equal(onTopic.relevant, true);
  assert.equal(onTopic.fit, "A");
  assert.equal(onTopic.intent, 2);
  assert.notDeepEqual([onTopic.fit, onTopic.intent], ["C", 3]);
  assert.equal(unrelated.lead.score, onTopic.lead.score * 0.2);
});

test("company-name replies and competitor posts are relevant", () => {
  const companyMention = outreach(relevanceData({ postText: "Sunrise hike at the canyon today", replyText: "Does Acme support this?" }))[0]!;
  const competitor = outreach(relevanceData({ group: "competitor", postText: "Sunrise hike at the canyon today", replyText: "Is that the north trail?" }))[0]!;

  assert.equal(companyMention.relevant, true);
  assert.equal(competitor.relevant, true);
});

test("relevant touches and people sort before unrelated team-post touches", () => {
  const onTopic = relevanceData({
    postText: "Shipping a coding tool",
    replyText: "Is that the north trail?",
    personUrl: "https://www.linkedin.com/in/on-topic",
    personName: "On Topic",
    employer: "Small Studio",
    employerUrl: null,
    title: "Software Engineer",
    postId: "on-topic",
  });
  const unrelatedTouch = post({
    id: "on-topic-unrelated",
    handle: "jo",
    url: "https://x.com/jo/status/on-topic-unrelated",
    text: "Sunrise hike at the canyon today",
    postedAt: "2026-01-08T00:00:00.000Z",
  });
  onTopic.posts.push(unrelatedTouch);
  onTopic.comments.push({
    postId: unrelatedTouch.id,
    authorName: "On Topic",
    authorUrl: "https://www.linkedin.com/in/on-topic",
    text: "The trail ticket is too expensive",
  });
  const unrelated = relevanceData({
    postText: "Sunrise hike at the canyon today",
    replyText: "Is that the north trail?",
    personUrl: "https://www.linkedin.com/in/unrelated",
    personName: "Unrelated",
    postId: "unrelated",
  });
  const combined: B2BSocialData = {
    ...onTopic,
    posts: [...onTopic.posts, ...unrelated.posts],
    comments: [...onTopic.comments, ...unrelated.comments],
    people: [...onTopic.people, ...unrelated.people],
    companies: [...(onTopic.companies ?? []), ...(unrelated.companies ?? [])],
  };
  const rows = outreach(combined);
  const onTopicRow = rows.find((row) => row.lead.name === "On Topic")!;

  assert.deepEqual(
    rows.map((row) => [row.lead.name, row.relevant, row.fit, row.intent]),
    [
      ["On Topic", true, "C", 2],
      ["Unrelated", false, "C", 3],
    ],
  );
  assert.deepEqual(
    onTopicRow.lead.touches.map((touch) => touch.relevant),
    [true, false],
  );
  assert.equal(onTopicRow.lead.kind, "evaluating");
  assert.equal(onTopicRow.intent, 2);
});
