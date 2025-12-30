/**
 * Verification Agent Service
 * AI-powered verification to confirm item ownership
 */

import { collections } from '../utils/firebase-admin.js';
import { callLLM } from '../utils/llm.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { Item, Verification, VerificationQuestion } from '../types/index.js';

// Question categories weights
const QUESTION_WEIGHTS = {
    specific_details: 0.35,     // Specific identifying features
    location_context: 0.25,     // Where/when it was lost
    contents_accessories: 0.25, // What was inside/attached
    general_description: 0.15,  // Color, size, brand
};

/**
 * Generate verification questions based on item attributes
 */
export async function generateVerificationQuestions(
    item: Item,
    questionCount: number = 3
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
        console.error('Error generating questions via LLM:', error);
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
            if (!questions.find(existing => existing.question === q)) {
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
    userAnswer: string
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
        console.error('Error scoring answer via LLM:', error);
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
    claimantEmail: string
): Promise<Verification | null> {
    // Get the item
    const itemDoc = await collections.items.doc(itemId).get();
    if (!itemDoc.exists) {
        console.error('Item not found:', itemId);
        return null;
    }

    const item = { id: itemDoc.id, ...itemDoc.data() } as Item;

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

    const docRef = await collections.verifications.add(verification);

    return {
        id: docRef.id,
        ...verification,
    } as Verification;
}

/**
 * Submit answer to a verification question
 */
export async function submitVerificationAnswer(
    verificationId: string,
    questionIndex: number,
    answer: string
): Promise<{ success: boolean; verification: Verification | null; error?: string }> {
    const verificationDoc = await collections.verifications.doc(verificationId).get();
    if (!verificationDoc.exists) {
        return { success: false, verification: null, error: 'Verification not found' };
    }

    const verification = { id: verificationDoc.id, ...verificationDoc.data() } as Verification;

    if (verification.status !== 'pending') {
        return { success: false, verification, error: 'Verification already completed' };
    }

    if (questionIndex < 0 || questionIndex >= verification.questions.length) {
        return { success: false, verification, error: 'Invalid question index' };
    }

    // Get the item for context
    const itemDoc = await collections.items.doc(verification.itemId).get();
    if (!itemDoc.exists) {
        return { success: false, verification, error: 'Item not found' };
    }

    const item = { id: itemDoc.id, ...itemDoc.data() } as Item;

    // Score the answer
    const question = verification.questions[questionIndex];
    const score = await scoreAnswer(item, question.question, answer);

    // Update the question with answer and score
    const updatedQuestions = [...verification.questions];
    updatedQuestions[questionIndex] = {
        ...question,
        userAnswer: answer,
        score,
    };

    // Calculate overall confidence score
    const answeredQuestions = updatedQuestions.filter(q => q.score !== undefined);
    const confidenceScore = answeredQuestions.length > 0
        ? Math.round(answeredQuestions.reduce((sum, q) => sum + (q.score || 0), 0) / answeredQuestions.length)
        : 0;

    // Check if all questions are answered
    const allAnswered = updatedQuestions.every(q => q.userAnswer !== undefined);
    let status: 'pending' | 'passed' | 'failed' = 'pending';
    let completedAt: Timestamp | undefined;

    if (allAnswered) {
        // Determine final status based on 70% threshold
        status = confidenceScore >= 70 ? 'passed' : 'failed';
        completedAt = Timestamp.now();
    }

    // Update Firestore
    await collections.verifications.doc(verificationId).update({
        questions: updatedQuestions,
        confidenceScore,
        status,
        ...(completedAt && { completedAt }),
    });

    const updatedVerification: Verification = {
        ...verification,
        questions: updatedQuestions,
        confidenceScore,
        status,
        completedAt,
    };

    return { success: true, verification: updatedVerification };
}

/**
 * Complete verification and update item status if passed
 */
export async function completeVerification(
    verificationId: string
): Promise<{ success: boolean; item?: Item; error?: string }> {
    const verificationDoc = await collections.verifications.doc(verificationId).get();
    if (!verificationDoc.exists) {
        return { success: false, error: 'Verification not found' };
    }

    const verification = { id: verificationDoc.id, ...verificationDoc.data() } as Verification;

    if (verification.status !== 'passed') {
        return { success: false, error: 'Verification did not pass' };
    }

    // Update item status to Resolved
    const itemRef = collections.items.doc(verification.itemId);
    await itemRef.update({
        status: 'Resolved',
        matchedUserId: verification.claimantUserId,
        verificationConfidence: verification.confidenceScore,
        verifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    const updatedItem = await itemRef.get();

    return {
        success: true,
        item: { id: updatedItem.id, ...updatedItem.data() } as Item,
    };
}

/**
 * Get verification by ID
 */
export async function getVerification(verificationId: string): Promise<Verification | null> {
    const doc = await collections.verifications.doc(verificationId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as Verification;
}
