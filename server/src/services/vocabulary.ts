/**
 * The words the system asks models to describe items with.
 *
 * Shared by the prompts that *write* an item's fields (image analysis,
 * description enhancement, CCTV description) and the prompts that *compare*
 * them. That sharing is the point: two reports of the same wallet are only
 * comparable if the two people, or the two model calls, reached for the same
 * word.
 *
 * The concrete failure this exists for is in the labelled set. One report says
 * "Black leather wallet" and the other says "Dark leather wallet", and the
 * retrieval stage scores them as sharing nothing but "leather wallet" — while
 * a brown wallet that happens to repeat more of the query's wording ranks
 * above the true match. Free-choice colour words make that a coin flip. A
 * closed list makes it an equality check.
 *
 * Deliberately short. A long list is a list nobody follows and a model picks
 * from at random; these are the distinctions a person filing a lost-property
 * report actually makes.
 */

export const COLOURS = [
  'Black',
  'White',
  'Grey',
  'Silver',
  'Gold',
  'Brown',
  'Beige',
  'Red',
  'Pink',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Purple',
  'Multicoloured',
  'Transparent',
] as const;

export const CATEGORIES = [
  'Electronics',
  'Bags',
  'Clothing',
  'Accessories',
  'Documents',
  'Keys',
  'Wallets',
  'Jewellery',
  'Sports',
  'Books',
  'Eyewear',
  'Toys',
  'Other',
] as const;

export type Colour = (typeof COLOURS)[number];
export type Category = (typeof CATEGORIES)[number];

/**
 * The instruction block every describing prompt shares.
 *
 * Three things it insists on, in order of how much they are worth to the
 * matching that happens later.
 *
 * An identifier is worth more than everything else combined. A serial number,
 * a model number, an IMEI, a registration, a name written inside a bag: two
 * reports carrying the same one are describing the same object, and the
 * retrieval stage weights them accordingly. A model that reads one off a photo
 * and puts it in the description has done more for the match than any amount
 * of prose about the object's general appearance.
 *
 * Nothing invented. A lost report is filed by somebody describing an object
 * from memory, and a model that embellishes it produces specifics that were
 * never true and that matching will then treat as evidence. "Do not guess" is
 * the single most important line in these prompts.
 *
 * And the closed vocabularies above, so two descriptions of one thing agree.
 */
export const DESCRIPTION_RULES = [
  'Rules, in order of importance:',
  '',
  '1. Record any identifier exactly as it appears: serial number, model number,',
  '   IMEI, registration, or a name written on the object. Put it in the',
  '   description and also as its own tag, character for character, including',
  '   hyphens. This is the single most useful thing you can record.',
  '2. Never invent or infer a detail you cannot see or were not told. A brand',
  '   you cannot read is not a brand. If a field is unknown, leave it empty',
  '   rather than guessing. An invented detail becomes evidence in a later',
  '   comparison and is worse than no detail at all.',
  `3. Colour must be exactly one of: ${COLOURS.join(', ')}. Choose the closest`,
  '   one rather than inventing a shade; use Multicoloured only when no single',
  '   colour dominates.',
  `4. Category must be exactly one of: ${CATEGORIES.join(', ')}.`,
  '5. Prefer specific, checkable detail over adjectives. "Cracked top-right',
  '   corner", "sticker of a fox on the lid", "three keys on a metal ring" are',
  '   worth more than "good condition" or "modern looking".',
  '6. Tags are lower-case single words or short phrases: brand, model, material,',
  '   object type, and any identifier. Six to ten of them.',
].join('\n');

/**
 * How to weigh evidence when comparing two reports of the same object.
 *
 * Shared by the batched reranker and the per-pair scorer, which had different
 * wording and different score bands for the same question. Two scorers that
 * disagree about what 60 means cannot be substituted for one another, and one
 * ranking built from both is decided by which of them happened to answer.
 *
 * The three rules that matter are all about asymmetry, and all three are
 * things a model does not assume unless told:
 *
 * A finder writes less than a loser. Somebody who lost a bag lists what was
 * inside it; somebody who found it lists what they can see without opening it.
 * So a detail present on one side and absent on the other is close to no
 * evidence, while a detail present on both and *different* is strong evidence
 * against.
 *
 * Colour words are approximate even from a closed list, because one report may
 * predate the list or come from a person typing freely. "Dark" and "Black"
 * are the same wallet.
 *
 * And an identifier settles it. A matching serial or model number outweighs
 * every disagreement of wording; a *conflicting* one outweighs every
 * agreement.
 */
export const MATCHING_RULES = [
  'How to weigh the evidence, strongest first:',
  '',
  '1. Identifiers. A serial number, model number, IMEI, registration or a name',
  '   written on the object. If both reports carry the same one, they are the',
  '   same object however differently the rest is worded. If they carry',
  '   different ones, they are not, however similar the rest looks.',
  '2. Distinguishing specifics: damage, engraving, a sticker, an unusual',
  '   combination of contents, a count ("four keys"). Agreement here is strong.',
  '3. Brand and model, then object type.',
  '4. Colour, size and material. Treat colour words as approximate: dark,',
  '   black and charcoal are one colour; navy and dark blue are one colour.',
  '   A genuine colour disagreement (brown against black) is strong evidence',
  '   against.',
  '5. Category alone is almost no evidence. Most reports in a lost-property',
  '   office share a category.',
  '',
  'Asymmetry, which is the thing most often got wrong here: the person who',
  'lost an object describes it from memory and lists what was inside it; the',
  'person who found it describes what they can see. A detail on one side and',
  'missing from the other is weak evidence either way. A detail on both sides',
  'that conflicts is strong evidence against.',
  '',
  'Ignore wording, spelling, word order, and how much or how little was',
  'written. Length is not evidence.',
].join('\n');

/**
 * The score bands.
 *
 * One definition, used by both scorers, so a score from either means the same
 * thing and a ranking can be built from a mixture of the two.
 */
export const SCORE_BANDS = [
  '  90-100  the same object: an identifier matches, or several specifics agree',
  '          and none conflict',
  '  75-89   very probably the same: type, brand and specifics agree, one',
  '          detail differs or is missing on one side',
  '  40-74   same kind of thing, but the specifics disagree or are too thin to',
  '          tell. This is where most pairs belong',
  '  0-39    not the same object: a specific conflicts, or only the category is',
  '          shared',
].join('\n');
