# Feature Plan — Landing Page

The public, unauthenticated front door at `www.<domain>`. This is the only
page a visitor sees before logging in, so it carries the whole first
impression of the product.

Refer to CLAUDE.md for architecture rules and `docs/initial_plan.md` for
the overall build order.

---

## What this page is for

There is **no public signup** — a super admin creates every company by
hand. That single fact shapes the entire page:

- The primary CTA is **"Request a quote"**, not "Start free trial".
- Its job is to get a qualified manufacturer to send their details, or to
  pick up the phone.
- The secondary job is a **login door** for existing customers.
- With a ceiling of 250 companies, this is a high-touch sales motion. The
  page is a **sales-support asset**, not a self-serve conversion funnel.
  Ten well-qualified leads beat a thousand tyre-kickers.

**Audience:** owners and managers at aluminium window/façade fabrication
shops. Practical, time-poor, sceptical of software, often browsing on a
phone. They respond to "this fixes the quote you're re-typing for the
third time", not to "cloud-native platform".

---

## Decisions locked in

| Area | Decision |
| --- | --- |
| **Languages** | Arabic + English, **RTL supported from day one**. |
| **Primary CTA** | Request-a-quote form: **company name, requester name, phone**. |
| **Secondary CTA** | A visible phone number they can call or text. |
| **Backend** | **Frontend only for now.** Form uses a placeholder submit behind a clean seam; the real API is wired later without touching UI code. |
| **Assets** | None yet — placeholders and abstract visuals, clearly marked for replacement. |
| **Pricing** | No prices shown. "Request a quote" instead. |
| **Social proof** | **No testimonials or customer logos until real ones exist.** Fabricated proof is a lie to exactly the buyers you most need to trust you, and this industry is small enough that it gets noticed. |

---

## Proposed sections

Ordered as the visitor scrolls. Each earns its place by answering the
next question a sceptical buyer would ask.

### 1. Header / nav
Sticky, compact. Logo, a few section links, **language switcher (AR/EN)**,
phone number, `Log in` (quiet, secondary), `Request a quote` (primary).
On mobile it collapses to logo + language + a menu, with the CTA pinned.

### 2. Hero
The one screen that decides whether they keep scrolling.
- **Headline:** the specific outcome, not the category. Something in the
  register of *"From window design to work order — without re-typing
  anything."*
- **Subhead:** one sentence naming the audience explicitly, so the right
  person self-identifies and the wrong one leaves.
- **Dual CTA:** `Request a quote` (primary) + phone number (secondary).
- **Visual:** placeholder slot for a product shot. Until the app exists,
  use a clean abstract/line-art treatment of a window elevation — honest,
  on-domain, and not pretending to be a screenshot.

### 3. Problem — "sound familiar?"
Three or four concrete pains, in their language: quotes rebuilt in Excel
for every enquiry, measurements re-keyed between documents, spec sheets
that don't match what the workshop cut, work orders lost on WhatsApp,
no idea which job is where.

This is the highest-converting section for a niche tool. Specific pain
proves you know the trade — generic benefit copy proves you don't.

### 4. How it works
The core workflow from CLAUDE.md, as three numbered steps:
**1. Design the window → 2. Generate the paperwork → 3. Run the project.**
One line each, one visual each. This is the product in ten seconds.

### 5. What you get
Features grouped **by the workflow above**, never as a flat list:
- **Window designer** — dimensions, profiles, glass, hardware
- **Paperwork, generated** — quotes, specs, work orders, from the design
- **Projects** — every job's status in one place
- **Customers** — enquiry through delivery

Benefit-first headings, mechanism underneath.

### 6. Who it's for
A short qualifying block: aluminium window and façade fabricators.
Naming who it *isn't* for is a feature — it saves you sales calls with
people who wanted a generic CRM.

### 7. Why not a spreadsheet or a generic CRM
Direct differentiation, per CLAUDE.md's positioning against Odoo-style
tools. A generic CRM doesn't know what a mullion is, can't price glass,
and can't produce a cutting list. Short comparison; no competitor
bashing by name.

### 8. Request a quote (main conversion block)
The form, given a full section with its own heading and a reason to act.
Reassurance beside it: what happens after they submit, how fast you reply,
and that you'll call to understand their setup first. Phone number
repeated here for anyone who'd rather talk.

