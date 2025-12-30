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
    extractItemDataTool,
    uploadImageTool,
    saveItemTool,
    searchMatchesTool,
    getCollectionPointsTool,
    getUserLostItemsTool,
} from './tools.js';
import { invokeLLMWithFallback, SYSTEM_PROMPT } from './langchainConfig.js';

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
        case 'preSearchResults':
            return handlePreSearchResults(state);
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

    // Handle image upload
    let cloudinaryUrls = state.itemData.cloudinaryUrls || [];
    if (state.imageBase64) {
        try {
            console.log('[Graph:collectDescription] Uploading image...');
            const uploadResult = await uploadImageTool.invoke({ imageBase64: state.imageBase64 });
            if (uploadResult.success) {
                cloudinaryUrls = [...cloudinaryUrls, uploadResult.url];
                console.log('[Graph:collectDescription] Image uploaded:', uploadResult.url);
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
            // Found potential matches! Show them in table format
            const matchTable = [
                '--- POTENTIAL MATCHES FOUND ---',
                '',
                '| # | Item Name | Match Score | Location | Date Found |',
                '|---|-----------|-------------|----------|------------|',
                ...matches.slice(0, 5).map((m, i) => {
                    const itemDate = m.item.date ? formatDate(m.item.date) : 'Unknown';
                    return `| ${i + 1} | ${m.item.name} | ${m.score}% | ${m.item.location || 'Unknown'} | ${itemDate} |`;
                }),
                '',
                'Is your item one of these? Reply with the number (1, 2, etc.) or say "none" to continue reporting.',
            ].join('\n');

            return {
                itemData: updatedItemData,
                matches,
                responseMessage: matchTable,
                responseChips: [
                    { label: '1', icon: '' },
                    { label: '2', icon: '' },
                    { label: 'None of these', icon: '' },
                ],
                currentNode: 'preSearchResults' as any,
                turnCount: state.turnCount + 1,
                imageBase64: undefined,
                isComplete: false,
            };
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
            responseMessage = [
                '--- LOST ITEM RECORDED ---',
                '',
                `Your item "${state.itemData.name}" has been saved.`,
                '',
                '--- POTENTIAL MATCHES ---',
                '',
                '| # | Found Item | Match Score | Location |',
                '|---|------------|-------------|----------|',
                ...matches.slice(0, 3).map((m, i) =>
                    `| ${i + 1} | ${m.item.name} | ${m.score}% | ${m.item.location || 'Unknown'} |`
                ),
                '',
                'Check "My Reports" to see details and claim your item.',
            ].join('\n');
        } else {
            responseMessage = [
                '--- LOST ITEM RECORDED ---',
                '',
                `Your item "${state.itemData.name}" has been saved.`,
                '',
                'No matches found yet. You will be notified when someone reports finding a similar item.',
            ].join('\n');
        }
    } else {
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
    const allMatches: any[] = [];
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
        allMatches.push(...matchResult.matches.map(m => ({ ...m, lostItemName: item.name })));
    }

    let responseMessage: string;
    if (allMatches.length > 0) {
        responseMessage = [
            '--- MATCH RESULTS ---',
            '',
            `Found ${allMatches.length} potential match(es) for your lost items:`,
            '',
            '| # | Found Item | Your Lost Item | Match Score |',
            '|---|------------|----------------|-------------|',
            ...allMatches.slice(0, 5).map((m: any, i) =>
                `| ${i + 1} | ${m.item.name} | ${m.lostItemName} | ${m.score}% |`
            ),
            '',
            'Check "My Reports" for details and to claim your items.',
        ].join('\n');
    } else {
        responseMessage = [
            '--- MATCH RESULTS ---',
            '',
            `No matches found yet for your ${lostItems.length} lost item(s).`,
            '',
            'You will be notified when we find something.',
        ].join('\n');
    }

    return {
        matches: allMatches,
        responseMessage,
        responseChips: [
            { label: 'Report lost item', icon: '' },
            { label: 'Report found item', icon: '' },
        ],
        isComplete: true,
        currentNode: 'complete',
    };
}

/**
 * Handle pre-search results - User response to match selection
 */
async function handlePreSearchResults(state: ReportFlowState): Promise<Partial<ReportFlowState>> {
    const message = state.lastUserMessage.toLowerCase().trim();
    console.log('[Graph:preSearchResults] User response:', message);

    // Check if user selected a match number
    const matchNumber = parseInt(message);
    if (!isNaN(matchNumber) && matchNumber >= 1 && state.matches && matchNumber <= state.matches.length) {
        const selectedMatch = state.matches[matchNumber - 1];

        // User selected a match - start verification process
        const collectionPoint = selectedMatch.item.collectionPoint || 'Main Office';

        const responseMessage = [
            '--- MATCH SELECTED ---',
            '',
            `Item: ${selectedMatch.item.name}`,
            `Match Score: ${selectedMatch.score}%`,
            `Location Found: ${selectedMatch.item.location || 'Unknown'}`,
            '',
            '--- COLLECTION DETAILS ---',
            '',
            `Collection Point: ${collectionPoint}`,
            '',
            'To claim this item, please visit the collection point with:',
            '1. A valid government-issued ID',
            '2. Proof of ownership (if available)',
            '',
            'The item has been marked as matched. Thank you for using ReClaim!',
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

    // User said "none" or similar - continue with Lost item report
    if (message.includes('none') || message.includes('no') || message.includes('not')) {
        return {
            responseMessage: 'No problem. Let me continue collecting details for your lost item report.\n\nWhere did you last see this item? Please provide the location.',
            responseChips: [{ label: 'Share location', icon: '' }],
            currentNode: 'collectLocation',
            turnCount: state.turnCount + 1,
            isComplete: false,
        };
    }

    // Unknown response - ask again
    return {
        responseMessage: 'Please reply with a number (1, 2, etc.) to select a match, or say "none" if your item is not listed.',
        responseChips: [
            { label: '1', icon: '' },
            { label: 'None of these', icon: '' },
        ],
        currentNode: 'preSearchResults',
        turnCount: state.turnCount + 1,
        isComplete: false,
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
