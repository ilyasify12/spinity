import mongoose, { type InferSchemaType } from 'mongoose';
declare const ListenSessionSchema: mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    participants: mongoose.Types.DocumentArray<{
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }> & {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }>;
    code: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    queue: mongoose.Types.DocumentArray<{
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
    }>;
    playback: {
        updatedAt: NativeDate;
        trackIndex: number;
        positionMs: number;
        isPlaying: boolean;
    };
    endedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    participants: mongoose.Types.DocumentArray<{
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }> & {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }>;
    code: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    queue: mongoose.Types.DocumentArray<{
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
    }>;
    playback: {
        updatedAt: NativeDate;
        trackIndex: number;
        positionMs: number;
        isPlaying: boolean;
    };
    endedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    participants: mongoose.Types.DocumentArray<{
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }> & {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }>;
    code: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    queue: mongoose.Types.DocumentArray<{
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
    }>;
    playback: {
        updatedAt: NativeDate;
        trackIndex: number;
        positionMs: number;
        isPlaying: boolean;
    };
    endedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>;
export type ListenSessionDoc = InferSchemaType<typeof ListenSessionSchema> & {
    _id: mongoose.Types.ObjectId;
};
export declare const ListenSession: mongoose.Model<{
    participants: mongoose.Types.DocumentArray<{
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }> & {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }>;
    code: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    queue: mongoose.Types.DocumentArray<{
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
    }>;
    playback: {
        updatedAt: NativeDate;
        trackIndex: number;
        positionMs: number;
        isPlaying: boolean;
    };
    endedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    participants: mongoose.Types.DocumentArray<{
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }> & {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }>;
    code: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    queue: mongoose.Types.DocumentArray<{
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
    }>;
    playback: {
        updatedAt: NativeDate;
        trackIndex: number;
        positionMs: number;
        isPlaying: boolean;
    };
    endedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    participants: mongoose.Types.DocumentArray<{
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }> & {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }>;
    code: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    queue: mongoose.Types.DocumentArray<{
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
    }>;
    playback: {
        updatedAt: NativeDate;
        trackIndex: number;
        positionMs: number;
        isPlaying: boolean;
    };
    endedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    participants: mongoose.Types.DocumentArray<{
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }> & {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }>;
    code: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    queue: mongoose.Types.DocumentArray<{
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
    }>;
    playback: {
        updatedAt: NativeDate;
        trackIndex: number;
        positionMs: number;
        isPlaying: boolean;
    };
    endedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    participants: mongoose.Types.DocumentArray<{
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }> & {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }>;
    code: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    queue: mongoose.Types.DocumentArray<{
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
    }>;
    playback: {
        updatedAt: NativeDate;
        trackIndex: number;
        positionMs: number;
        isPlaying: boolean;
    };
    endedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    participants: mongoose.Types.DocumentArray<{
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }> & {
        userId: mongoose.Types.ObjectId;
        joinedAt: NativeDate;
    }>;
    code: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    queue: mongoose.Types.DocumentArray<{
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
    }>;
    playback: {
        updatedAt: NativeDate;
        trackIndex: number;
        positionMs: number;
        isPlaying: boolean;
    };
    endedAt?: NativeDate | null | undefined;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export {};
//# sourceMappingURL=ListenSession.d.ts.map