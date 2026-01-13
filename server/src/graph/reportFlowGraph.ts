/**
 * LangGraph Report Item Workflow
 * State machine for handling lost/found item reporting conversations
 * 
 * This is a multi-turn conversation system. Each invocation processes ONE user message
 * and returns a response. The conversation state is persisted in Firestore between turns.
 */

import { StateGraph, END, START } from '@langchain/langgraph';
import {
    ReportFlowAnnotation,
    ReportFlowState,
    ConversationContext,
    CollectedItemData,
    ResponseChip,
    SAFETY_LIMITS,
} from './types.js';
import {
    saveItemTool,
    searchMatchesTool,
    getCollectionPointsTool,
    getUserLostItemsTool,
    deleteMatchedItemsTool,
    extractItemDataTool,
    uploadImageTool,
    uploadMultipleImagesTool,
} from './tools.js';
import { invokeLLMWithFallback, SYSTEM_PROMPT } from './langchainConfig.js';
import { MATCH_CONFIG } from '../utils/scoring.js';

// ============ Main Dispatch Node ============

/**
 * Main dispatch node - Routes to appropriate logic based on conversation state
 * This is the ONLY entry point for the graph
 */
async function dispatchNode(state: ReportFlowState): Promise<Partial<ReportFlowState>> {
    const { currentNode, context, lastUserMessage, turnCount } = state;

    console.log(`[Graph:dispatch] Node: ${currentNode}, Context: ${context}, Turn: ${turnCount}`);

    // First turn - send greeting
    if (turnCount === 0 || currentNode === 'greet') {
        return handleGreet(state);
    }

    // Handle based on context for special flows
    if (context === 'check_matches') {
        return handleCheckMatches(state);
    }

    if (context === 'find_collection') {
        return handleFindCollection(state);
    }

    // Report lost/found flow - route based on current node
    switch (currentNode) {
        case 'collectDescription':
            return handleCollectDescription(state);
        case 'collectLocation':
            return handleCollectLocation(state);
        case 'collectDateTime':
            return handleCollectDateTime(state);
        case 'confirmDetails':
            return handleConfirmDetails(state);
        case 'saveItem':
            return handleSaveAndSearch(state);
        case 'handleConfirmation':
            // Maps to the old preSearchResults but handling confirmation now
            return handleConfirmMatch(state);
        case 'preSearchResults':
            // Keeping for backward compatibility or routing
            return handleConfirmMatch(state);
        default:
            // Default to description collection
            return handleCollectDescription(state);
    }
}

// ============ Handler Functions ============

/**
 * Handle greeting - First turn of conversation
 */
async function handleGreet(state: ReportFlowState): Promise<Partial<ReportFlowState>> {
    console.log('[Graph:greet] Context:', state.context);

    const greetings: Record<ConversationContext, { content: string; chips: ResponseChip[] }> = {
        report_lost: {
            content: "I will help you find your lost item.\n\nPlease describe what you lost (name, color, brand, any distinctive features) or upload a photo. I will immediately search our Found items database for potential matches.",
            chips: [{ label: 'Add photo', icon: '' }],
        },
        report_found: {
            content: "Thank you for reporting a found item.\n\nPlease describe the item you found (color, brand, size, any distinguishing features) or upload a photo. This will be stored in our database to help owners find it.",
            chips: [{ label: 'Add photo', icon: '' }],
        },
        check_matches: {
            content: "Searching for potential matches in our database...",
            chips: [],
        },
        find_collection: {
            content: "Retrieving collection points...",
            chips: [],
        },
        idle: {
            content: "Hello. I am your ReClaim assistant. How can I help you today?",
            chips: [
                { label: 'Report lost item', icon: '' },
                { label: 'Report found item', icon: '' },
                { label: 'Check matches', icon: '' },
            ],
        },
    };

    const greeting = greetings[state.context] || greetings.idle;

    // For check_matches and find_collection, we'll continue processing in the same turn
    // by setting currentNode appropriately
    let nextNode = 'collectDescription';
    if (state.context === 'check_matches') {
        // Actually run the check matches logic
        return handleCheckMatches(state);
    }
    if (state.context === 'find_collection') {
        // Actually run the find collection logic
        return handleCheckMatches(state); // Redirect to check matches instead
    }

    return {
        responseMessage: greeting.content,
        responseChips: greeting.chips,
        currentNode: nextNode as any,
        turnCount: 1,
        isComplete: false,
    };
}

