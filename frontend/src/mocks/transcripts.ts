import type { TranscriptTurn } from '../types/ui';

/*
  Call transcripts, keyed by session. `atMs` is the offset from call start and
  drives replay pacing; `yields` names the changes that turn produced, so the
  capture panel fills in step with the words that caused it.
*/

const SES_0431: TranscriptTurn[] = [
  { atMs: 0, speaker: 'agent', text: 'Good morning. This is the study team calling ahead of your Cycle 5 visit. I have a few minutes of questions about your medications. Is now still a good time?' },
  { atMs: 5200, speaker: 'participant', text: "Yes, that's fine." },
  { atMs: 7400, speaker: 'agent', text: 'Thank you. I have four medications on file. I will read them out, and you tell me if anything has changed. First, the cholesterol tablet, atorvastatin, twenty milligrams at night.' },
  { atMs: 15100, speaker: 'participant', text: 'The cholesterol tablet, yes, same as before, one at night.', yields: ['CH-105'] },
  { atMs: 19800, speaker: 'agent', text: 'Good. Next, allopurinol, three hundred milligrams once a day.' },
  { atMs: 24300, speaker: 'participant', text: 'They cut the allopurinol down to one small tablet in June.', yields: ['CH-103'] },
  { atMs: 30600, speaker: 'agent', text: 'Understood, so the hundred milligram tablet since June. And the omeprazole, twenty milligrams once a day for reflux?' },
  { atMs: 37200, speaker: 'participant', text: 'I came off the reflux one back in July. It was not doing much.', yields: ['CH-104'] },
  { atMs: 43500, speaker: 'agent', text: 'Noted, stopped in July. Do you remember roughly which part of July?' },
  { atMs: 48100, speaker: 'participant', text: 'No, I could not say. Sometime in the month.' },
  { atMs: 52400, speaker: 'agent', text: 'That is fine, I will record it as July. Now, has anything new been started since we last spoke? Anything at all, including things another doctor prescribed.' },
  { atMs: 60900, speaker: 'participant', text: 'My other doctor put me on prednisone for the joint pain. Twenty milligrams.', yields: ['CH-101'] },
  { atMs: 67200, speaker: 'agent', text: 'Thank you for telling me. I am flagging that for your coordinator to discuss at the visit. Have you had any vaccinations recently?' },
  { atMs: 74800, speaker: 'participant', text: 'I had the shingles jab at the pharmacy in August. Just the one shot.', yields: ['CH-107'] },
  { atMs: 81100, speaker: 'agent', text: 'Do you happen to remember the brand name on that one?' },
  { atMs: 85200, speaker: 'participant', text: 'No, sorry. They just called it the shingles one.' },
  { atMs: 89400, speaker: 'agent', text: 'Not a problem, your coordinator will check it with the pharmacy. Anything else, even occasionally?' },
  { atMs: 95400, speaker: 'participant', text: 'Melatonin, the gummies, on and off for sleep. Years now.', yields: ['CH-106'] },
  { atMs: 101700, speaker: 'agent', text: 'And do you know the strength on the melatonin?' },
  { atMs: 105200, speaker: 'participant', text: 'No idea, sorry.' },
  { atMs: 108600, speaker: 'agent', text: 'Not a problem. Anything else at all?' },
  { atMs: 113100, speaker: 'participant', text: 'And there is a little blue pill I take for my stomach. I could not tell you the name.', yields: ['CH-102'] },
  { atMs: 120400, speaker: 'agent', text: 'That is alright. Your coordinator will ask you to bring the bottle to the visit so we can record it properly. That is everything I needed. Thank you for your time.' },
  { atMs: 129000, speaker: 'participant', text: 'Thank you, goodbye.' },
];

const SES_0432: TranscriptTurn[] = [
  { atMs: 0, speaker: 'agent', text: 'Good morning. This is the study team calling ahead of your Cycle 3 visit. Do you have a few minutes to go through your medications?' },
  { atMs: 6100, speaker: 'participant', text: 'Sure, go ahead.' },
  { atMs: 8800, speaker: 'agent', text: 'Thank you. I have levothyroxine on file, seventy-five micrograms once daily. Is that still right?' },
  { atMs: 15600, speaker: 'participant', text: 'The thyroid one, every morning, no change.', yields: ['CH-201'] },
  { atMs: 20200, speaker: 'agent', text: 'Good. Has anything new started since we last spoke, including any vaccinations?' },
  { atMs: 27500, speaker: 'participant', text: 'I got the flu vaccine last week. The nasal spray one, not the needle.', yields: ['CH-202'] },
  { atMs: 34100, speaker: 'agent', text: 'Thank you for telling me, that detail matters. I am flagging it for your coordinator. Which pharmacy was that at?' },
];

export const TRANSCRIPTS: Record<string, TranscriptTurn[]> = {
  'SES-2026-0431': SES_0431,
  'SES-2026-0432': SES_0432,
};

/** Wall-clock length of a call fixture. */
export function transcriptDuration(turns: TranscriptTurn[]): number {
  return turns.length ? turns[turns.length - 1].atMs + 4000 : 0;
}
