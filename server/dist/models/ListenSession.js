import mongoose, { Schema } from 'mongoose';
const SessionTrackSchema = new Schema({
    videoId: { type: String, required: true },
    title: { type: String, required: true },
    artist: { type: String, required: true },
    durationSec: { type: Number, required: true },
    thumbnail: { type: String, required: true },
    webUrl: { type: String, required: true }
}, { _id: false });
const ListenSessionSchema = new Schema({
    code: { type: String, required: true, unique: true, uppercase: true, minlength: 4, maxlength: 8 },
    hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isPrivate: { type: Boolean, default: false },
    participants: {
        type: [
            new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, joinedAt: { type: Date, default: () => new Date() } }, { _id: false })
        ],
        default: []
    },
    queue: { type: [SessionTrackSchema], default: [] },
    playback: {
        type: new Schema({
            trackIndex: { type: Number, default: 0 },
            positionMs: { type: Number, default: 0 },
            isPlaying: { type: Boolean, default: false },
            updatedAt: { type: Date, default: () => new Date() }
        }, { _id: false }),
        default: () => ({ trackIndex: 0, positionMs: 0, isPlaying: false, updatedAt: new Date() })
    },
    endedAt: { type: Date, default: null }
}, { timestamps: true });
ListenSessionSchema.index({ hostId: 1 });
ListenSessionSchema.index({ code: 1 });
export const ListenSession = mongoose.model('ListenSession', ListenSessionSchema);
//# sourceMappingURL=ListenSession.js.map