/**
 * Handle description collection
 */
async function handleCollectDescription(state: ReportFlowState): Promise<Partial<ReportFlowState>> {
    console.log('[Graph:collectDescription] Message:', state.lastUserMessage?.substring(0, 50));

    // Handle image upload - normalize to array
    let cloudinaryUrls = state.itemData.cloudinaryUrls || [];
    const imagesBase64 = state.imageBase64
        ? (Array.isArray(state.imageBase64) ? state.imageBase64 : [state.imageBase64])
        : [];

    if (imagesBase64.length > 0) {
        try {
            console.log(`[Graph:collectDescription] Uploading ${imagesBase64.length} image(s)...`);
            if (imagesBase64.length === 1) {
                // Single image upload
                const uploadResult = await uploadImageTool.invoke({ imageBase64: imagesBase64[0] });
                if (uploadResult.success) {
                    cloudinaryUrls = [...cloudinaryUrls, uploadResult.url];
                    console.log('[Graph:collectDescription] Image uploaded:', uploadResult.url);
                }
            } else {
                // Multiple images upload
                const uploadResult = await uploadMultipleImagesTool.invoke({ imagesBase64 });
                if (uploadResult.success) {
                    cloudinaryUrls = [...cloudinaryUrls, ...uploadResult.urls];
                    console.log(`[Graph:collectDescription] ${uploadResult.urls.length} images uploaded`);
                }
            }
        } catch (error) {
            console.error('[Graph:collectDescription] Image upload failed:', error);
        }
    }

    // Extract data from message and/or image
    console.log('[Graph:collectDescription] Extracting data...');
    const extractResult = await extractItemDataTool.invoke({
        message: state.lastUserMessage,
        currentData: state.itemData,
        context: state.context,
        imageBase64: state.imageBase64,
    });

    // Merge extracted data with existing
    const updatedItemData: CollectedItemData = {
        ...state.itemData,
        ...extractResult.extracted,
        cloudinaryUrls: cloudinaryUrls.length > 0 ? cloudinaryUrls : state.itemData.cloudinaryUrls,
    };

    console.log('[Graph:collectDescription] Updated data:', JSON.stringify(updatedItemData));

    // Check what fields we have
    const hasName = !!updatedItemData.name;
    const hasDescription = !!updatedItemData.description;
    const hasLocation = !!updatedItemData.location || !!updatedItemData.coordinates;
    const hasDate = !!updatedItemData.date;
    const hasTags = updatedItemData.tags && updatedItemData.tags.length > 0;
    const hasImage = cloudinaryUrls.length > 0;

    let responseMessage: string;
    let responseChips: ResponseChip[];
    let nextNode: string;

    // Build smart response based on what we have and what's missing
    const missingFields: string[] = [];
    if (!hasName) missingFields.push('item name/type');
    if (!hasDescription) missingFields.push('description');
    if (!hasLocation) missingFields.push('location');
    if (!hasDate) missingFields.push('date and time');

    // FOR LOST ITEMS: Search for matches IMMEDIATELY when we have enough info
    if (state.context === 'report_lost' && hasName) {
        console.log('[Graph:collectDescription] Lost item - searching for matches immediately...');
        const matchResult = await searchMatchesTool.invoke({
            itemData: updatedItemData,
            type: 'Lost',
            imageBase64: state.imageBase64,
        });

        const matches = matchResult.matches || [];

        if (matches.length > 0) {
            // Found potential matches!
            // Get the best match
            const bestMatch = matches[0]; // Assumes sorted by score from search tool

            if (bestMatch.score > 60) {
                // High confidence match
                const matchResponse = [
                    'We found a potential match for your reported lost item.',
                    '',
                    `An item reported as **found** matches your description. The found item is a *${bestMatch.item.name}*, and it closely aligns with the details of your *${updatedItemData.name}*.`,
                    '',
                    `Based on visual and descriptive analysis, the system has calculated a **match confidence of ${bestMatch.score}%**, indicating a strong likelihood that both items refer to the same object.`,
                ].join('\n');

                return {
                    itemData: updatedItemData,
                    matches,
                    pendingMatch: bestMatch, // Start tracking this match
                    pendingLostItemId: undefined, // ID not created yet, will be handled in save flow if needed, but here we are in description flow... wait, IF we haven't saved the lost item yet, we can't delete it easily later unless we save it now. 
                    // Actually, for "report_lost" flow, we haven't saved the item yet.
                    // If the user confirms a match HERE, we should probably SKIP saving the lost item report entirely?
                    // Or save it and then delete it? 
                    // Let's assume we proceed to *confirmation* first. 
                    // If user confirms, we show details. We don't need to save the lost item record if they found it immediately. 
                    // But we DO need to delete the FOUND item record.

                    responseMessage: matchResponse,
                    responseChips: [
                        { label: 'Confirm', icon: '' },
                    ],
                    currentNode: 'handleConfirmation' as any,
                    turnCount: state.turnCount + 1,
                    imageBase64: undefined,
                    isComplete: false,
                };
            } else {
                // Low confidence match
                const noMatchResponse = [
                    'At this time, no strong match was found for your lost item. We recommend checking back later, as new found items may be added to the system.',
                ].join('\n');

                return {
                    itemData: updatedItemData,
                    matches: [], // Don't expose weak matches
                    responseMessage: noMatchResponse,
                    responseChips: [], // "Do NOT show any buttons" - assuming navigation is handled elsewhere or user can type.
                    // If we show NO chips, user is stuck? 
                    // The prompt says "Do NOT show any buttons".
                    // I will strictly follow this for *action* buttons.
                    // Maybe we should route them to 'saveItem' anyway so their report is filed?
                    // "We recommend checking back later" implies the report IS filed?
                    // The current flow was: check matches -> if none -> continue to collect details?
                    // Only "search for matches IMMEDIATELY" was for lost items.
                    // If we don't find a high confidence match, we should probably continue the report flow?
                    // "Response with... no strong match found... recommend checking back later".
                    // This implies the report should be saved so they CAN check back later.
                    // But we are in `collectDescription`. 
                    // I will continue normally to `collectLocation` if we didn't find a strong match, 
                    // OR if we already have location, we might just continue.
                    // Actually, if we are searching immediately, it's essentially a check.
                    // Let's just output the message. The user logic says "Do NOT show any buttons".
                    // If I return `collectLocation` as next node, it will ask for location.
                    // If I return `saveItem`, it will save.
                    // Let's assume we continue the flow to ensure we have all details to SAVE the report.
                };

                // Wait, if match <= 60%, we just say "no strong match".
                // But we still want to save the item?
                // The prompt doesn't explicitly say "Stop reporting".
                // It says "Respond with...".
                // I will return the message, but what is the NEXT state?
                // If I set nextState to `collectLocation` (or whatever is next), the system will output the Next Question immediately after?
                // LangGraph outputs ONE response.
                // If I want to output this message AND continue, I might need to append the next question?
                // Or just stop here and let the user type something?

                // Let's look at the original code:
                // It showed a table and asked "Is your item one of these?".
                // Now, if <= 60%, we say "No match".
                // We should probably proceed to collecting the rest of the info so we can SAVE the lost item.
                // So, treat it as "no match found, continue reporting".
                // I will NOT show the "No strong match" message if I'm just going to ask for location immediately, unless I chain them.
                // But the prompt seems to want this specific message.
                // I will allow the flow to fall through to standard collection if no high confidence match.
                // BUT the prompt is strict about the response format.

                // STRATEGY: 
                // If <= 60%, I will NOT trigger the "match found" logic block.
                // I will let it fall through to the standard "Success/Continue" flow at the bottom of the function.
                // BUT the bottom of the function asks for location/etc.
                // The explicit requirement "Respond with: At this time..." seems to apply when we ARE showing matches.

                // Let's modify the block:
                // If > 60% -> Show Confirmation.
                // If <= 60% -> Do NOTHING special here (no table), just continue to standard collection.
                // Wait, if I do nothing, it will just ask for location. The user won't know we checked.
                // Maybe I should prepend the "No match" message to the next question?
                // "At this time... \n\nBoundaries: Missing Information..."

                // actually, the prompt is for "Chat Assistant - Match Result Display Prompt".
                // It implies this is THE response when a match check happens.
                // If I am in `collectDescription` and I auto-check...
                // Maybe I should only auto-check if we have enough info?

                // Let's look at `handleCollectDescription` again.
                // It says `// FOR LOST ITEMS: Search for matches IMMEDIATELY when we have enough info`.
                // If I change this to:
                // 1. Search.
                // 2. If > 60%, return the Confirm flow.
                // 3. If <= 60%, just continue standard flow (don't interrupt with "No match found" text unless it's the FINAL check?).
                // Actually, if the user *just* typed the description, getting immediate feedback "No match found, let's get your location" is good.
                // I will prepend the message to the next step's response if <= 60%.

                // However, detailed prompt says: "If match confidence <= 60% ... Respond with > At this time, no strong match was found... Do NOT show any buttons."
                // This sounds like a TERMINAL state for that turn.
                // If I terminate, the user has to type again.
                // If I continue, I must show navigation buttons (e.g. "Share location").
                // PROMPT SAYS "Do NOT show any buttons".

                // This implies the match result IS the response.
                // So if <= 60%, I show that message and maybe sit in a state where the user provides more info?
                // Or maybe I just save what I have? 
                // Let's assume if <= 60%, we just output that text and wait for user input (which presumably continues the report).
                // I'll set `currentNode` to `collectLocation` (or whatever is next) but suppress the automated question prompt from that node? 
                // No, I can just return the response here and set the next node.

                return {
                    itemData: updatedItemData,
                    matches: [],
                    responseMessage: noMatchResponse,
                    responseChips: [],
                    currentNode: 'collectLocation' as any, // implicitly move to next step, but user has to type
                    turnCount: state.turnCount + 1,
                    isComplete: false,
                }
            }
        }
    }

    // If we have item info, show it clearly
    if (hasName && hasDescription) {
        // Format the extracted data summary (no emojis, clean format)
        const dataSummary = [
            '--- Item Details ---',
            '',
            `Name: ${updatedItemData.name}`,
            '',
            `Description: ${updatedItemData.description}`,
            '',
            hasTags ? `Tags: ${updatedItemData.tags?.join(', ')}` : null,
            hasImage ? `Image: Uploaded successfully` : null,
            hasLocation ? `Location: ${updatedItemData.location}` : null,
            hasDate ? `Date/Time: ${formatDate(updatedItemData.date)}` : null,
        ].filter(Boolean).join('\n');

        if (hasLocation && hasDate) {
            // We have everything, go to confirmation
            responseMessage = dataSummary + '\n\n--- Confirmation ---\nPlease review the details above and confirm if everything is correct.';
            responseChips = [
                { label: 'Confirm', icon: '' },
                { label: 'Edit details', icon: '' },
            ];
            nextNode = 'confirmDetails';
        } else if (hasLocation) {
            // Need date/time
            responseMessage = dataSummary + '\n\n--- Missing Information ---\nWhen did you ' + (state.context === 'report_lost' ? 'lose' : 'find') + ' this item?\n\nPlease provide the date and approximate time.';
            responseChips = [];
            nextNode = 'collectDateTime';
        } else {
            // Need location
            responseMessage = dataSummary + '\n\n--- Missing Information ---\nWhere did you ' + (state.context === 'report_lost' ? 'last see' : 'find') + ' this item?\n\nPlease provide the location (building, area, or address).';
            responseChips = [{ label: 'Share location', icon: '' }];
            nextNode = 'collectLocation';
        }
    } else if (hasName) {
        // Have name but need more details
        responseMessage = `Item identified: ${updatedItemData.name}\n\nPlease provide more details:\n- Color\n- Brand (if any)\n- Size or distinctive features\n\nOr upload a photo for better identification.`;
        responseChips = [{ label: 'Add photo', icon: '' }];
        nextNode = 'collectDescription';
    } else {
        // Need basic item info
        responseMessage = 'Please describe the item you ' + (state.context === 'report_lost' ? 'lost' : 'found') + ':\n\n- What type of item is it?\n- What color is it?\n- Any brand or distinctive features?\n\nYou can also upload a photo for automatic identification.';
        responseChips = [{ label: 'Add photo', icon: '' }];
        nextNode = 'collectDescription';
    }

    return {
        itemData: updatedItemData,
        responseMessage,
        responseChips,
        currentNode: nextNode as any,
        turnCount: state.turnCount + 1,
        imageBase64: undefined, // Clear image after processing
        isComplete: false,
    };
}

