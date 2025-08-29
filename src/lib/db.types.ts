import type { Timestamp } from 'firebase/firestore';

export type FirebaseTimestamp = Timestamp;

export type UserDoc = {
  uid: string;
  email: string;
  createdAt: FirebaseTimestamp;
};

export type ServerDoc = {
  serverId: string;
  name?: string;
  status: 'pending' | 'linked';
  claimPublicId?: string | null;
  claimSignature?: string | null;
  apiKeyHash?: string | null;
  salt?: string | null;
  ip?: string;
  agentVersion?: string;
  createdAt: FirebaseTimestamp;
  linkedAt?: FirebaseTimestamp;
  expiresAt?: FirebaseTimestamp | null;
  lastSeen?: FirebaseTimestamp;
};

export type MediaDoc = {
  mediaId: string;
  title: string;
  type: 'movie' | 'episode';
  season?: number;
  episode?: number;
  year?: number;
  filename: string;
  path: string;
  serverId: string;
  codec?: string;
  size: number;
  duration: number;
  posterUrl?: string;
  backdropUrl?: string;
  tmdbId?: number;
  status: 'indexed' | 'updating' | 'error';
  addedAt?: FirebaseTimestamp;
  updatedAt: FirebaseTimestamp;
  playCount?: number;
};

export type PlaybackDoc = {
  mediaId: string;
  lastPosition: number;
  duration: number;
  lastPlayedAt: FirebaseTimestamp;
  playCount: number;
};

export type CollectionDoc = {
  collectionId: string;
  name: string;
  contentIds: string[];
  hidden: boolean;
  presentationStyle:
    | 'single_horizontal'
    | 'dual_horizontal'
    | 'large_horizontal'
    | 'vertical'
    | 'vertical_large';
  createdAt: FirebaseTimestamp;
  updatedAt: FirebaseTimestamp;
};

export type RateLimitDoc = {
  lastTokenCreatedAt: FirebaseTimestamp;
  rateLimitedUntil: FirebaseTimestamp;
};
