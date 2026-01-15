import { Timestamp } from 'firebase-admin/firestore';

export interface HandoverCode {
    matchId: string;
    lostItemId: string;
    foundItemId: string;
    codeHash: string;
    attempts: number;
    expiresAt: Timestamp;
    createdAt: Timestamp;
    status: 'pending' | 'verified' | 'blocked';
}

export interface Handover {
    id?: string;
    matchId: string;
    lostItemId: string;
    foundItemId: string;
    lostPersonId: string;
    foundPersonId: string;
    lostPersonEmail: string;
    foundPersonEmail: string;
    itemName: string;
    itemDetails: any; // Snapshot
    codeHash: string; // The code used
    handoverTime: Timestamp;
    createdAt: Timestamp;
}