/**
 * Helper to format date for display
 */
function formatDate(date: Date | string | { toDate?: () => Date; seconds?: number } | undefined): string {
    if (!date) return '';
    try {
        let d: Date;
        if (date instanceof Date) {
            d = date;
        } else if (typeof date === 'object' && 'toDate' in date && typeof date.toDate === 'function') {
            d = date.toDate();
        } else if (typeof date === 'object' && 'seconds' in date && typeof date.seconds === 'number') {
            d = new Date(date.seconds * 1000);
        } else {
            d = new Date(date as string);
        }
        if (isNaN(d.getTime())) return '';
        return d.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '';
    }
}

/**
 * Handle location collection
 */
async function handleCollectLocation(state: ReportFlowState): Promise<Partial<ReportFlowState>> {
    console.log('[Graph:collectLocation] Message:', state.lastUserMessage?.substring(0, 50));

    // Extract location from message
    const extractResult = await extractItemDataTool.invoke({
        message: state.lastUserMessage,
        currentData: state.itemData,
        context: state.context,
    });

    const updatedItemData: CollectedItemData = {
        ...state.itemData,
        ...extractResult.extracted,
    };

    const hasLocation = !!updatedItemData.location || !!updatedItemData.coordinates;
    const hasDate = !!updatedItemData.date;

    let responseMessage: string;
    let responseChips: ResponseChip[];
    let nextNode: string;

    if (hasLocation) {
        if (hasDate) {
            // Have everything, show confirmation
            responseMessage = formatConfirmation(updatedItemData, state.context);
            responseChips = [
                { label: 'Confirm', icon: '' },
                { label: 'Edit details', icon: '' },
            ];
            nextNode = 'confirmDetails';
        } else {
            // Need date
            responseMessage = `Location recorded: ${updatedItemData.location}\n\nWhen did this happen?\n(e.g., "today at 5pm", "yesterday afternoon")`;
            responseChips = [];
            nextNode = 'collectDateTime';
        }
    } else {
        responseMessage = `I couldn't identify the location. Please specify where you ${state.context === 'report_lost' ? 'last saw' : 'found'} this item.\n\nYou can describe the building, area, or use the location button.`;
        responseChips = [{ label: 'Share location', icon: '' }];
        nextNode = 'collectLocation';
    }

    return {
        itemData: updatedItemData,
        responseMessage,
        responseChips,
        currentNode: nextNode as any,
        turnCount: state.turnCount + 1,
        isComplete: false,
    };
}

