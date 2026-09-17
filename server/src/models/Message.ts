import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const SharedTrackSchema = new Schema(
  {
    videoId: { type: String, required: true },
    title: { type: String, required: true },
    artist: { type: String, required: true },
    durationSec: { type: Number, required: true },
    thumbnail: { type: String, required: true },
    webUrl: { type: String, required: true }
  },
  { _id: false }
)

const MessageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['text', 'playlist', 'track', 'system'], default: 'text', required: true },
    body: { type: String, maxlength: 4000, default: null },
    payload: {
      type: {
        name: { type: String, maxlength: 80 },
        tracks: { type: [SharedTrackSchema], default: undefined }
      },
      default: null
    },
    readBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [] }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

MessageSchema.index({ conversationId: 1, createdAt: -1 })

export type MessageDoc = InferSchemaType<typeof MessageSchema> & { _id: mongoose.Types.ObjectId }
export const Message = mongoose.model('Message', MessageSchema)
