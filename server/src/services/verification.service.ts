/**
 * Verification Agent Service
 * AI-powered verification to confirm item ownership
 */

import { itemRepository } from '../repositories/item.repository.js';
import { verificationRepository } from '../repositories/verification.repository.js';
import { callLLM } from '../utils/llm.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { Item, Verification, VerificationQuestion } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('verificationAgent');

/**
 * Ceiling on scored submissions per verification.
 *
 * Counts every reserved attempt, including ones that go on to fail, because
 * the cost this bounds is the LLM call and that is already spent by then. With
 * three questions a legitimate claimant uses three.
 */
const MAX_SUBMISSIONS = 6;

/** Confidence needed to pass. */
const PASS_THRESHOLD = 70;

// Question categories weights
const QUESTION_WEIGHTS = {
  specific_details: 0.35, // Specific identifying features
  location_context: 0.25, // Where/when it was lost
  contents_accessories: 0.25, // What was inside/attached
  general_description: 0.15, // Color, size, brand
};

/**
 * Generate verification questions based on item attributes
 */
export async function generateVerificationQuestions(
  item: Item,
  questionCount: number = 3,
): Promise<VerificationQuestion[]> {
  const questions: VerificationQuestion[] = [];

  // Build context for LLM
  const itemContext = `
Item Details:
- Name: ${item.name}
- Description: ${item.description}
- Category: ${item.category || 'Unknown'}
- Tags: ${item.tags?.join(', ') || 'None'}
- Location where found: ${item.location}
- Date found: ${item.date instanceof Date ? item.date.toISOString() : item.date}
`;

  try {
    const prompt = `You are a verification assistant for a lost and found service. 
Generate ${questionCount} specific verification questions to confirm if someone is the rightful owner of this item.

${itemContext}

Create questions that:
1. Only the true owner would likely know (specific details, unique markings, contents)
2. Cannot be easily guessed from the item description
3. Are answerable with short responses

Return ONLY a JSON array of objects with "question" field. Example:
[
  {"question": "What brand is the wallet?"},
  {"question": "What specific items were inside the wallet?"},
  {"question": "Are there any unique marks or scratches on the item?"}
]

Generate questions specific to this item:`;

    const response = await callLLM([{ role: 'user', content: prompt }]);

    // Parse the response
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { question: string }[];
      for (const q of parsed.slice(0, questionCount)) {
        questions.push({
          question: q.question,
        });
      }
    }
  } catch (error) {
    log.error('Error generating questions via LLM:', error);
  }

  // Fallback questions if LLM fails
  if (questions.length < questionCount) {
    const fallbackQuestions = [
      'Can you describe any unique identifying features or marks on this item?',
      'What was the approximate value or age of this item?',
      'Can you describe any contents, accessories, or attached items?',
      'What brand or manufacturer is this item?',
      'Are there any personal markings, labels, or customizations?',
    ];

    for (const q of fallbackQuestions) {
      if (questions.length >= questionCount) break;
      if (!questions.find((existing) => existing.question === q)) {
        questions.push({ question: q });
      }
    }
  }

  return questions.slice(0, questionCount);
}

/**
 * Score a user's answer against the item context
 */
export async function scoreAnswer(
  item: Item,
  question: string,
  userAnswer: string,
): Promise<number> {
  if (!userAnswer || userAnswer.trim().length < 2) {
    return 0;
  }

  const itemContext = `
Item: ${item.name}
Description: ${item.description}
Tags: ${item.tags?.join(', ') || 'None'}
Category: ${item.category || 'Unknown'}
`;

  try {
    const prompt = `You are evaluating an ownership verification answer for a lost item.

Item Context:
${itemContext}

Verification Question: "${question}"
User's Answer: "${userAnswer}"

Evaluate how likely this answer indicates the user is the true owner. Consider:
1. Specificity of the answer (vague vs detailed)
2. Consistency with item description
3. Knowledge that suggests ownership (specific features, contents, usage)

Return ONLY a JSON object with:
- "score": number from 0 to 100 (0 = definitely not owner, 100 = definitely owner)
- "reasoning": brief explanation

Example: {"score": 75, "reasoning": "Answer shows specific knowledge of contents"}`;

    const response = await callLLM([{ role: 'user', content: prompt }]);

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { score: number; reasoning: string };
      return Math.min(100, Math.max(0, parsed.score));
    }
  } catch (error) {
    log.error('Error scoring answer via LLM:', error);
  }

  // Fallback: Basic heuristic scoring
  const answerLength = userAnswer.trim().length;
  if (answerLength > 50) return 60; // Detailed answer
  if (answerLength > 20) return 45; // Moderate answer
  return 30; // Brief answer
}

/**
 * Start a verification process for an item claim
 */
export async function startVerification(
  itemId: string,
  claimantUserId: string,
  claimantEmail: string,
): Promise<Verification | null> {
  // Get the item
  const item = await itemRepository.findById(itemId);

  if (!item) {
    log.error('Item not found:', itemId);
    return null;
  }

  // Generate questions
  const questions = await generateVerificationQuestions(item, 3);

  // Create verification record
  const verification: Omit<Verification, 'id'> = {
    itemId,
    claimantUserId,
    claimantEmail,
    questions,
    confidenceScore: 0,
    status: 'pending',
    createdAt: Timestamp.now(),
  };

  const id = await verificationRepository.create(verification);

  return { id, ...verification } as Verification;
}