/**
 * Handle datetime collection
 */
async function handleCollectDateTime(state: ReportFlowState): Promise<Partial<ReportFlowState>> {
    console.log('[Graph:collectDateTime] Message:', state.lastUserMessage);

    // Extract date from message
    const extractResult = await extractItemDataTool.invoke({
        message: state.lastUserMessage,
        currentData: state.itemData,
        context: state.context,
    });

    const updatedItemData: CollectedItemData = {
        ...state.itemData,
        ...extractResult.extracted,
    };

    // Default to now if still no date
    if (!updatedItemData.date) {
        updatedItemData.date = new Date();
    }

    // Show confirmation
    const responseMessage = formatConfirmation(updatedItemData, state.context);

    return {
        itemData: updatedItemData,
        responseMessage,
        responseChips: [
            { label: 'Confirm', icon: '✅' },
            { label: 'Edit details', icon: '✏️' },
        ],
        currentNode: 'confirmDetails',
        turnCount: state.turnCount + 1,
        isComplete: false,
    };
}

/**
 * Handle confirmation
 */
async function handleConfirmDetails(state: ReportFlowState): Promise<Partial<ReportFlowState>> {
    console.log('[Graph:confirmDetails] Message:', state.lastUserMessage);

    const message = state.lastUserMessage.toLowerCase();

    if (message.includes('confirm') || message.includes('yes') || message.includes('correct') || message.includes('ok') || message.includes('looks good')) {
        // User confirmed - save and search
        return handleSaveAndSearch(state);
    } else if (message.includes('edit') || message.includes('change') || message.includes('no') || message.includes('wrong')) {
        // User wants to edit
        return {
            responseMessage: "What would you like to change? You can update:\n• Item name\n• Description\n• Location\n• Date/time",
            responseChips: [],
            currentNode: 'collectDescription',
            turnCount: state.turnCount + 1,
            isComplete: false,
        };
    } else {
        // Apply the new info as an update
        const extractResult = await extractItemDataTool.invoke({
            message: state.lastUserMessage,
            currentData: state.itemData,
            context: state.context,
        });

        const updatedItemData: CollectedItemData = {
            ...state.itemData,
            ...extractResult.extracted,
        };

        // Show updated confirmation
        const responseMessage = formatConfirmation(updatedItemData, state.context);

        return {
            itemData: updatedItemData,
            responseMessage,
            responseChips: [
                { label: 'Confirm', icon: '✅' },
                { label: 'Edit details', icon: '✏️' },
            ],
            currentNode: 'confirmDetails',
            turnCount: state.turnCount + 1,
            isComplete: false,
        };
    }
}

