// src/schemas/slip.schema.ts

import { z } from "zod";

const ConfidenceSchema = z
  .number()
  .min(0)
  .max(1);

const NullableTextSchema = z
  .string()
  .trim()
  .min(1)
  .nullable();

const DateSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD"
  )
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);

    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "วันที่ไม่ถูกต้อง")
  .nullable();

const TimeSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
    "เวลาต้องอยู่ในรูปแบบ HH:mm หรือ HH:mm:ss"
  )
  .nullable();

const ReferenceSchema = z
  .string()
  .trim()
  .min(4, "เลขอ้างอิงสั้นเกินไป")
  .max(100, "เลขอ้างอิงยาวเกินไป")
  .regex(
    /^[A-Za-z0-9\-_/]+$/,
    "เลขอ้างอิงมีอักขระที่ไม่รองรับ"
  )
  .nullable();

const AccountSchema = z
  .string()
  .trim()
  .max(100)
  .nullable();

const PersonSchema = z.object({
  name: NullableTextSchema,
  bank: NullableTextSchema,
  account_no: AccountSchema,
});

export const SlipExtractionSchema = z.object({
  document_type: z.literal("bank_transfer_slip"),

  bank: z.object({
    name: NullableTextSchema,
    confidence: ConfidenceSchema,
  }),

  transaction: z.object({
    date: DateSchema,

    time: TimeSchema,

    amount: z
      .number()
      .finite()
      .positive("จำนวนเงินต้องมากกว่า 0")
      .nullable(),

    currency: z
      .enum(["THB"])
      .default("THB"),

    fee: z
      .number()
      .finite()
      .nonnegative()
      .nullable(),

    reference_no: ReferenceSchema,

    transaction_id: z
      .string()
      .trim()
      .max(100)
      .nullable(),

    note: z
      .string()
      .trim()
      .max(1000)
      .nullable(),
  }),

  sender: PersonSchema,

  receiver: PersonSchema,

  confidence: z.object({
    date: ConfidenceSchema,
    time: ConfidenceSchema,
    amount: ConfidenceSchema,
    reference_no: ConfidenceSchema,

    sender_name: ConfidenceSchema,
    receiver_name: ConfidenceSchema,

    sender_account: ConfidenceSchema,
    receiver_account: ConfidenceSchema,
  }),

  raw_text: z
    .array(z.string())
    .default([]),

  warnings: z
    .array(z.string())
    .default([]),
});

export type SlipExtraction = z.infer<
  typeof SlipExtractionSchema
>;
