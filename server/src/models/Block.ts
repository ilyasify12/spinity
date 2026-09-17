import mongoose, { Schema, type InferSchemaType } from 'mongoose'

const BlockSchema = new Schema(
  {
    blocker: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    blocked: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

BlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true })

export type BlockDoc = InferSchemaType<typeof BlockSchema> & { _id: mongoose.Types.ObjectId }
export const Block = mongoose.model('Block', BlockSchema)