/**
 * Handle save and search - Final step of report flow
 */
async function handleSaveAndSearch(state: ReportFlowState): Promise<Partial<ReportFlowState>> {
    console.log('[Graph:saveAndSearch] Saving item for user:', state.userId);

    const itemType = state.context === 'report_lost' ? 'Lost' : 'Found';

    // Save the item
    const saveResult = await saveItemTool.invoke({
        itemData: state.itemData,
        userId: state.userId,
        type: itemType,
    });

    if (!saveResult.success) {
        return {
            error: 'Failed to save item',
            responseMessage: 'Sorry, there was an error saving your report. Please try again.',
            responseChips: [
                { label: 'Report lost item', icon: '🔍' },
                { label: 'Report found item', icon: '📦' },
            ],
            isComplete: true,
            currentNode: 'complete',
        };
    }

    // Search for matches
    console.log('[Graph:saveAndSearch] Searching for matches...');
    const matchResult = await searchMatchesTool.invoke({
        itemData: state.itemData,
        type: itemType,
        imageBase64: state.imageBase64,
    });

    const matches = matchResult.matches || [];
    const isLost = state.context === 'report_lost';

    let responseMessage: string;

    if (isLost) {
        if (matches.length > 0) {
            const bestMatch = matches[0];
            if (bestMatch.score >= MATCH_CONFIG.THRESHOLD) {
                // High confidence match found AFTER saving
                responseMessage = [
                    '--- LOST ITEM RECORDED ---',
                    '',
                    `Your item "${state.itemData.name}" has been saved.`,
                    '',
                    'We also found a potential match for your reported lost item.',
                    '',
                    `An item reported as **found** matches your description. The found item is a *${bestMatch.item.name}*, and it closely aligns with the details of your *${state.itemData.name}*.`,
                    '',
                    `Based on visual and descriptive analysis, the system has calculated a **match confidence of ${bestMatch.score}%**, indicating a strong likelihood that both items refer to the same object.`,
                ].join('\n');

                return {
                    savedItemId: saveResult.itemId,
                    matches,
                    pendingMatch: bestMatch,
                    pendingLostItemId: saveResult.itemId, // We have the saved ID now
                    responseMessage,
                    responseChips: [
                        { label: 'Confirm', icon: '' },
                    ],
                    currentNode: 'handleConfirmation' as any,
                    isComplete: false,
                };
            }
        }

        // No high confidence matches
        responseMessage = [
            '--- LOST ITEM RECORDED ---',
            '',
            `Your item "${state.itemData.name}" has been saved.`,
            '',
            'At this time, no strong match was found for your lost item. We recommend checking back later, as new found items may be added to the system.',
        ].join('\n');
    } else {
        // Found item flow (unchanged mostly, but formatted nicely)
        if (matches.length > 0) {
            responseMessage = [
                '--- FOUND ITEM LOGGED ---',
                '',
                `Thank you! The item "${state.itemData.name}" has been recorded.`,
                '',
                '+20 credits earned',
                '',
                `Found ${matches.length} potential owner(s) - they will be notified automatically.`,
            ].join('\n');
        } else {
            responseMessage = [
                '--- FOUND ITEM LOGGED ---',
                '',
                `Thank you! The item "${state.itemData.name}" has been recorded.`,
                '',
                '+20 credits earned',
                '',
                'No matching lost items yet. Potential owners will be notified when they report.',
            ].join('\n');
        }
    }

    return {
        savedItemId: saveResult.itemId,
        matches,
        responseMessage,
        responseChips: [
            { label: 'Report lost item', icon: '' },
            { label: 'Report found item', icon: '' },
            { label: 'Check matches', icon: '' },
        ],
        isComplete: true,
        currentNode: 'complete',
    };
}

