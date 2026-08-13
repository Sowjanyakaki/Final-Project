# Problem Statement

## Objective

Build a voice-first AI property scout that understands a renter or buyer's spoken preferences, shortlists real listings, explains its shortlist decisions, and books a site-visit call, all grounded in real neighborhood data.

## Problem Statement

People don't struggle to find listings. They struggle to judge whether a listing actually fits their life: is the commute realistic, is the area safe at night, is it worth the extra rent for the extra room.

Your task is to build a voice-based AI assistant that:

- Collects preferences conversationally (budget, bedrooms, must-haves, commute point)
- Shortlists listings scraped from a real public source that match those preferences
- Grounds every neighborhood claim (safety, amenities, transit) in real public sources, not the model's general knowledge
- Allows the user to refine the shortlist using voice commands
- Explains why each listing was picked or dropped
- Books a site-visit slot via voice once the user has a shortlist they like

Along with the above, implement an n8n workflow that compiles the shortlist into a PDF and emails it to the user.

## What You Will Build

A deployed voice-mode property scout with a minimal companion UI.

### Core Capabilities (Required)

#### 1. Voice-Based Preference Collection

The assistant must support spoken inputs like:

> "I'm looking for a 2BHK in Koramangala, budget 35k, need parking, close to a metro station."

Ask clarifying questions only when required (max 5). Confirm constraints before generating the shortlist.

#### 2. Voice-Based Shortlist Refinement

The user must be able to modify the shortlist using voice commands:

- "Drop anything above 40k."
- "Only show me places within 15 minutes of a metro station."
- "I need something pet-friendly."
- "Add one more option with a balcony."

Only the affected part of the shortlist should change.

#### 3. Explanation & Reasoning

The assistant must answer:

- "Why did you pick this one?"
- "Is the commute from here realistic?"
- "What's this area actually like to live in?"

Explanations must be grounded, not generic.

### Companion UI

Your UI can be simple, but must include:

- Shortlist cards with rent, bedrooms, area, and key amenities
- A neighborhood snapshot panel per listing (transit, safety notes, amenities)
- A microphone button + live transcript
- A "Sources" or "References" section showing where each neighborhood claim came from
- A visit-confirmation panel showing the booking slot and confirmation code

## Data Requirements

Listings (rent, bedrooms, furnishing, amenities, society name, square footage, availability status) can be generated from https://bengaluru.rent/. See MCP Integration below for a tool that can help with this, though it isn't required.

**Note:** not every pin on bengaluru.rent is an active listing. Some are pinned by residents purely for rent transparency and are explicitly marked "Not for rent." Only pins marked as currently available should go into your working set; transparency-only pins are excluded.

Remove any PII like owner or agent contact details (names, phone numbers) from whatever you scrape before it touches your dataset, UI, or logs.

Nearby amenities and transit points should come from the OpenStreetMap MCP, since that's structured, queryable geodata, not something to guess.

Neighborhood practical guidance (safety notes, what an area is actually like) must also come from real public sources, for example neighborhood or city guide pages on Wikipedia or similar open sources, gathered the same way you gather listings.

### Rules

- Listings must map back to what you scraped and must be currently available, not just pinned for reference
- No PII (names, phone numbers) anywhere in your dataset, UI, or logs
- Amenities and transit claims must come from the OpenStreetMap MCP
- Neighborhood character claims must come from RAG sources with citations
- If listing, amenity, or neighborhood data is missing or unreliable, the system must say so, not guess

## MCP Integration

Your system must integrate MCP server in the orchestration layer. You are not required to build an MCP server from scratch; the skill being tested is wiring a real tool into an agent, not writing MCP boilerplate. Your own ranking or shortlist logic can live in your application code and call this tool as needed.

### Required MCP Tool

| Tool | Link | Use it for |
|---|---|---|
| OpenStreetMap MCP | https://github.com/jagan-shanmugam/open-streetmap-mcp | Nearby amenities, transit points, and POI data around a listing's location |

You must demonstrate the required MCP call clearly in your demo.

## RAG Requirements

RAG must be used for:

- Neighborhood practical guidance (safety, amenities, transit character)
- Explanations and justifications for shortlist decisions

### Rules

- All neighborhood claims must have citations
- No hallucinated claims about an area
- Voice explanations can be short; citations must appear in the UI

## AI Evaluations

You must implement at least three evaluation checks:

### Feasibility Eval

- Shortlist respects stated budget and must-haves
- Commute claims are internally consistent with stated commute point

### Edit Correctness Eval

- Voice edits only modify intended parts of the shortlist
- No unintended changes elsewhere

### Grounding & Hallucination Eval

- Listings map to dataset records and are marked as currently available
- Neighborhood claims cite RAG sources
- Uncertainty is explicitly stated when neighborhood data is missing

Evals can be rule-based or LLM-assisted but must be runnable.

## Tech & Deployment Requirements

- Build using LLM APIs
- Voice input (speech-to-text required)
- Version control using git
- Deployed prototype (public URL)
