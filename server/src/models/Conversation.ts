import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const ConversationSchema = new Schema(
  {
    participants: { type: [Schema.Types.ObjectId], ref: 'User', required: true, validate: (v: unknown[]) => Array.isArray(v) && v.length === 2 },
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: null, maxlength: 120 }
  },
  { timestamps: true }
)

ConversationSchema.index({ participants: 1 }, { unique: true })

export type ConversationDoc = InferSchemaType<typeof ConversationSchema> & { _id: mongoose.Types.ObjectId }
export const Conversation = mongoose.model('Conversation', ConversationSchema)