/**
 * Handle check matches context
 */
async function handleCheckMatches(state: ReportFlowState): Promise<Partial<ReportFlowState>> {
    console.log('[Graph:checkMatches] Getting user lost items for:', state.userId);

    const userItemsResult = await getUserLostItemsTool.invoke({ userId: state.userId });
    const lostItems = userItemsResult.items;

    if (lostItems.length === 0) {
        return {
            responseMessage: "You do not have any pending lost item reports.\n\nWould you like to report a lost item?",
            responseChips: [
                { label: 'Report lost item', icon: '' },
                { label: 'Report found item', icon: '' },
            ],
            isComplete: true,
            currentNode: 'complete',
        };
    }

    // Search matches for each lost item
    // We only want to present the BEST match across all items, or maybe iterate?
    // The prompt implies a singular match presentation.
    // Let's find the single best match with > 60% confidence.

    let bestMatch: any = null;
    let bestMatchLostItemId: string | null = null;
    let bestMatchLostItemName: string | null = null;

    for (const item of lostItems) {
        const matchResult = await searchMatchesTool.invoke({
            itemData: {
                name: item.name,
                description: item.description,
                tags: item.tags,
                coordinates: item.coordinates,
                date: item.date?.toDate?.() || new Date(),
            },
            type: 'Lost',
        });

        if (matchResult.matches.length > 0) {
            const itemBest = matchResult.matches[0];
            if (itemBest.score >= MATCH_CONFIG.THRESHOLD) {
                if (!bestMatch || itemBest.score > bestMatch.score) {
                    bestMatch = itemBest;
                    bestMatchLostItemId = item.id;
                    bestMatchLostItemName = item.name;
                }
            }
        }
    }

    if (bestMatch && bestMatchLostItemId) {
        const responseMessage = [
            'We found a potential match for your reported lost item.',
            '',
            `An item reported as **found** matches your description. The found item is a *${bestMatch.item.name}*, and it closely aligns with the details of your *${bestMatchLostItemName}*.`,
            '',
            `Based on visual and descriptive analysis, the system has calculated a **match confidence of ${bestMatch.score}%**, indicating a strong likelihood that both items refer to the same object.`,
        ].join('\n');

        return {
            matches: [bestMatch],
            pendingMatch: bestMatch,
            pendingLostItemId: bestMatchLostItemId,
            responseMessage,
            responseChips: [
                { label: 'Confirm', icon: '' },
            ],
            isComplete: false,
            currentNode: 'handleConfirmation' as any,
        };
    } else {
        const responseMessage = [
            `Checked ${lostItems.length} of your lost items.`,
            '',
            'At this time, no strong match was found for your lost item. We recommend checking back later, as new found items may be added to the system.',
        ].join('\n');

        return {
            matches: [],
            responseMessage,
            responseChips: [
                { label: 'Report lost item', icon: '' },
                { label: 'Report found item', icon: '' },
            ],
            isComplete: true,
            currentNode: 'complete',
        };
    }
}

