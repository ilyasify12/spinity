import mongoose, { type InferSchemaType } from 'mongoose';
/**
 * Chat image attachments (1.0). Binary lives in Mongo so any device on the
 * account can fetch it; a TTL index deletes it 3 days after upload unless a
 * participant pins it (pin clears `expiresAt`, unpin re-arms 3 days).
 */
declare const ChatImageSchema: mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}, {
    data: Buffer<ArrayBufferLike>;
    size: number;
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    contentType: string;
    pinned: boolean;
    expiresAt?: NativeDate | null | undefined;
    createdAt: NativeDate;
}, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    data: Buffer<ArrayBufferLike>;
    size: number;
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    contentType: string;
    pinned: boolean;
    expiresAt?: NativeDate | null | undefined;
    createdAt: NativeDate;
}>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}>> & mongoose.FlatRecord<{
    data: Buffer<ArrayBufferLike>;
    size: number;
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    contentType: string;
    pinned: boolean;
    expiresAt?: NativeDate | null | undefined;
    createdAt: NativeDate;
}> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>;
export type ChatImageDoc = InferSchemaType<typeof ChatImageSchema> & {
    _id: mongoose.Types.ObjectId;
};
export declare const ChatImage: mongoose.Model<{
    data: Buffer<ArrayBufferLike>;
    size: number;
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    contentType: string;
    pinned: boolean;
    expiresAt?: NativeDate | null | undefined;
    createdAt: NativeDate;
}, {}, {}, {}, mongoose.Document<unknown, {}, {
    data: Buffer<ArrayBufferLike>;
    size: number;
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    contentType: string;
    pinned: boolean;
    expiresAt?: NativeDate | null | undefined;
    createdAt: NativeDate;
}, {}, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}> & {
    data: Buffer<ArrayBufferLike>;
    size: number;
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    contentType: string;
    pinned: boolean;
    expiresAt?: NativeDate | null | undefined;
    createdAt: NativeDate;
} & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}, {
    data: Buffer<ArrayBufferLike>;
    size: number;
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    contentType: string;
    pinned: boolean;
    expiresAt?: NativeDate | null | undefined;
    createdAt: NativeDate;
}, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    data: Buffer<ArrayBufferLike>;
    size: number;
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    contentType: string;
    pinned: boolean;
    expiresAt?: NativeDate | null | undefined;
    createdAt: NativeDate;
}>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}>> & mongoose.FlatRecord<{
    data: Buffer<ArrayBufferLike>;
    size: number;
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    contentType: string;
    pinned: boolean;
    expiresAt?: NativeDate | null | undefined;
    createdAt: NativeDate;
}> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export {};
//# sourceMappingURL=ChatImage.d.ts.map