/**
 * Submit answer to a verification question
 */
export async function submitVerificationAnswer(
  verificationId: string,
  questionIndex: number,
  answer: string,
): Promise<{ success: boolean; verification: Verification | null; error?: string }> {
  const ref = verificationRepository.ref(verificationId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    return { success: false, verification: null, error: 'Verification not found' };
  }

  const verification = { id: snapshot.id, ...snapshot.data() } as Verification;

  // Reserve the attempt before spending an LLM call on it. Checking the cap
  // against a pre-read snapshot and only counting committed writes meant fifty
  // concurrent submissions all passed the check, all called the model, and
  // forty-nine were rejected afterwards. The counter has to move first, in its
  // own transaction, for the cap to mean anything.
  const reservation = await verificationRepository.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);

    if (!fresh.exists) return { error: 'Verification not found' as const };

    const current = { id: fresh.id, ...fresh.data() } as Verification;
    const blocked = checkSubmittable(current, questionIndex);

    if (blocked) return { error: blocked };

    tx.update(ref, { submissions: (current.submissions ?? 0) + 1 });

    return { current };
  });

  if ('error' in reservation) {
    return { success: false, verification, error: reservation.error };
  }

  const item = await itemRepository.findById(verification.itemId);

  if (!item) {
    return { success: false, verification, error: 'Item not found' };
  }

  const question = reservation.current.questions[questionIndex].question;
  const score = await scoreAnswer(item, question, answer);

  // Second transaction writes the answer. It re-reads because the reservation
  // released the document while the model was working.
  const outcome = await verificationRepository.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);

    if (!fresh.exists) return { error: 'Verification not found' as const };

    const current = { id: fresh.id, ...fresh.data() } as Verification;

    if (current.status !== 'pending') return { error: 'Verification already completed' as const };

    if (current.questions[questionIndex].userAnswer !== undefined) {
      return { error: 'This question has already been answered' as const };
    }

    const questions = [...current.questions];
    questions[questionIndex] = { ...questions[questionIndex], userAnswer: answer, score };

    const answered = questions.filter((entry) => entry.score !== undefined);
    const confidenceScore =
      answered.length > 0
        ? Math.round(
            answered.reduce((total, entry) => total + (entry.score || 0), 0) / answered.length,
          )
        : 0;

    const allAnswered = questions.every((entry) => entry.userAnswer !== undefined);
    const status: Verification['status'] = allAnswered
      ? confidenceScore >= PASS_THRESHOLD
        ? 'passed'
        : 'failed'
      : 'pending';
    const completedAt = allAnswered ? Timestamp.now() : undefined;

    tx.update(ref, {
      questions,
      confidenceScore,
      status,
      ...(completedAt && { completedAt }),
    });

    return {
      verification: {
        ...current,
        questions,
        confidenceScore,
        status,
        completedAt,
      } as Verification,
    };
  });

  if ('error' in outcome) {
    return { success: false, verification, error: outcome.error };
  }

  return { success: true, verification: outcome.verification };
}

/**
 * Why this answer may not be submitted, or null when it may.
 *
 * Answers had to be sequential and single-shot to mean anything: without it a
 * claimant could answer question 3 first, re-answer whichever question scored
 * badly, and keep going until the average cleared the threshold.
 */
function checkSubmittable(verification: Verification, questionIndex: number): string | null {
  if (verification.status !== 'pending') return 'Verification already completed';

  if ((verification.submissions ?? 0) >= MAX_SUBMISSIONS) {
    return 'Too many verification attempts';
  }

  if (questionIndex < 0 || questionIndex >= verification.questions.length) {
    return 'Invalid question index';
  }

  if (verification.questions[questionIndex].userAnswer !== undefined) {
    return 'This question has already been answered';
  }

  const nextUnanswered = verification.questions.findIndex(
    (question) => question.userAnswer === undefined,
  );

  if (questionIndex !== nextUnanswered) {
    return `Answer question ${nextUnanswered + 1} first`;
  }

  return null;
}

/**
 * Complete verification and update item status if passed
 */
export async function completeVerification(
  verificationId: string,
): Promise<{ success: boolean; item?: Item; error?: string }> {
  const verification = await verificationRepository.findById(verificationId);

  if (!verification) {
    return { success: false, error: 'Verification not found' };
  }

  if (verification.status !== 'passed') {
    return { success: false, error: 'Verification did not pass' };
  }

  // `Claimed` is the single terminal state. This path used to set `Resolved`
  // while the handover flow set `Claimed`, and every dashboard counts
  // `Claimed`, so verified claims vanished from the metrics.
  const updatedItem = await itemRepository.updateAndFetch(verification.itemId, {
    status: 'Claimed',
    matchedUserId: verification.claimantUserId,
    verificationConfidence: verification.confidenceScore,
    verifiedAt: FieldValue.serverTimestamp(),
  });

  return { success: true, item: updatedItem as Item };
}

/**
 * Get verification by ID
 */
export async function getVerification(verificationId: string): Promise<Verification | null> {
  return verificationRepository.findById(verificationId);
}