/**
 * Handle match confirmation
 */
async function handleConfirmMatch(state: ReportFlowState): Promise<Partial<ReportFlowState>> {
    const message = state.lastUserMessage.toLowerCase().trim();
    console.log('[Graph:handleConfirmMatch] User response:', message);

    if (message.includes('confirm') || message.includes('yes') || message.includes('✅')) {
        // User confirmed!
        const foundItem = state.pendingMatch?.item;

        if (!foundItem) {
            return {
                responseMessage: 'Sorry, the match session has expired. Please try searching again.',
                responseChips: [{ label: 'Check matches', icon: '' }],
                isComplete: true,
                currentNode: 'complete',
            };
        }

        // Delete records
        if (state.pendingLostItemId && foundItem.id) {
            console.log(`[Graph:handleConfirmMatch] Deleting items. Lost: ${state.pendingLostItemId}, Found: ${foundItem.id}`);
            await deleteMatchedItemsTool.invoke({
                lostItemId: state.pendingLostItemId,
                foundItemId: foundItem.id,
            });
        }

        const collectionLocation = foundItem.collectionPoint || foundItem.location || 'Main Office';
        const contactEmail = foundItem.reportedByEmail || 'admin@reclaim.ai'; // Fallback logic

        const responseMessage = [
            '**Match Confirmed**',
            '',
            `**Collection Location**: ${collectionLocation}`,
            `**Contact Email**: ${contactEmail}`,
            '',
            '> Please contact the above email to coordinate verification and collection of the item. Proper identity or ownership verification may be required before handover.',
            '',
            'The item records have been removed from the system. Thank you for using ReClaim!',
        ].join('\n');

        return {
            responseMessage,
            responseChips: [
                { label: 'Report lost item', icon: '' },
                { label: 'Report found item', icon: '' },
            ],
            isComplete: true,
            currentNode: 'complete',
        };
    }

    // User didn't confirm
    return {
        responseMessage: 'Match not confirmed. We will keep looking.',
        responseChips: [
            { label: 'Report lost item', icon: '' },
            { label: 'Report found item', icon: '' },
        ],
        isComplete: true,
        currentNode: 'complete',
    };
}

