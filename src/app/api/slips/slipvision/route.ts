import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SlipExtractionSchema } from "@/schemas/slip.schema";
import { adaptSlipVisionResponse } from "@/utils/slipvision-adapter.mjs";

const CandidateSchema = z.object({
  bbox_1000: z.tuple([z.number(), z.number(), z.number(), z.number()]).refine(
    ([top, left, bottom, right]) => top >= 0 && left >= 0 && bottom <= 1000 && right <= 1000 && top < bottom && left < right,
  ),
  visual_cues: z.array(z.string().min(1)).min(1),
  data: SlipExtractionSchema,
});

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      return NextResponse.json({ success: false, message: "ต้องส่งไฟล์ภาพ PNG, JPEG หรือ WEBP" }, { status: 400 });
    }
    if (file.size < 1 || file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ success: false, message: "ขนาดภาพต้องไม่เกิน 15 MB" }, { status: 413 });
    }
    const image = Buffer.from(await file.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(image).digest("hex");
    const sidecar = await fetch("http://127.0.0.1:3461/api/extract-slip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: image.toString("base64"), mimeType: file.type }),
      cache: "no-store",
      signal: AbortSignal.timeout(300_000),
    });
    if (!sidecar.ok) {
      return NextResponse.json({
        success: false,
        message: sidecar.status === 503 ? "SlipVision หรือโมเดลยังไม่พร้อม; ไม่บันทึก candidate" : `SlipVision ตอบกลับ ${sidecar.status}; ไม่บันทึก candidate`,
      }, { status: sidecar.status === 503 ? 503 : 502 });
    }
    const raw: unknown = await sidecar.json();
    const candidates = z.array(CandidateSchema).max(20).safeParse(adaptSlipVisionResponse(raw));
    if (!candidates.success) {
      return NextResponse.json({ success: false, message: "ผล SlipVision ไม่ผ่าน schema; ไม่บันทึก candidate" }, { status: 422 });
    }
    return NextResponse.json({
      success: true,
      candidates: candidates.data,
      metadata: {
        file_name: file.name,
        mime_type: file.type,
        sha256,
        size_bytes: image.length,
        extracted_at: new Date().toISOString(),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error && error.name === "TimeoutError"
        ? "SlipVision หมดเวลารอ; ไม่บันทึก candidate"
        : "เชื่อม SlipVision ไม่สำเร็จ; ไม่บันทึก candidate",
    }, { status: 502 });
  }
}