### 9. FAQ
Handles the objections that otherwise become unanswered doubts:
- Is our data separate from other companies'? *(yes — isolated per company)*
- Do we have to move everything at once?
- How long does it take to learn?
- Does it work on a phone or tablet in the workshop?
- What does it cost? *(→ request a quote)*
- Is it available in Arabic? *(yes)*

Accordion, accessible, first item open.

### 10. Footer
Contact details, phone, email, language switcher, links to Privacy Policy
and Terms, copyright. Quiet `Log in` link.

**Deliberately omitted:** testimonials, customer logos, case studies, "as
seen in", team photos, live counters. Every one of these would have to be
invented today. They get their own sections the moment they're real.

---

## Design direction

- **Tone:** industrial-precise. Clean, confident, technical without being
  cold. Aluminium, glass, straight lines, accurate angles. Avoid the
  generic purple-gradient SaaS look — the audience is a fabricator, and it
  reads as unserious to them.
- **Design tokens first.** Colour, typography scale, spacing, radii and
  shadows defined as tokens before any section is built, so the page is
  internally consistent and re-themeable when real branding arrives.
- **Palette:** neutral metal greys with one confident accent, high
  contrast. Locked to tokens so a brand swap is a one-file change.
- **Type:** a strong display face for headings, a highly legible face for
  body, and a proper Arabic typeface that pairs with it — Arabic in a
  Latin-first font is instantly recognisable as sloppy.
- **Imagery:** every image is a marked placeholder with fixed dimensions,
  so real assets drop in without reflowing the layout.
- **Motion:** restrained — subtle entrance transitions, no parallax
  circus. Must respect `prefers-reduced-motion`.
- **Dark mode:** decide early (see open questions). Cheap now via tokens,
  expensive to retrofit.

---

## Bilingual + RTL requirements

The biggest technical risk on this page. Retrofitting RTL means touching
every component, so it is built in from the first commit.

- [x] i18n library set up; **no hardcoded user-facing strings anywhere**
      (react-i18next; only `common` namespace exists so far — one
      namespace per remaining section gets added in Stage B)
- [x] Translation files for `ar` and `en`, one namespace per section
      (`common`, `hero`, `problem`, `howItWorks`, `features`, `whoItsFor`,
      `comparison`, `faq`, `quoteForm`)
- [x] `<html lang>` and `<html dir>` both driven by the active language
- [x] **Use logical CSS properties throughout** — `ms-`/`me-`, `ps-`/`pe-`,
      `text-start`/`text-end`, `start-`/`end-`. Never `ml-`, `mr-`, `left-`,
      `right-`. This is the single rule that makes RTL work. Held so far;
      the one place a physical value was unavoidable (the mobile nav
      `Sheet`, whose `side` prop only accepts `left`/`right`) is resolved
      by choosing the side at runtime from the active direction, not by a
      hardcoded value.
- [ ] Directional icons (arrows, chevrons, carets) mirror in RTL; logos and
      product visuals do **not** — no directional icons in the UI yet
      (first one is the FAQ accordion chevron, Stage B)
- [ ] Arabic typography tuned separately — Arabic generally needs more
      line-height and a slightly larger size than Latin at the same rank
      — a distinct Arabic typeface is loaded but line-height/size haven't
      been hand-tuned yet
- [x] Language choice persists across visits and applies before first
      paint, so the page doesn't visibly flip direction on load