/**
 * Handle find collection context
 */
async function handleFindCollection(state: ReportFlowState): Promise<Partial<ReportFlowState>> {
    console.log('[Graph:findCollection] Getting collection points');

    const pointsResult = await getCollectionPointsTool.invoke({});
    const points = pointsResult.points;

    if (points.length === 0) {
        return {
            responseMessage: "No collection points have been configured yet.\n\nPlease contact the administrator for assistance.",
            responseChips: [
                { label: 'Report lost item', icon: '' },
                { label: 'Report found item', icon: '' },
            ],
            isComplete: true,
            currentNode: 'complete',
        };
    }

    const responseMessage = `--- COLLECTION POINTS ---\n\n` +
        points.map((p, i) =>
            `${i + 1}. ${p.name}\n   Address: ${p.address}\n   Hours: ${p.hours || 'Contact for hours'}`
        ).join('\n\n') +
        '\n\nBring a valid ID to collect your items.';

    return {
        responseMessage,
        responseChips: [
            { label: 'Report lost item', icon: '' },
            { label: 'Report found item', icon: '' },
        ],
        isComplete: true,
        currentNode: 'complete',
    };
}

// ============ Helper Functions ============

/**
 * Format confirmation message
 */
function formatConfirmation(data: CollectedItemData, context: ConversationContext): string {
    const action = context === 'report_lost' ? 'lost' : 'found';

    // Format date safely
    let dateStr = '';
    if (data.date) {
        try {
            const dateObj = data.date instanceof Date
                ? data.date
                : new Date(data.date as any);
            dateStr = dateObj.toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            dateStr = String(data.date);
        }
    }

    const parts = [
        `--- ${action.toUpperCase()} ITEM REPORT ---`,
        '',
        `Item: ${data.name || 'Unknown'}`,
        '',
        data.description && `Description: ${data.description.substring(0, 300)}${data.description.length > 300 ? '...' : ''}`,
        '',
        data.location && `Location: ${data.location}`,
        dateStr && `Date/Time: ${dateStr}`,
        data.tags?.length && `Tags: ${data.tags.join(', ')}`,
        data.cloudinaryUrls?.length && `Image: Uploaded`,
        '',
        '--- Confirmation ---',
        'Does this look correct?',
    ];

    return parts.filter(Boolean).join('\n');
}

// ============ Build Graph ============

/**
 * Create the report item workflow graph
 * Simple graph with single dispatch node that handles all logic
 */
export function createReportFlowGraph() {
    const workflow = new StateGraph(ReportFlowAnnotation)
        .addNode('dispatch', dispatchNode)
        .addEdge(START, 'dispatch')
        .addEdge('dispatch', END);

    return workflow.compile();
}

// Export compiled graph
export const reportFlowGraph = createReportFlowGraph();
