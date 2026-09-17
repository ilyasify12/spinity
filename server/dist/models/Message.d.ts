import mongoose, { type InferSchemaType } from 'mongoose';
declare const MessageSchema: mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}, {
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    kind: "text" | "playlist" | "track" | "system";
    readBy: mongoose.Types.ObjectId[];
    body?: string | null | undefined;
    payload?: {
        name?: string | null | undefined;
        tracks?: mongoose.Types.DocumentArray<{
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> & {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> | null | undefined;
    } | null | undefined;
    createdAt: NativeDate;
}, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    kind: "text" | "playlist" | "track" | "system";
    readBy: mongoose.Types.ObjectId[];
    body?: string | null | undefined;
    payload?: {
        name?: string | null | undefined;
        tracks?: mongoose.Types.DocumentArray<{
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> & {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> | null | undefined;
    } | null | undefined;
    createdAt: NativeDate;
}>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}>> & mongoose.FlatRecord<{
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    kind: "text" | "playlist" | "track" | "system";
    readBy: mongoose.Types.ObjectId[];
    body?: string | null | undefined;
    payload?: {
        name?: string | null | undefined;
        tracks?: mongoose.Types.DocumentArray<{
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> & {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> | null | undefined;
    } | null | undefined;
    createdAt: NativeDate;
}> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>;
export type MessageDoc = InferSchemaType<typeof MessageSchema> & {
    _id: mongoose.Types.ObjectId;
};
export declare const Message: mongoose.Model<{
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    kind: "text" | "playlist" | "track" | "system";
    readBy: mongoose.Types.ObjectId[];
    body?: string | null | undefined;
    payload?: {
        name?: string | null | undefined;
        tracks?: mongoose.Types.DocumentArray<{
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> & {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> | null | undefined;
    } | null | undefined;
    createdAt: NativeDate;
}, {}, {}, {}, mongoose.Document<unknown, {}, {
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    kind: "text" | "playlist" | "track" | "system";
    readBy: mongoose.Types.ObjectId[];
    body?: string | null | undefined;
    payload?: {
        name?: string | null | undefined;
        tracks?: mongoose.Types.DocumentArray<{
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> & {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> | null | undefined;
    } | null | undefined;
    createdAt: NativeDate;
}, {}, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}> & {
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    kind: "text" | "playlist" | "track" | "system";
    readBy: mongoose.Types.ObjectId[];
    body?: string | null | undefined;
    payload?: {
        name?: string | null | undefined;
        tracks?: mongoose.Types.DocumentArray<{
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> & {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> | null | undefined;
    } | null | undefined;
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
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    kind: "text" | "playlist" | "track" | "system";
    readBy: mongoose.Types.ObjectId[];
    body?: string | null | undefined;
    payload?: {
        name?: string | null | undefined;
        tracks?: mongoose.Types.DocumentArray<{
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> & {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> | null | undefined;
    } | null | undefined;
    createdAt: NativeDate;
}, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    kind: "text" | "playlist" | "track" | "system";
    readBy: mongoose.Types.ObjectId[];
    body?: string | null | undefined;
    payload?: {
        name?: string | null | undefined;
        tracks?: mongoose.Types.DocumentArray<{
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> & {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> | null | undefined;
    } | null | undefined;
    createdAt: NativeDate;
}>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: {
        createdAt: true;
        updatedAt: false;
    };
}>> & mongoose.FlatRecord<{
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    kind: "text" | "playlist" | "track" | "system";
    readBy: mongoose.Types.ObjectId[];
    body?: string | null | undefined;
    payload?: {
        name?: string | null | undefined;
        tracks?: mongoose.Types.DocumentArray<{
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> & {
            videoId: string;
            title: string;
            artist: string;
            durationSec: number;
            thumbnail: string;
            webUrl: string;
        }> | null | undefined;
    } | null | undefined;
    createdAt: NativeDate;
}> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export {};
//# sourceMappingURL=Message.d.ts.map