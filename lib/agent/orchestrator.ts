import { z } from 'zod';
import { tool, streamText, stepCountIs, type ModelMessage } from 'ai';
import { groq } from '@ai-sdk/groq';
import { db } from '../db/client';
import { toolCallLog } from '../db/schema';
import { searchListings } from './tools/searchListings';
import { retrieveNeighborhoodDocs } from './tools/retrieveNeighborhoodDocs';
import { applyShortlistEdit, type EditIntent } from './tools/applyShortlistEdit';
import { osmNearby } from './tools/osmNearby';
import { listBookingSlots } from './tools/listBookingSlots';
import { createBookingHold } from './tools/createBookingHold';
import type { BookingSlot } from './tools/types';

export const SYSTEM_PROMPT = `You are NextLeap's voice-first property scout for renters in Bengaluru.

Your job: collect the user's rental preferences (budget, bedrooms, must-have amenities, locality/commute point), shortlist real available listings that match, explain your shortlist decisions, let the user refine the shortlist with follow-up requests, and help them book a site-visit call.

Rules you must follow on every turn:
1. Ask at most 5 clarifying questions in total before producing a shortlist. Keep track of how many clarifying questions you have already asked in this conversation and stop asking once you reach 5 — proceed with the best shortlist you can from what you know.
2. Before calling searchListings to produce or refresh a shortlist, restate the constraints you understood (budget, bedrooms, locality, must-haves) back to the user in one sentence and get their confirmation.
3. Never state a neighborhood, amenity, or transit fact (for example "there's a metro station nearby", "this area is safe at night", "it has covered parking") without first calling osmNearby or retrieveNeighborhoodDocs in the SAME turn and basing the statement on its result. Do not rely on general knowledge for these claims.
4. If a grounding tool call (osmNearby or retrieveNeighborhoodDocs) returns uncertain: true, you must explicitly tell the user the data is unavailable or uncertain for that listing or area. Never fill the gap from general knowledge or guess.
5. When the user asks to change the shortlist (for example "drop anything above 40k", "remove that one", "add one more with a balcony"), call applyShortlistEdit with a precisely scoped editIntent — only the listings the user's instruction actually targets should change.
6. When the user wants to book a site visit, call listBookingSlots first to get real available slots, present them, and only call createBookingHold after the user has picked one.
7. Keep spoken/text replies concise; full explanations and citations belong in the UI.`;

const listingConstraintsSchema = z.object({
  budgetMax: z.number().optional(),
  bedrooms: z.number().optional(),
  locality: z.string().optional(),
  mustHaves: z.array(z.string()).optional(),
});

const retrieveNeighborhoodDocsSchema = z.object({
  locality: z.string(),
  topic: z.string(),
});

const editIntentSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('filter'),
    field: z.enum(['rent', 'bedrooms']),
    comparator: z.enum(['<=', '>=', '<', '>']),
    value: z.number(),
  }),
  z.object({
    op: z.literal('add'),
    filters: listingConstraintsSchema.partial(),
  }),
  z.object({
    op: z.literal('remove'),
    listingId: z.number(),
  }),
]);

const osmNearbySchema = z.object({
  lat: z.number(),
  lng: z.number(),
  category: z.string(),
});

const listBookingSlotsSchema = z.object({
  dayPreference: z.string(),
  timePreference: z.string(),
});

const bookingSlotSchema = z.object({
  id: z.string(),
  startIso: z.string(),
  label: z.string(),
});

function withToolCallLogging<TInput, TOutput>(
  toolName: string,
  sessionId: string,
  fn: (input: TInput) => Promise<TOutput>
): (input: TInput) => Promise<TOutput> {
  return async (input: TInput) => {
    const output = await fn(input);
    await db.insert(toolCallLog).values({
      sessionId,
      toolName,
      input: input as Record<string, unknown>,
      output: output as Record<string, unknown>,
      createdAt: new Date(),
    });
    // Tool results returned to the AI SDK must be plain JSON — e.g.
    // searchListings' rows carry a real `Date` for scrapedAt (from the DB
    // layer), which fails the SDK's own JSON-value validation when it builds
    // the next step's messages (confirmed against the live API: a deeply
    // nested AI_TypeValidationError on the follow-up request). Round-trip
    // through JSON to strip non-JSON values before returning to the tool
    // machinery; the log above still stores the original, richer object.
    return JSON.parse(JSON.stringify(output)) as TOutput;
  };
}

export function createAgent(sessionId: string) {
  const tools = {
    searchListings: tool({
      description:
        'Search the listings database for currently available rentals matching budget, bedrooms, locality, and must-have amenities. This is a deterministic filter/rank, not an LLM call.',
      inputSchema: listingConstraintsSchema,
      execute: withToolCallLogging('searchListings', sessionId, searchListings),
    }),
    retrieveNeighborhoodDocs: tool({
      description:
        'Retrieve grounded neighborhood guidance chunks (safety, amenities, transit character) for a locality and topic, with citations. Returns uncertain:true when nothing is found — never guess when that happens.',
      inputSchema: retrieveNeighborhoodDocsSchema,
      execute: withToolCallLogging('retrieveNeighborhoodDocs', sessionId, retrieveNeighborhoodDocs),
    }),
    applyShortlistEdit: tool({
      description:
        'Apply a scoped edit (filter, add, or remove) to the current session shortlist. Only the listings targeted by the edit change.',
      inputSchema: z.object({ editIntent: editIntentSchema }),
      execute: withToolCallLogging(
        'applyShortlistEdit',
        sessionId,
        ({ editIntent }: { editIntent: EditIntent }) => applyShortlistEdit({ sessionId, editIntent })
      ),
    }),
    osmNearby: tool({
      description:
        'Query OpenStreetMap for nearby amenities/transit points around a lat/lng. Required source of truth for any amenity or transit claim.',
      inputSchema: osmNearbySchema,
      execute: withToolCallLogging('osmNearby', sessionId, osmNearby),
    }),
    listBookingSlots: tool({
      description: 'List real available site-visit slots for a day/time preference.',
      inputSchema: listBookingSlotsSchema,
      execute: withToolCallLogging('listBookingSlots', sessionId, listBookingSlots),
    }),
    createBookingHold: tool({
      description: 'Create a tentative booking hold for a chosen slot and listing, returning a confirmation code.',
      inputSchema: z.object({ listingId: z.number(), topic: z.string(), slot: bookingSlotSchema }),
      execute: withToolCallLogging(
        'createBookingHold',
        sessionId,
        ({ listingId, topic, slot }: { listingId: number; topic: string; slot: BookingSlot }) =>
          createBookingHold({ sessionId, listingId: String(listingId), topic, slot })
      ),
    }),
  };

  return {
    tools,
    systemPrompt: SYSTEM_PROMPT,
    stream: (messages: ModelMessage[], options?: { onFinish?: (event: { text: string }) => void | Promise<void> }) =>
      streamText({
        model: groq('llama-3.3-70b-versatile'),
        system: SYSTEM_PROMPT,
        messages,
        tools,
        // ai's streamText defaults to stopWhen: stepCountIs(1) — a single step.
        // Without raising this, the agent would stop right after calling a
        // tool (e.g. searchListings) and never produce the natural-language
        // reply that explains the result. Allow enough steps for a turn that
        // calls several tools (search + grounding + booking) before replying.
        stopWhen: stepCountIs(8),
        // Lets the route persist the final assistant reply once the whole
        // multi-step turn completes, without blocking the streamed response
        // the client is already reading.
        onFinish: options?.onFinish,
      }),
  };
}
