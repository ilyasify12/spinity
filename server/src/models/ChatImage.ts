import mongoose, { Schema, type InferSchemaType } from 'mongoose'

/**
 * Chat image attachments (1.0). Binary lives in Mongo so any device on the
 * account can fetch it; a TTL index deletes it 3 days after upload unless a
 * participant pins it (pin clears `expiresAt`, unpin re-arms 3 days).
 */
const ChatImageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
    pinned: { type: Boolean, default: false },
    // TTL: Mongo deletes the doc once this passes. Null while pinned
    // (TTL skips docs where the indexed field is missing/null).
    expiresAt: { type: Date, default: null, expires: 0 }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

export type ChatImageDoc = InferSchemaType<typeof ChatImageSchema> & { _id: mongoose.Types.ObjectId }
export const ChatImage = mongoose.model('ChatImage', ChatImageSchema)