- [x] Phone numbers, emails and URLs isolated with correct bidi handling —
      every phone number is wrapped in `<bdi>` (Header, Footer, Hero, the
      quote form's error and fallback states)
- [ ] `hreflang` tags and per-language meta/OG for both languages
- [x] Whole page reviewed in RTL at every breakpoint — desktop (1440px)
      and mobile (390px), full page, in both languages. Verified by
      measuring `document.documentElement.scrollWidth` against the
      viewport, not by eyeballing a screenshot — that measurement is what
      caught the honeypot overflow bug documented under Stage C.

> **Arabic copy must be written or reviewed by a native speaker.**
> Machine-translated marketing copy reads as foreign to exactly the
> customers this page targets, and undercuts the credibility the rest of
> the page is working to build. See open questions.

---

## The request-a-quote form

### Fields
| Field | Rules |
| --- | --- |
| Company name | Required, trimmed, sane length bounds |
| Requester name | Required, trimmed, sane length bounds |
| Phone | Required, validated format (see open questions) |

Keep it to these three. Every extra field costs conversions, and you'll
learn the rest on the call.

### Build notes
- [ ] React Hook Form + Zod, matching the stack in CLAUDE.md
- [ ] **Zod schema lives in `packages/types`** so the backend validates
      with the identical schema later — one definition, no drift
- [ ] Define the API contract **now** (endpoint, request, response,
      error shape) and document it here, so the backend implements to a
      known target
- [ ] Submission goes through a single `submitQuoteRequest()` module that
      currently resolves a mocked success. Swapping to a real `fetch` is a
      one-file change; **no component knows the API doesn't exist yet**
- [ ] All four states designed and built: idle, submitting (disabled +
      spinner), success (clear confirmation of what happens next), error
      (with the phone number as a fallback — never a dead end)
- [ ] Inline validation on blur, not on every keystroke
- [ ] Honeypot field + submit-timing check now; real rate limiting when
      the API lands
- [ ] Accessible: real `<label>`s, errors tied via `aria-describedby`,
      errors announced to screen readers, focus moved to the first invalid
      field, full keyboard operation
- [ ] Both languages: Arabic and English validation messages, RTL-correct
      input direction, phone input staying LTR

### Note on data
This form collects personal contact details, so a Privacy Policy link
belongs beside the submit button from day one — not added later. The
policy itself can start as a stub, but the link should not be missing.

---

## Quality bar

**Responsive**
- [ ] Mobile-first; designed at mobile, tablet and desktop widths
- [ ] Verified on a real phone — this audience is mobile-heavy
- [ ] No horizontal scroll at any width, in either direction
- [ ] Tap targets comfortably large

**Accessibility (target WCAG 2.1 AA)**
- [ ] Semantic landmarks and one logical heading order
- [ ] Contrast checked against tokens, in both themes if dark mode ships
- [ ] Full keyboard path with visible focus states
- [ ] Alt text on every meaningful image; decorative images hidden
- [ ] `prefers-reduced-motion` respected
- [ ] Accessible name on the language switcher

**Performance**
- [ ] Images optimised, correctly sized, lazy-loaded below the fold
- [ ] Hero image prioritised — it's the LCP element
- [ ] Fonts subset and preloaded, with a non-shifting fallback
- [ ] No layout shift from images, fonts or the language switch
- [ ] Route-level code splitting; landing page ships no app-only JS

**SEO**
- [ ] Per-language title, description and OG/Twitter tags
- [ ] `hreflang` for `ar` and `en`
- [ ] Organisation/Product structured data
- [ ] Semantic HTML, one `<h1>`
- [ ] `robots.txt`, sitemap, favicon and social share image
- [ ] Real content in the HTML, not injected only after JS runs

**Analytics**
- [ ] Decide on a tool, then track: page views by language, CTA clicks,
      form starts, form completions, phone-number clicks
- [ ] Cookie/consent handling if the tool requires it

---

## Build order

**Stage A — Foundations** ✅ done
- [x] Tailwind + shadcn/ui installed and configured (Tailwind v4, shadcn
      `radix-nova` style, RTL-aware primitives)
- [x] Design tokens defined (steel-grey neutrals + burnt-orange accent,
      OKLCH, light theme only per decision — see `src/index.css`)
- [x] Fonts chosen and loaded (Latin: Geist Variable; Arabic: IBM Plex
      Sans Arabic, self-hosted via Fontsource, switched by `html:lang(ar)`)
- [x] i18n + RTL infrastructure working end to end (react-i18next,
      `<html lang>`/`<html dir>` synced before first paint, verified with
      a real screenshot pass — full mirroring, no flip-on-load)
- [x] Language switcher, persisting choice (localStorage, no
      browser-language auto-detect — first-time visitors default to
      English per decision)
- [x] Page shell: header, footer, section scaffolding (`Header`, `Footer`,
      `Container`, `Section`, mobile nav via `Sheet` — opens from the
      correct edge in both LTR and RTL), routing via `react-router`
      (`/`, `/login`, `/privacy`, `/terms` as placeholder stubs)

**Stage B — Content sections** ✅ done
- [x] Build sections 1–7 and 9–10 as independent components (`Hero`,
      `Problem`, `HowItWorks`, `Features`, `WhoItsFor`, `Comparison`, `Faq`
      — one namespace each in `src/locales/{en,ar}/`)
- [x] English copy written
- [x] Arabic copy written — **still needs native-speaker review before
      launch**, per the open question below. Written by me, not verified.
- [x] Placeholder visuals in place at final dimensions (hand-drawn SVG
      line-art window elevation in the hero, token-colored so it re-themes
      for free; icon-based visuals elsewhere — no bespoke illustrations
      needed for v1)

**Stage C — The form** ✅ done
- [x] Shared Zod schema in `packages/types` (`quoteRequestSchema` in
      `packages/types/src/quote-request.ts`, includes the `website`
      honeypot field in the wire contract so the backend can share the
      same anti-spam check later)
- [x] API contract documented (`QuoteRequestInput` / `QuoteRequestResponse`
      types alongside the schema — the target for Stage E)
- [x] Form with all four states behind the mocked submit seam
      (`submitQuoteRequest()` in `src/lib/quote-request.ts` is the one
      place that knows the endpoint doesn't exist yet)
- [x] Spam protections and accessibility complete (honeypot + submit-timing
      check, real labels, `aria-invalid`/`aria-describedby`, errors
      announced via `role="alert"`, focus moves to the first invalid field)

> **Bug caught and fixed during Stage C verification:** the honeypot field
> was hidden with a hardcoded `-left-[9999px]`, which is exactly the
> physical-CSS mistake the RTL rules above exist to prevent. In RTL it blew
> the document width out to over 11,000px instead of 1440px — invisible in
> a quick look, only caught by measuring actual `scrollWidth` in both
> directions. Fixed with the standard clip-based hidden technique, which
> needs no directional offset at all. Lesson applied: **verify overflow by
> measurement, not by eyeballing a screenshot** — added as a check in
> Stage D below.

**Stage D — Polish**
- [ ] Responsive pass at every breakpoint, **LTR and RTL**
- [ ] Accessibility audit
- [ ] Performance pass
- [ ] SEO and share previews
- [ ] Motion and final visual polish
- [ ] Privacy Policy and Terms stubs so footer links resolve

**Stage E — API integration (blocked on backend)**
- [ ] Implement the documented endpoint, validating with the shared schema
- [ ] Persist leads and notify you (email via BullMQ, per CLAUDE.md)
- [ ] Server-side rate limiting and spam handling
- [ ] Swap the mocked submit for the real call — the one-file change
- [ ] Test the real path end to end, including failure states

---

## How this fits the main plan

Stages A–D have **no backend dependency**, so this page can be built in
parallel with backend Phases 3–7 rather than waiting for them. That makes
it useful work to run alongside the riskier tenant plumbing.

Two real dependencies:
- The `Log in` link needs the login route from **Phase 8** — until then it
  points at a placeholder route.
- Stage E needs the API deployed, so it lands with or after **Phase 10**.

Worth noting: this page is bigger than the "guest/landing page" checkbox
in Phase 8 of `docs/initial_plan.md`. That checkbox should be treated as
*"the landing route exists and renders"*; this document is the real scope.

---

## Open questions

1. **Who writes the Arabic copy?** I can draft English and produce a
   working Arabic translation, but it should be reviewed by a native
   speaker before launch — marketing copy is where translation quality
   shows most.
2. **Default language for a first-time visitor** — Arabic, English, or
   detect from the browser?
3. **Digits in Arabic** — Western (`1234`) or Arabic-Indic (`١٢٣٤`)?
   Affects phone numbers and any figures on the page.
4. **Phone number format** — which country/countries should the form
   accept? This decides whether validation is strict, country-prefixed, or
   permissive.
5. **"Text us" — SMS or WhatsApp?** WhatsApp is the norm for trade
   business in many markets and would mean a `wa.me` link rather than a
   plain `tel:`.
6. **Product and domain name** — is "Aluminia" (the repo name) the real
   product name, and is there a domain yet? It goes in the logo, title,
   meta and structured data.
7. **Dark mode** — worth deciding now while it's just tokens.
